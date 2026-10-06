const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let sessions = [];
let sid = localStorage.getItem("sid");
let items = [];
let sel = null;      // { d: pickedContext, raw: screenshot dataUrl } for a new item
let editing = null;  // saved item being edited
let tags = [];
let picked = new Set(); // ids of items ticked for "Copy selected"
let nameMode = null; // "new" | "rename"
let urls = [];       // object URLs to revoke on re-render

// ---------- small UI helpers ----------

const svg = (d) => `<svg class="ico" viewBox="0 0 24 24">${d}</svg>`;
const ICONS = {
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
};

let toastTimer;
function toast(msg) {
  $("toast").textContent = msg;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 2000);
}

function showTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $("tab-capture").hidden = name !== "capture";
  $("tab-items").hidden = name !== "items";
}
document.querySelectorAll(".tab").forEach((t) => { t.onclick = () => showTab(t.dataset.tab); });

// Click any [data-zoom] image to view it full size; click again to close.
document.addEventListener("click", (e) => {
  const z = e.target.dataset && e.target.dataset.zoom;
  if (z) { $("lightbox").firstElementChild.src = z; $("lightbox").hidden = false; }
  else if ($("lightbox").contains(e.target)) $("lightbox").hidden = true;
  if (!$("menu").contains(e.target)) $("menu").open = false;
});

// ---------- page messaging ----------

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function send(msg, quiet) {
  const tab = await activeTab();
  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tab.id, msg);
  } catch (e) {
    if (!quiet) $("status").textContent = "Can't use this page (Chrome blocks extensions on chrome:// pages and the web store). Open your app tab and try again.";
  }
}

// ---------- screenshots ----------

const loadImg = (src) => new Promise((ok, fail) => {
  const i = new Image();
  i.onload = () => ok(i);
  i.onerror = fail;
  i.src = src;
});

// Derive both images from one capture. Coordinates are viewport CSS px; scale to image px.
async function makeShots(dataUrl, d, number) {
  const img = await loadImg(dataUrl);
  const s = img.width / d.viewport.width;
  const b = d.element.boundingBox;
  const clamp = (v, max) => Math.max(0, Math.min(v, max));

  const full = document.createElement("canvas");
  full.width = img.width; full.height = img.height;
  const f = full.getContext("2d");
  f.drawImage(img, 0, 0);
  f.strokeStyle = "#FF3B6B";
  f.lineWidth = 2 * s;
  f.strokeRect(b.x * s, b.y * s, b.width * s, b.height * s);
  const label = String(number), bh = 20 * s, bw = (12 + 8 * label.length) * s;
  const by = b.y * s - bh >= 0 ? b.y * s - bh : b.y * s; // above the box if there's room
  f.fillStyle = "#FF3B6B";
  f.fillRect(b.x * s, by, bw, bh);
  f.fillStyle = "#fff";
  f.font = `bold ${13 * s}px system-ui, sans-serif`;
  f.textBaseline = "middle";
  f.fillText(label, b.x * s + 6 * s, by + bh / 2);

  const pad = 24;
  const x0 = clamp(b.x - pad, d.viewport.width), y0 = clamp(b.y - pad, d.viewport.height);
  const x1 = clamp(b.x + b.width + pad, d.viewport.width), y1 = clamp(b.y + b.height + pad, d.viewport.height);
  const crop = document.createElement("canvas");
  crop.width = Math.max(1, Math.round((x1 - x0) * s)); crop.height = Math.max(1, Math.round((y1 - y0) * s));
  crop.getContext("2d").drawImage(img, x0 * s, y0 * s, crop.width, crop.height, 0, 0, crop.width, crop.height);

  return { full: full.toDataURL("image/png"), crop: crop.toDataURL("image/png") };
}

const nextNumber = () => Math.max(0, ...items.map((i) => i.number)) + 1;

async function capture(s) {
  const tab = await activeTab();
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "hide" });
    s.raw = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const shots = await makeShots(s.raw, s.d, nextNumber());
    if (sel === s) $("shots").innerHTML = `<div class="card shot"><span class="label">Screenshot</span><img src="${shots.full}" data-zoom="${shots.full}"><div class="label" style="margin-top:8px">Crop</div><img class="crop" src="${shots.crop}" data-zoom="${shots.crop}"></div>`;
  } catch (e) {
    $("shots").innerHTML = `<p class="hint">Screenshot failed: ${esc(e.message)}</p>`;
  } finally {
    chrome.tabs.sendMessage(tab.id, { type: "show" }).catch(() => {});
  }
}

// ---------- context display ----------

// html=true: values are already-safe HTML (token tags); otherwise they're escaped.
const table = (obj, html) =>
  "<dl>" + Object.entries(obj).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${html ? v : esc(v)}</dd>`).join("") + "</dl>";

// probe = { appVersion, reactComponentPath } for a fresh pick; saved items carry these themselves.
function renderCtx(d, probe = {}) {
  const el = d.element, b = el.boundingBox;
  $("ctx").innerHTML =
    "<h3>Element</h3>" +
    table({
      environment: d.environment,
      "app version": probe.appVersion ?? d.appVersion ?? "(not detected)",
      component: probe.reactComponentPath ?? el.reactComponentPath ?? "(unknown)",
      selector: el.selector,
      tag: el.tagName,
      classes: el.classList.join(" ") || "(none)",
      text: el.textContent || "(none)",
      size: `${Math.round(b.width)} × ${Math.round(b.height)} at ${Math.round(b.x)}, ${Math.round(b.y)}`,
      viewport: `${d.viewport.width} × ${d.viewport.height} @${d.viewport.devicePixelRatio}x`,
      url: d.url,
    }) +
    "<h3>Computed styles</h3>" +
    table(Object.fromEntries(Object.entries(el.computedStyles).map(([k, v]) => [k, styleCell(v, (el.tokens || {})[k])])), true);
}

// ---------- form ----------

const ctxEl = () => (sel ? sel.d.element : editing ? editing.element : null);
const autoTitle = (el) => el.textContent.slice(0, 40) || el.tagName + (el.classList[0] ? "." + el.classList[0] : "");

function curVal() {
  const el = ctxEl(), cat = $("cat").value;
  if (!el) return "";
  if (cat === "Copy") return el.textContent;
  const key = TAGS[cat] && TAGS[cat][$("prop").value];
  return key ? el.computedStyles[key] : "";
}

function fillProps() {
  const props = TAGS[$("cat").value];
  $("prop").hidden = !props;
  $("prop").innerHTML = props ? Object.keys(props).map((p) => `<option>${esc(p)}</option>`).join("") : "";
  showCur();
}
function curRec() {
  const el = ctxEl(), key = TAGS[$("cat").value] && TAGS[$("cat").value][$("prop").value];
  return el && key ? (el.tokens || {})[key] : undefined;
}
const curTok = () => tokenLabel(curRec());
const showCur = () => { $("cur").innerHTML = styleCell(curVal() || "—", curRec()); fillTokenOptions(); };

// Suggest the page's real token names for the Expected field, filtered by what is being tagged.
let tokenNames = JSON.parse(localStorage.getItem("tokenNames") || "[]");
function fillTokenOptions() {
  const cat = $("cat").value, prop = $("prop").value;
  const kind = cat === "Color" ? /color/ : cat === "Spacing" ? /space|spacing|gap/ : cat === "Typography" ? /font|typo|text/
    : prop === "border radius" ? /radius|rounded/ : null;
  $("tokenOptions").innerHTML = kind ? tokenNames.filter((n) => kind.test(n)).map((n) => `<option value="${esc(n)}">`).join("") : "";
}

const tagLabel = (t) => t.category + (t.property ? " › " + t.property : "");

function renderChips() {
  $("chips").innerHTML = tags.map((t, i) =>
    `<span class="chip">${esc(tagLabel(t))}${t.expectedValue ? ": " + esc(t.currentValue) + " → " + esc(t.expectedValue) : ""}<button data-i="${i}" aria-label="Remove tag">×</button></span>`
  ).join("");
}

function updateForm() {
  $("form").hidden = !ctxEl();
  $("status").hidden = !!ctxEl();
  $("parent").disabled = !sel;
  $("clear").disabled = !sel && !editing;
  $("count").textContent = items.length;
  $("pick").disabled = !sid;
  showCur();
  renderChips();
}

function resetForm(clearPage) {
  sel = null; editing = null; tags = [];
  $("title").value = $("notes").value = $("exp").value = "";
  $("shots").innerHTML = $("ctx").innerHTML = "";
  if (clearPage) send({ type: "clear" });
  updateForm();
}

$("cat").innerHTML = Object.keys(TAGS).map((c) => `<option>${esc(c)}</option>`).join("");
$("cat").onchange = fillProps;
$("prop").onchange = showCur;
fillProps();

$("exp").onkeydown = (e) => { if (e.key === "Enter") $("addTag").click(); };
$("addTag").onclick = () => {
  tags.push({ category: $("cat").value, property: $("prop").hidden ? "" : $("prop").value, currentValue: curVal(), currentToken: curTok(), expectedValue: $("exp").value.trim() });
  $("exp").value = "";
  renderChips();
};
$("chips").onclick = (e) => {
  if (e.target.dataset.i) { tags.splice(+e.target.dataset.i, 1); renderChips(); }
};

async function save() {
  const el = ctxEl();
  if (!el) return;
  const base = { title: $("title").value.trim() || autoTitle(el), tags: [...tags], notes: $("notes").value.trim() };
  if (editing) {
    await DB.putItem({ ...editing, ...base });
  } else {
    if (!sel.raw) { toast("No screenshot was captured. Pick the element again."); return; }
    const number = nextNumber();
    const shots = await makeShots(sel.raw, sel.d, number); // re-draw so the badge has the real item number
    const blob = (u) => fetch(u).then((r) => r.blob());
    const { url, pageTitle, viewport, scrollPosition, element, environment } = sel.d;
    const probe = await sel.probe;
    await DB.putItem({
      id: crypto.randomUUID(), sessionId: sid, number, createdAt: new Date().toISOString(),
      url, pageTitle, viewport, scrollPosition, environment,
      appVersion: probe.appVersion || curSession()?.version || null,
      element: { ...element, reactComponentPath: probe.reactComponentPath },
      ...base,
      screenshotFull: await blob(shots.full), screenshotCrop: await blob(shots.crop),    });
  }
  toast(editing ? "Changes saved" : "Item saved");
  resetForm(true);
  await loadItems();
}
$("save").onclick = save;

// ---------- items list ----------

function renderItems() {
  urls.forEach(URL.revokeObjectURL);
  urls = [];
  const url = (b) => { const u = URL.createObjectURL(b); urls.push(u); return u; };
  $("items").innerHTML = items.map((i) => `
    <article class="item card" data-id="${i.id}">
      <div class="item-main">
        <input type="checkbox" data-act="pick" aria-label="Select item ${i.number}"${picked.has(i.id) ? " checked" : ""}>
        <img class="thumb" src="${url(i.screenshotCrop)}" data-act="zoom" alt="">
        <div class="item-body">
          <div class="item-title"><span class="badge">${i.number}</span> ${esc(i.title)}</div>
          <div class="chips">${i.tags.map((t) => `<span class="chip">${esc(tagLabel(t))}</span>`).join("")}</div>
          ${i.notes ? `<div class="item-notes small">${esc(i.notes)}</div>` : ""}
          <div class="muted small">${esc(i.environment || "")}${i.appVersion ? " · v" + esc(i.appVersion) : ""}</div>
        </div>
      </div>
      <div class="item-actions">
        <button class="btn btn-sm btn-ghost" data-act="copy" title="Copy as AI prompt">${ICONS.copy} Copy</button>
        <button class="btn btn-sm btn-ghost" data-act="edit" title="Edit">${ICONS.edit} Edit</button>
        <button class="btn btn-sm btn-ghost btn-danger" data-act="del" title="Delete">${ICONS.trash}</button>
      </div>
    </article>`).join("") || '<div class="empty">No items yet.<br>Pick an element and save it to see it here.</div>';
}

// Two-step delete: first click arms the button, second click confirms.
function confirmClick(btn, fn) {
  if (btn.dataset.armed) return fn();
  btn.dataset.armed = 1;
  const old = btn.innerHTML;
  btn.textContent = "Sure?";
  setTimeout(() => { delete btn.dataset.armed; btn.innerHTML = old; }, 3000);
}

$("items").onclick = (e) => {
  const el = e.target.closest("[data-act]");
  const act = el && el.dataset.act;
  const item = items.find((i) => i.id === e.target.closest(".item")?.dataset.id);
  if (!act || !item) return;
  if (act === "zoom") { $("lightbox").firstElementChild.src = URL.createObjectURL(item.screenshotFull); $("lightbox").hidden = false; }
  if (act === "pick") { el.checked ? picked.add(item.id) : picked.delete(item.id); updateCopyButtons(); }
  if (act === "copy") copyText(buildPrompt([item]), el);
  if (act === "del") confirmClick(el, async () => { picked.delete(item.id); await DB.deleteItem(item.id); await loadItems(); });
  if (act === "edit") {
    resetForm(true);
    editing = item;
    tags = [...item.tags];
    $("title").value = item.title;
    $("notes").value = item.notes;
    renderCtx(item);
    const full = URL.createObjectURL(item.screenshotFull);
    $("shots").innerHTML = `<div class="card shot"><span class="label">Screenshot</span><img src="${full}" data-zoom="${full}"></div>`;
    showTab("capture");
    toast(`Editing item #${item.number}`);
    updateForm();
    scrollTo(0, 0);
  }
};

// ---------- numbered pins on the page ----------

const pushPins = () => send({ type: "pins", pins: items.map((i) => ({ number: i.number, selector: i.element.selector })) }, true);
chrome.tabs.onActivated.addListener(pushPins);
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.status === "complete") pushPins(); });

// ---------- copy as prompt ----------

function copyText(text, btn) {
  const done = () => {
    const old = btn.innerHTML;
    btn.textContent = "Copied";
    setTimeout(() => { btn.innerHTML = old; }, 1500);
  };
  navigator.clipboard.writeText(text).then(done, () => {
    const ta = document.createElement("textarea"); // fallback if the clipboard API is blocked
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    done();
  });
}

function updateCopyButtons() {
  $("copySel").textContent = `Copy ${picked.size} selected`;
  $("selAll").checked = items.length > 0 && picked.size === items.length;
  $("copySel").disabled = !picked.size;
  $("copyAll").disabled = $("export").disabled = !items.length;
}
$("export").onclick = async (e) => {
  const btn = e.target, old = btn.textContent;
  btn.textContent = "Exporting…";
  try {
    const html = await buildDigest(curSession(), items);
    const slug = curSession().name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "feedback";
    const a = document.createElement("a");
    const file = new Blob([html], { type: "text/html" });
    a.href = URL.createObjectURL(file);
    a.download = `${slug}-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast(`Digest downloaded (${(file.size / 1048576).toFixed(1)} MB)`);
  } finally {
    btn.textContent = old;
  }
};
$("selAll").onchange = () => {
  picked = new Set($("selAll").checked ? items.map((i) => i.id) : []);
  renderItems();
  updateCopyButtons();
};
$("copySel").onclick = (e) => copyText(buildPrompt(items.filter((i) => picked.has(i.id))), e.target);
$("copyAll").onclick = (e) => copyText(buildPrompt(items), e.target);

async function loadItems() {
  items = sid ? (await DB.sessionItems(sid)).sort((a, b) => a.number - b.number) : [];
  pushPins();
  picked = new Set([...picked].filter((id) => items.some((i) => i.id === id)));
  updateCopyButtons();
  renderItems();
  updateForm();
}

// ---------- sessions ----------

const curSession = () => sessions.find((s) => s.id === sid);
const syncVer = () => {
  $("ver").value = curSession()?.version || "";
  $("sessNotes").value = curSession()?.notes || "";
  $("ver").disabled = $("sessNotes").disabled = !sid;
};
$("ver").onchange = async () => {
  const s = curSession();
  if (s) { s.version = $("ver").value.trim(); await DB.putSession(s); }
};
$("sessNotes").onchange = async () => {
  const s = curSession();
  if (s) { s.notes = $("sessNotes").value.trim(); await DB.putSession(s); }
};

// Reads DD_RUM version and React component path from the page's own JS world.
async function probe(selector) {
  try {
    const tab = await activeTab();
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", files: ["page-probe.js"] });
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: "MAIN", func: (s) => window.__uifbProbe(s), args: [selector],
    });
    return r.result;
  } catch (e) {
    return { appVersion: null, reactComponentPath: null };
  }
}

function renderSessions() {
  syncVer();
  $("sessions").innerHTML = sessions.map((s) => `<option value="${s.id}"${s.id === sid ? " selected" : ""}>${esc(s.name)}</option>`).join("");
  $("renameSession").disabled = $("deleteSession").disabled = !sid;
}

async function loadSessions() {
  sessions = (await DB.allSessions()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!sessions.some((s) => s.id === sid)) sid = sessions[0]?.id;
  sid ? localStorage.setItem("sid", sid) : localStorage.removeItem("sid");
  renderSessions();
  await loadItems();
  if (!sid) openName("new");
}

function openName(mode) {
  nameMode = mode;
  $("nameRow").hidden = false;
  $("nameIn").value = mode === "rename" ? sessions.find((s) => s.id === sid).name : "";
  $("nameIn").focus();
}
const closeName = () => { nameMode = null; $("nameRow").hidden = true; };

$("newSession").onclick = () => openName("new");
$("renameSession").onclick = () => { $("menu").open = false; openName("rename"); };
$("nameCancel").onclick = closeName;
$("nameOk").onclick = async () => {
  const name = $("nameIn").value.trim();
  if (!name) return;
  if (nameMode === "new") {
    sid = crypto.randomUUID();
    await DB.putSession({ id: sid, name, createdAt: new Date().toISOString() });
  } else {
    await DB.putSession({ ...sessions.find((s) => s.id === sid), name });
  }
  closeName();
  resetForm(true);
  await loadSessions();
};
$("nameIn").onkeydown = (e) => { if (e.key === "Enter") $("nameOk").click(); };

$("sessions").onchange = () => {
  sid = $("sessions").value;
  localStorage.setItem("sid", sid);
  syncVer();
  resetForm(true);
  loadItems();
};
$("deleteSession").onclick = (e) => confirmClick(e.target, async () => {
  await DB.deleteSession(sid);
  resetForm(true);
  sid = null;
  await loadSessions();
});

// ---------- picker buttons + page events ----------

$("pick").onclick = () => { $("status").textContent = "Picking… click an element on the page."; send({ type: "pick" }); };
$("parent").onclick = () => send({ type: "parent" });
$("clear").onclick = () => { resetForm(true); $("status").textContent = "Cleared."; };

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "selected") {
    resetForm(false);
    sel = { d: msg.data, raw: null };
    if (msg.data.tokenNames && msg.data.tokenNames.length) {
      tokenNames = msg.data.tokenNames;
      localStorage.setItem("tokenNames", JSON.stringify(tokenNames));
    }
    showTab("capture");
    renderCtx(msg.data);
    updateForm();
    capture(sel);
    const s = sel;
    s.probe = probe(msg.data.element.selector);
    s.probe.then((p) => {
      if (sel === s) renderCtx(s.d, { appVersion: p.appVersion || curSession()?.version, reactComponentPath: p.reactComponentPath });
    });
  } else if (msg.type === "cancelled") {
    $("status").textContent = "Cancelled.";
  }
});

loadSessions();
