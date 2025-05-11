// In Manifest V3, we need to use declarativeNetRequest instead of webRequest
// for modifying headers

// Store the active tab origin for referrer modification
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs.length > 0 && tabs[0].url) {
    const url = new URL(tabs[0].url);
    chrome.storage.local.set({ active_tab_origin: url.origin });
    
    // Send message to background script to update the referrer rules
    chrome.runtime.sendMessage({ 
      type: 'setActiveTabOrigin', 
      origin: url.origin 
    });
  }
});

// Setup declarativeNetRequest rules for referrer modification
async function setupReferrerRules() {
  try {
    // Get the active tab origin from storage
    const data = await chrome.storage.local.get(['active_tab_origin']);
    const activeTabOrigin = data.active_tab_origin;
    
    if (!activeTabOrigin) {
      console.warn('No active tab origin found in storage');
      return;
    }

    // Remove any existing rules
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1]
    });

    // Add rule to modify referrer header
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [{
        id: 1,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{
            header: 'Referer',
            operation: 'set',
            value: activeTabOrigin
          }]
        },
        condition: {
          resourceTypes: ['image', 'media', 'object'],
          initiatorDomains: [chrome.runtime.id]
        }
      }]
    });
    
    console.log('Referrer rules updated successfully');
  } catch (error) {
    console.error('Error setting up referrer rules:', error);
  }
}

// Setup the rules when the popup is opened
setupReferrerRules();
