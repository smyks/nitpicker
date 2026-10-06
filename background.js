// Clicking the toolbar icon opens the side panel.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Alt+Shift+F: open the panel (must happen straight away, inside the key press) and start picking.
chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (cmd !== "start-picking" || !tab) return;
  chrome.sidePanel.open({ tabId: tab.id });
  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tab.id, { type: "pick" });
  } catch (e) { /* chrome:// pages etc. */ }
});
