// Builds the AI prompt for one or more saved items. Header appears once, then each item.
const BASELINE_STYLES = ["font-size", "color", "padding"];

function itemPrompt(i) {
  const el = i.element;
  const issues = i.tags.map((t) => {
    const name = t.category + (t.property ? " / " + t.property : "");
    return `- ${name}: current \`${t.currentValue || "n/a"}\`${t.currentToken ? ` (token: ${t.currentToken})` : ""} → expected \`${t.expectedValue || "not specified, see notes"}\``;
  });
  const keys = new Set(BASELINE_STYLES);
  i.tags.forEach((t) => { const k = TAGS[t.category] && TAGS[t.category][t.property]; if (k) keys.add(k); });
  const styles = [...keys].map((k) => {
    const tok = tokenLabel((el.tokens || {})[k]);
    return `${k}: ${el.computedStyles[k]}${tok ? ` (${tok})` : ""}`;
  });

  return `---
## Item #${i.number}: ${i.title}
Page: ${i.url}
Viewport: ${i.viewport.width}×${i.viewport.height}
Element selector: ${el.selector}
Component: ${el.reactComponentPath || "unknown"}
Element text: "${el.textContent}"

Issues:
${issues.join("\n") || "- (none tagged, see notes)"}

Notes from reviewer:
${i.notes || "(none)"}

Relevant current styles:
${styles.join("\n")}

Screenshot: available in the feedback digest as item #${i.number}.`;
}

function buildPrompt(items) {
  const f = items[0];
  return `App version: ${f.appVersion || "unknown"} | Environment: ${f.environment || "unknown"} | Captured: ${f.createdAt.slice(0, 10)}

${items.map(itemPrompt).join("\n\n")}
`;
}
