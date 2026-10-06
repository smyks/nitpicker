// Injected on demand by the side panel. Guarded so re-injection is a no-op.
if (!window.__uifbLoaded) {
  window.__uifbLoaded = true;

  const STYLE_PROPS = [
    "color", "background-color", "border-color", "opacity",
    "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-align",
    "gap", "display", "width", "height", "border-radius", "border-width", "align-items", "justify-content",
  ];
  const SIDES = ["top", "right", "bottom", "left"];

  // Remove overlays left behind by an older copy of this script (e.g. after reloading the extension).
  document.querySelectorAll("#__uifb-overlay").forEach((o) => o.remove());
  document.querySelectorAll("#__uifb-pins").forEach((o) => o.remove());
  const pinBox = document.createElement("div");
  pinBox.id = "__uifb-pins";
  document.documentElement.appendChild(pinBox);
  let pins = []; // { selector, node }
  const overlay = document.createElement("div");
  overlay.id = "__uifb-overlay";
  document.documentElement.appendChild(overlay);

  let picking = false;
  let current = null;

  function toHex(v) {
    const m = v.match(/^rgba?\(([^)]+)\)$/);
    if (!m) return v;
    const [r, g, b, a = 1] = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    const hex = "#" + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");
    return a < 1 ? `${hex} (alpha ${a})` : hex;
  }

  function stylesOf(el) {
    const cs = getComputedStyle(el);
    const out = {};
    for (const p of STYLE_PROPS) {
      const v = cs.getPropertyValue(p);
      out[p] = /color/.test(p) ? toHex(v) : v;
    }
    out.padding = SIDES.map((s) => cs.getPropertyValue("padding-" + s)).join(" ");
    out.margin = SIDES.map((s) => cs.getPropertyValue("margin-" + s)).join(" ");
    return out;
  }

  // Looks auto-generated (css-1a2b3c, sc-xxxx, hashed suffix) -> skip it.
  const stableClass = (c) => /^[a-z][\w-]{1,40}$/i.test(c) && !/^(css|sc|jsx)-/i.test(c) && !(/\d/.test(c) && c.length >= 6);

  function segment(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id) return "#" + CSS.escape(el.id);
    for (const a of ["data-testid", "data-test", "data-cy"]) {
      if (el.getAttribute(a)) return `${tag}[${a}="${CSS.escape(el.getAttribute(a))}"]`;
    }
    let seg = tag + [...el.classList].filter(stableClass).slice(0, 2).map((c) => "." + CSS.escape(c)).join("");
    const sibs = el.parentElement ? [...el.parentElement.children].filter((s) => s.tagName === el.tagName) : [];
    if (sibs.length > 1) seg += `:nth-of-type(${sibs.indexOf(el) + 1})`;
    return seg;
  }

  function selectorFor(el) {
    const parts = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      parts.unshift(segment(n));
      const sel = parts.join(" > ");
      try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (e) { /* keep walking */ }
    }
    return parts.join(" > ");
  }

  // ---------- design tokens ----------
  // Which CSS variables (e.g. --color-text-muted) does this element actually use?
  // 1) read the winning declaration from the page's stylesheets  2) fallback: match the value against token values.

  const INHERITED = new Set(["color", "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-align"]);
  const SETTERS = { // property -> declarations that can set it (shorthands included)
    "background-color": ["background-color", "background"],
    "border-color": ["border-color", "border"],
    "border-width": ["border-width", "border"],
    "font-family": ["font-family", "font"], "font-size": ["font-size", "font"], "font-weight": ["font-weight", "font"], "line-height": ["line-height", "font"],
    gap: ["gap", "row-gap", "column-gap"],
    padding: ["padding", ...SIDES.map((s) => "padding-" + s)],
    margin: ["margin", ...SIDES.map((s) => "margin-" + s)],
  };
  const NO_INFO = /^(inherit|initial|unset|revert|currentcolor)$/i;

  function parseDecls(text) { // split on ; outside parentheses
    const out = [];
    let depth = 0, cur = "";
    const push = (str) => {
      const i = str.indexOf(":");
      if (i < 1) return;
      const value = str.slice(i + 1).trim();
      out.push({ name: str.slice(0, i).trim().toLowerCase(), value: value.replace(/\s*!important$/i, ""), important: /!important$/i.test(value) });
    };
    for (const ch of text) {
      if (ch === "(") depth++; else if (ch === ")") depth--;
      if (ch === ";" && !depth) { push(cur); cur = ""; } else cur += ch;
    }
    push(cur);
    return out;
  }

  let ruleCache = null;
  function buildRules() {
    if (ruleCache && Date.now() - ruleCache.at < 10000) return ruleCache;
    const rules = [], names = new Set();
    let order = 0;
    const walk = (list) => {
      for (const r of list) {
        if (r.selectorText !== undefined && r.style) {
          if (r.selectorText.includes("__uifb")) continue;
          const decls = parseDecls(r.style.cssText);
          decls.forEach((d) => { if (d.name.startsWith("--")) names.add(d.name); });
          rules.push({ parts: r.selectorText.split(/,(?![^(]*\))/).map((x) => x.trim()), decls, order: order++ });
        } else if (r.media) {
          if (matchMedia(r.media.mediaText).matches) walk(r.cssRules);
        } else if (r.styleSheet) {
          try { walk(r.styleSheet.cssRules); } catch (e) { /* cross-origin import */ }
        } else if (r.cssRules) walk(r.cssRules);
      }
    };
    for (const sh of document.styleSheets) {
      try { walk(sh.cssRules); } catch (e) { /* cross-origin stylesheet: not readable */ }
    }
    const sorted = [...names].sort();
    return (ruleCache = { at: Date.now(), rules, names: sorted, valueMap: null });
  }

  // Rough CSS specificity: ids, then classes/attrs/pseudo-classes, then tags.
  function specificity(sel) {
    const ids = (sel.match(/#[\w-]+/g) || []).length;
    const cls = (sel.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length;
    const tags = (sel.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
    return ids * 10000 + cls * 100 + tags;
  }

  function cascade(node) { // declaration name -> winning { value, important, spec, order }
    const best = {};
    const consider = (d, spec, order) => {
      const b = best[d.name];
      if (!b || d.important > b.important || (d.important === b.important && (spec > b.spec || (spec === b.spec && order >= b.order)))) {
        best[d.name] = { value: d.value, important: d.important, spec, order };
      }
    };
    for (const r of buildRules().rules) {
      let spec = -1;
      for (const p of r.parts) {
        try { if (node.matches(p)) spec = Math.max(spec, specificity(p)); } catch (e) { /* unsupported selector */ }
      }
      if (spec >= 0) r.decls.forEach((d) => consider(d, spec, r.order));
    }
    parseDecls(node.getAttribute("style") || "").forEach((d) => consider(d, 1e6, 1e9));
    return best;
  }

  function tokenValueMap() { // normalized value -> [token names], so a hardcoded value can be matched to a token
    const cache = buildRules();
    if (cache.valueMap) return cache.valueMap;
    const map = {};
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none";
    document.documentElement.appendChild(probe);
    for (const n of cache.names) {
      if (!root.getPropertyValue(n).trim()) continue; // not defined in the current theme
      let key = null;
      if (/color/.test(n)) { probe.style.color = `var(${n})`; key = toHex(getComputedStyle(probe).color); }
      else if (/space|spacing|gap|radius|rounded/.test(n)) { probe.style.paddingLeft = `var(${n})`; key = getComputedStyle(probe).paddingLeft; }
      if (key && !/alpha 0\)$/.test(key)) (map[key] ||= []).push(n);
    }
    probe.remove();
    return (cache.valueMap = map);
  }

  const SPACE = /space|spacing|gap/, RADIUS = /radius|rounded/; // token kinds are guessed from the variable name
  const MATCH_KIND = { color: /color/, "background-color": /color/, "border-color": /color/, gap: SPACE, padding: SPACE, margin: SPACE, "border-radius": RADIUS };

  function matchTokens(prop, value) {
    const kind = MATCH_KIND[prop];
    if (!kind) return [];
    const map = tokenValueMap();
    const find = (v) => (map[v] || []).filter((n) => kind.test(n)).slice(0, 2);
    const parts = /^(padding|margin)$/.test(prop) ? [...new Set(value.split(" "))] : [value];
    return parts.flatMap((v) => {
      const names = find(v);
      return parts.length > 1 ? names.map((n) => `${v} = ${n}`) : names;
    });
  }

  function tokensFor(el) {
    const out = {};
    const nodes = [el];
    for (let n = el.parentElement; n && nodes.length < 9; n = n.parentElement) nodes.push(n);
    const casc = [];
    const styles = stylesOf(el);
    for (const p of Object.keys(styles)) {
      const names = SETTERS[p] || [p];
      let found = null, level = 0;
      for (; level < (INHERITED.has(p) ? nodes.length : 1) && !found; level++) {
        const b = (casc[level] ||= cascade(nodes[level]));
        for (const n of names) {
          const c = b[n];
          if (!c || NO_INFO.test(c.value)) continue;
          if (!found || c.important > found.important || (c.important === found.important && (c.spec > found.spec || (c.spec === found.spec && c.order > found.order)))) found = c;
        }
      }
      if (found) {
        let uses = [...new Set((found.value.match(/var\(\s*--[\w-]+/g) || []).map((x) => x.replace(/var\(\s*/, "")))];
        if (p === "border-width") uses = uses.filter((n) => !/color|stroke/.test(n)); // `border:` shorthand also carries the colour token
        out[p] = uses.length ? { uses } : { hardcoded: true };
        if (level > 1) out[p].inherited = true;
      }
      const noBorder = p === "border-color" && parseFloat(styles["border-width"]) === 0; // computed colour is just currentColor
      if (!noBorder && (!out[p] || out[p].hardcoded)) {
        const matches = matchTokens(p, styles[p]);
        if (matches.length) (out[p] ||= {}).matches = matches;
      }
    }
    return out;
  }

  function safeTokens(el) {
    try { return tokensFor(el); } catch (e) { return {}; } // token info is a bonus; never block a pick
  }

  function infoOf(el) {
    const r = el.getBoundingClientRect();
    return {
      url: location.href,
      environment: location.hostname,
      pageTitle: document.title,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      scrollPosition: { x: scrollX, y: scrollY },
      element: {
        selector: selectorFor(el),
        tagName: el.tagName.toLowerCase(),
        classList: [...el.classList],
        textContent: (el.textContent || "").trim().slice(0, 200),
        boundingBox: { x: r.x, y: r.y, width: r.width, height: r.height },
        computedStyles: stylesOf(el),
        tokens: safeTokens(el),
      },
      tokenNames: (() => { try { return buildRules().names; } catch (e) { return []; } })(),
    };
  }

  function box(el) {
    if (!el) { overlay.style.display = "none"; return; }
    const r = el.getBoundingClientRect();
    Object.assign(overlay.style, {
      display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px",
    });
  }

  function select(el) {
    current = el;
    box(el);
    chrome.runtime.sendMessage({ type: "selected", data: infoOf(el) });
  }

  function stopPicking() {
    picking = false;
    document.documentElement.classList.remove("__uifb-picking");
    removeEventListener("mousemove", onMove, true);
    removeEventListener("click", onClick, true);
    removeEventListener("keydown", onKey, true);
  }

  function onMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el !== overlay) box(el);
  }
  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    stopPicking();
    if (el) select(el);
  }
  function cancelPick() {
    stopPicking();
    box(current);
    chrome.runtime.sendMessage({ type: "cancelled" });
  }
  function onKey(e) { if (e.key === "Escape") cancelPick(); }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === "hide" || msg.type === "show") {
      overlay.style.visibility = pinBox.style.visibility = msg.type === "hide" ? "hidden" : "visible";
      // Wait two frames so the page has repainted before the screenshot.
      requestAnimationFrame(() => requestAnimationFrame(() => reply(true)));
      return true;
    }
    if (msg.type === "pins") {
      pinBox.textContent = "";
      pins = msg.pins.map((p) => {
        const node = document.createElement("div");
        node.className = "__uifb-pin";
        node.textContent = p.number;
        pinBox.appendChild(node);
        return { selector: p.selector, node };
      });
      return;
    }
    if (msg.type === "pick") { // toggle: a second "pick" (button or shortcut) cancels
      if (picking) return cancelPick();
      picking = true;
      document.documentElement.classList.add("__uifb-picking");
      addEventListener("mousemove", onMove, true);
      addEventListener("click", onClick, true);
      addEventListener("keydown", onKey, true);
      chrome.runtime.sendMessage({ type: "picking" });
    } else if (msg.type === "parent" && current && current.parentElement) {
      select(current.parentElement);
    } else if (msg.type === "clear") {
      stopPicking();
      current = null;
      box(null);
    }
  });

  // Track the element every frame so the box stays aligned when the side panel opens/closes
  // or the page reflows (resize events fire before the layout settles).
  (function track() {
    if (!picking && current) box(current);
    // ponytail: querySelector per pin per frame; fine for dozens of pins, cache/throttle if sessions get huge.
    for (const p of pins) {
      let el = null;
      try { el = document.querySelector(p.selector); } catch (e) { /* bad selector */ }
      const r = el && el.getBoundingClientRect();
      const ok = r && (r.width || r.height);
      p.node.style.display = ok ? "block" : "none"; // hidden if the element isn't on this page
      if (ok) { p.node.style.left = r.left - 8 + "px"; p.node.style.top = r.top - 8 + "px"; }
    }
    requestAnimationFrame(track);
  })();
}
