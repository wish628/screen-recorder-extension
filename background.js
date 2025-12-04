console.log('Background script loaded');

// Simple background script that just forwards messages
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('Background received message:', msg);
  
  // Forward the message to the popup
  if (msg.type === 'recordingStarted' || msg.type === 'recordingStopped' || msg.type === 'recordingError') {
    // Notify the popup if it's open
    chrome.action.setPopup({popup: 'popup.html'});
  }
  
  return true;
});

// Listen for tab capture requests from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "startCapture") {
    // This approach won't work in background scripts in newer Chrome versions
    // We'll handle everything in the popup instead
    sendResponse({status: "not_supported"});
    return true;
  }
});
