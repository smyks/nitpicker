# Nitpicker

Chrome extension (Manifest V3) for UI feedback: pick elements on any page, tag issues (color, typography, spacing, copy, …), and export a feedback digest.

When a page defines CSS custom properties (design tokens, e.g. `--color-text-muted`), Nitpicker reads them from the page's stylesheets and shows which token an element uses, or which token a hardcoded value matches. Token kind (color / spacing / radius) is guessed from the variable name.

## Install

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Click the toolbar icon to open the side panel, or press `Alt+Shift+F` to start picking.

## Privacy

Everything stays in your browser. Nitpicker makes no network requests and has no backend or analytics. Sessions, tags, and screenshots are stored locally in IndexedDB / localStorage and only leave your machine when you export them.

Be aware that:
- It requests `<all_urls>` and `tabs` so it can run on any page you pick from.
- Screenshots and computed styles/text of the picked page are saved locally and included in exports, so don't share exports from pages with sensitive data.

## Limitations

- Token detection can't read cross-origin stylesheets.
- Not published to the Chrome Web Store; load it unpacked.

## License

MIT
