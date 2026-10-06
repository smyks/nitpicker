// Builds one self-contained HTML digest: inline CSS/JS, images as base64.
const escHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const blobToDataUrl = (b) => new Promise((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(r.result);
  r.onerror = fail;
  r.readAsDataURL(b);
});

// Re-encode as lossless WebP (smaller than PNG). Only used if it is smaller AND decodes to identical pixels;
// otherwise the original PNG is kept, so quality can never drop.
async function losslessImage(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const orig = new Uint32Array(ctx.getImageData(0, 0, c.width, c.height).data.buffer);
    const webp = await new Promise((ok) => c.toBlob(ok, "image/webp", 1));
    if (!webp || webp.type !== "image/webp" || webp.size >= blob.size) return blob;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(await createImageBitmap(webp), 0, 0);
    const back = new Uint32Array(ctx.getImageData(0, 0, c.width, c.height).data.buffer);
    for (let i = 0; i < orig.length; i++) if (orig[i] !== back[i]) return blob;
    return webp;
  } catch (e) {
    return blob;
  }
}

// Digest-specific layout; atoms (btn, chip, badge...) come from ui.css, which is inlined first.
const DIGEST_CSS = `
body{padding-bottom:48px}
.bar{position:sticky;top:0;z-index:5;background:rgba(255,255,255,.92);backdrop-filter:blur(6px);border-bottom:1px solid var(--border)}
.bar-in{max-width:960px;margin:0 auto;padding:10px 16px;display:flex;gap:8px;align-items:center}
.bar-title{font-weight:600;margin-right:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.layout{max-width:1280px;margin:0 auto;padding:24px 16px;display:grid;grid-template-columns:280px minmax(0,1fr);gap:24px;align-items:start}
.nav{position:sticky;top:68px;max-height:calc(100vh - 92px);overflow:auto;padding:20px}
.nav h1{font-size:20px;letter-spacing:-.02em;margin-bottom:10px}
.nav .label{display:block;margin:16px 0 8px}
.meta{display:flex;flex-wrap:wrap;gap:6px}
@media(max-width:900px){.layout{grid-template-columns:1fr}.nav{position:static;max-height:none}}
.filters{display:flex;flex-wrap:wrap;gap:6px}
.pill{border:1px solid var(--border-strong);background:var(--surface);border-radius:var(--r-pill);padding:3px 12px;font:inherit;font-size:12px;cursor:pointer}
.pill:hover{background:#f4f4f5}
.pill.on{background:var(--primary);border-color:var(--primary);color:#fff}
.toc{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.toc a{display:flex;gap:8px;align-items:center;padding:6px 8px;border-radius:var(--r-sm);color:var(--text);text-decoration:none}
.toc a:hover{background:#f4f4f5}
.toc a.on{background:var(--accent-soft)}
.toc-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.note{margin-top:12px;padding:4px 14px;border-left:3px solid var(--border-strong);color:#52525b;white-space:pre-wrap}
.item{margin-bottom:24px;scroll-margin-top:72px;overflow:hidden;page-break-inside:avoid}
.item-head{display:flex;gap:10px;align-items:center;padding:14px 20px;border-bottom:1px solid var(--border)}
.item-head h2{font-size:16px;flex:1;min-width:0}
.item-head label{display:flex;gap:10px;align-items:center;cursor:pointer}
.item-body{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:20px;padding:20px}
@media(max-width:720px){.item-body{grid-template-columns:1fr}}
.full{width:100%;border:1px solid var(--border);border-radius:var(--r-sm);cursor:zoom-in;display:block}
.crop{max-width:100%;max-height:140px;border:1px solid var(--border);border-radius:var(--r-sm);cursor:zoom-in;margin-top:4px}
.side{display:flex;flex-direction:column;gap:10px}
.side p{margin:0}
.item-foot{display:flex;gap:12px;align-items:center;padding:12px 20px;border-top:1px solid var(--border);background:#fafafa}
.item-foot .muted{margin-right:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item-foot a{color:inherit}
details.tech{border-top:1px solid var(--border);padding:0 20px}
details.tech summary{cursor:pointer;padding:12px 0;font-weight:500;color:var(--muted)}
details.tech>*:not(summary){margin-bottom:12px}
pre{margin:0;background:#f4f4f5;padding:12px;border-radius:var(--r-sm);overflow:auto;font:12px/1.5 var(--mono);white-space:pre-wrap}
table{border-collapse:collapse;font:12px var(--mono)}td{padding:2px 16px 2px 0;vertical-align:top}td:first-child{color:var(--muted)}
#zoom{display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);overflow:auto;z-index:9;cursor:zoom-out;padding:16px}
#zoom img{display:block;margin:auto;max-width:none}
@media print{body{background:#fff}.bar,.item-foot .btn,.filters,.nav{display:none}.layout{display:block}.item{box-shadow:none}details.tech{display:none}}
`;

// Runs inside the exported file. Uses buildPrompt/ITEMS embedded below.
const DIGEST_JS = `
function copyText(text, btn) {
  const done = () => { const o = btn.textContent; btn.textContent = "Copied"; setTimeout(() => { btn.textContent = o; }, 1500); };
  const fallback = () => { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); done(); };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
}
const picks = () => [...document.querySelectorAll(".pick:checked")].map((c) => ITEMS[+c.dataset.i]);
function refresh() { const n = picks().length; const b = document.getElementById("copySel"); b.textContent = "Copy " + n + " selected"; b.disabled = !n; }
document.addEventListener("change", (e) => { if (e.target.classList.contains("pick")) refresh(); });
document.addEventListener("click", (e) => {
  const t = e.target, z = document.getElementById("zoom");
  if (t.dataset.copy === "all") copyText(buildPrompt(ITEMS), t);
  else if (t.dataset.copy === "sel") copyText(buildPrompt(picks()), t);
  else if (t.dataset.copy) copyText(buildPrompt([ITEMS[+t.dataset.copy]]), t);
  else if (t.hasAttribute("data-zoom")) { z.firstChild.src = t.src; z.style.display = "block"; }
  else if (z.contains(t)) z.style.display = "none";
  else if (t.dataset.filter) {
    document.querySelectorAll(".pill").forEach((p) => p.classList.toggle("on", p === t));
    document.querySelectorAll(".item, .toc a").forEach((c) => { c.hidden = t.dataset.filter !== "all" && !c.dataset.cats.split(" ").includes(t.dataset.filter); });
  }
});
refresh();
const links = {};
document.querySelectorAll(".toc a").forEach((a) => { links[a.hash.slice(1)] = a; });
const spy = new IntersectionObserver((es) => es.forEach((e) => {
  if (!e.isIntersecting) return;
  document.querySelectorAll(".toc a.on").forEach((a) => a.classList.remove("on"));
  links[e.target.id].classList.add("on");
}), { rootMargin: "-15% 0px -75% 0px" });
document.querySelectorAll(".item").forEach((c) => spy.observe(c));
`;

async function buildDigest(session, items) {
  const first = items[0] || {};
  const version = first.appVersion || session.version;
  const cats = {};
  items.forEach((i) => new Set(i.tags.map((t) => t.category)).forEach((c) => { cats[c] = (cats[c] || 0) + 1; }));
  const css = await fetch(chrome.runtime.getURL("ui.css")).then((r) => r.text());

  const cards = [];
  for (const [idx, i] of items.entries()) {
    const full = await blobToDataUrl(await losslessImage(i.screenshotFull)), crop = await blobToDataUrl(await losslessImage(i.screenshotCrop));
    const el = i.element;
    const itemCats = [...new Set(i.tags.map((t) => slugify(t.category)))].join(" ");
    cards.push(`
<article class="item card" id="item-${i.number}" data-cats="${itemCats}">
  <div class="item-head">
    <label><input type="checkbox" class="pick" data-i="${idx}" aria-label="Select item ${i.number}"><span class="badge">${i.number}</span></label>
    <h2>${escHtml(i.title)}</h2>
    <div class="chips">${i.tags.map((t) => `<span class="chip">${escHtml(t.category + (t.property ? " › " + t.property : ""))}</span>`).join("")}</div>
  </div>
  <div class="item-body">
    <div>
      <img class="full" src="${full}" data-zoom alt="Item ${i.number} screenshot">
    </div>
    <div class="side">
      ${i.tags.map((t) => `<p>${escHtml(tagSentence(t))}</p>`).join("")}
      ${i.notes ? `<div class="note">${escHtml(i.notes)}</div>` : ""}
      <div><span class="label">Crop</span><br><img class="crop" src="${crop}" data-zoom alt="Item ${i.number} crop"></div>
    </div>
  </div>
  <div class="item-foot">
    <span class="muted small">${[i.appVersion && "v" + i.appVersion, i.environment, i.createdAt.replace("T", " ").slice(0, 16)].filter(Boolean).map(escHtml).join(" · ")} · <a href="${escHtml(i.url)}">${escHtml(i.url)}</a></span>
    <button class="btn btn-sm" data-copy="${idx}">Copy prompt</button>
  </div>
  <details class="tech">
    <summary>Technical details &amp; AI prompt</summary>
    <p class="muted small">Selector: <code>${escHtml(el.selector)}</code><br>Component: ${escHtml(el.reactComponentPath || "unknown")}<br>Viewport: ${i.viewport.width}×${i.viewport.height} @${i.viewport.devicePixelRatio}x</p>
    <table>${Object.entries(el.computedStyles).map(([k, v]) => `<tr><td>${escHtml(k)}</td><td>${styleCell(v, (el.tokens || {})[k])}</td></tr>`).join("")}</table>
    <pre>${escHtml(buildPrompt([i]))}</pre>
  </details>
</article>`);
  }

  // Everything the copy buttons need, embedded so the file works offline. "</" is escaped so it can't close the script tag.
  const plain = items.map((i) => ({ ...i, screenshotFull: undefined, screenshotCrop: undefined }));
  const data = [
    `const TAGS=${JSON.stringify(TAGS)};`,
    `const BASELINE_STYLES=${JSON.stringify(BASELINE_STYLES)};`,
    `const ITEMS=${JSON.stringify(plain)};`,
    tokenLabel.toString(),
    itemPrompt.toString(),
    buildPrompt.toString(),
  ].join("\n").replace(/<\//g, "<\\/");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(session.name)}</title><style>${css}${DIGEST_CSS}</style></head>
<body>
<div class="bar"><div class="bar-in">
  <span class="bar-title">${escHtml(session.name)}</span>
  <button class="btn btn-sm" id="copySel" data-copy="sel">Copy 0 selected</button>
  <button class="btn btn-sm btn-primary" data-copy="all">Copy all as AI prompt</button>
</div></div>
<div class="layout">
  <aside class="nav card">
    <h1>${escHtml(session.name)}</h1>
    <div class="meta">${[new Date().toISOString().slice(0, 10), version && "v" + version, first.environment, items.length + (items.length === 1 ? " item" : " items")].filter(Boolean).map((m) => `<span class="chip">${escHtml(m)}</span>`).join("")}</div>
    ${session.notes ? `<div class="note">${escHtml(session.notes)}</div>` : ""}
    <span class="label">Filter by tag</span>
    <div class="filters"><button class="pill on" data-filter="all">All (${items.length})</button>${Object.entries(cats).map(([c, n]) => `<button class="pill" data-filter="${slugify(c)}">${escHtml(c)} (${n})</button>`).join("")}</div>
    <span class="label">Items</span>
    <ol class="toc">${items.map((i) => `<li><a href="#item-${i.number}" data-cats="${[...new Set(i.tags.map((t) => slugify(t.category)))].join(" ")}"><span class="badge">${i.number}</span><span class="toc-t">${escHtml(i.title)}</span></a></li>`).join("")}</ol>
  </aside>
  <main>
${cards.join("\n")}
  </main>
</div>
<div id="zoom"><img alt=""></div>
<script>${data}\n${DIGEST_JS}</script>
</body></html>`;
}
