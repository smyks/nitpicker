// Short text for a design-token record: "--x" (used), "hardcoded", or "hardcoded ≈ --y" (value matches a token).
function tokenLabel(t) {
  if (!t) return "";
  if (t.uses) return t.uses.join(", ");
  return ((t.hardcoded ? "hardcoded" : "") + (t.matches ? " ≈ " + t.matches.join(", ") : "")).trim();
}

// A small colour square for every hex / rgb() / hsl() colour found in a value ("" if none). Named colours are skipped.
function swatches(value) {
  const e = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  return (String(value).match(/#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\([^)]*\)/gi) || [])
    .map((c) => `<span class="swatch" style="--c:${e(c)}"></span>`).join("");
}

// HTML for a style value: a token shows as a tag (raw value on hover); anything else shows the raw value.
function styleCell(value, t) {
  const e = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sw = swatches(value);
  if (t && t.uses) return sw + t.uses.map((n) => `<span class="chip chip-token" data-tip="${e(value)}">${e(n)}</span>`).join(" ");
  if (t && t.matches) return `${sw}${e(value)} <span class="chip chip-token" data-tip="Matches this token by value, but the element hardcodes it">≈ ${e(t.matches.join(", "))}</span>`;
  return sw + e(value);
}

// Turns one tag into a plain sentence for the digest.
function tagSentence(t) {
  const cur = t.currentValue + (t.currentToken ? ` (${t.currentToken})` : ""), exp = t.expectedValue;
  if (t.property) {
    const prop = t.property[0].toUpperCase() + t.property.slice(1);
    return exp ? `${prop} is ${cur}, should be ${exp}.` : `${prop} looks off (currently ${cur}).`;
  }
  if (t.category === "Copy" && exp) return `Copy should read "${exp}" (currently "${cur}").`;
  return `${t.category}: ${exp || "see notes"}.`;
}
