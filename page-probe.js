// Injected into the page's own JS world (not the extension's), so it can see DD_RUM and React internals.
window.__uifbProbe = (selector) => {
  const out = { appVersion: null, reactComponentPath: null };
  try {
    out.appVersion = window.DD_RUM.getInitConfiguration().version || null;
  } catch (e) { /* no Datadog on this page */ }
  try {
    const el = document.querySelector(selector);
    const key = el && Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    const names = [];
    for (let f = key && el[key]; f && names.length < 5; f = f.return) {
      const t = f.type;
      // function/class components, plus memo/forwardRef wrappers
      const n = typeof t === "function" ? t.displayName || t.name
        : t && typeof t === "object" ? t.displayName || (t.render && t.render.name) || (t.type && t.type.name) : null;
      if (n && n.length > 2) names.push(n); // 1-2 letter names are minified; skip them
    }
    if (names.length) out.reactComponentPath = names.reverse().join(" > ");    // Angular: component host elements are custom tags (app-vehicle-card). Tag names survive minification;
    // class names from ng.getComponent only exist in dev builds, so prefer them when present.
    if (!out.reactComponentPath && el) {
      const hosts = [];
      for (let a = el; a && hosts.length < 5; a = a.parentElement) {
        const tag = a.tagName.toLowerCase();
        if (!tag.includes("-") || tag.startsWith("ng-")) continue;
        let n = null;
        try { n = window.ng.getComponent(a).constructor.name; } catch (e) { /* prod build */ }
        hosts.push(n && n.length > 2 ? n : tag);
      }
      if (hosts.length) out.reactComponentPath = hosts.reverse().join(" > ");
    }
  } catch (e) { /* best effort */ }
  return out;
};
