// --- START OF FILE background.js ---
// v2.0.0

// The primary function of the background script is to open the side panel
// when the user clicks the extension's icon in the toolbar.
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// On installation, set the initial recording state to false.
// This prevents potential errors in other scripts that check for this value.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ isRecording: false });
  console.log("Guide2Cypress: Initial 'isRecording' state set to false.");
});


console.log("Guide2Cypress background service worker (v2.0.0) started.");
// --- END OF FILE background.js ---