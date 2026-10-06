// Tag definitions: category -> { property label: computed-style key }. null = no auto value.
const TAGS = {
  Color: { "text color": "color", background: "background-color", "border color": "border-color", opacity: "opacity" },
  Typography: {
    "font size": "font-size", "font weight": "font-weight", "line height": "line-height",
    "font family": "font-family", "letter spacing": "letter-spacing",
  },
  Spacing: { padding: "padding", margin: "margin", gap: "gap" },
  "Alignment / Layout": { alignment: "text-align", width: "width", height: "height", "border radius": "border-radius" },
  Copy: null,
  Icon: null,
  State: null,
  Behavior: null,
  Other: null,
};
