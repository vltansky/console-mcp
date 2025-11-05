import { WebSocketClient } from './lib/websocket-client';
import type { LogMessage, TabInfo } from '@console-mcp/shared';

// Configuration
const WS_URL = 'ws://localhost:3333';

// Initialize WebSocket client
const wsClient = new WebSocketClient({
  url: WS_URL,
  batchSize: 50,
  batchInterval: 100,
});

// Track tab information
const tabs = new Map<number, TabInfo>();
const tabLogCounts = new Map<number, number>();

// Storage keys
const STORAGE_KEYS = {
  ENABLED: 'console_mcp_enabled',
  SANITIZE: 'console_mcp_sanitize',
  LOG_LEVELS: 'console_mcp_log_levels',
};

// Extension state
let isEnabled = true;

// Initialize extension
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Background] Extension installed');

  // Load settings
  const settings = await chrome.storage.local.get([
    STORAGE_KEYS.ENABLED,
    STORAGE_KEYS.SANITIZE,
    STORAGE_KEYS.LOG_LEVELS,
  ]);

  isEnabled = settings[STORAGE_KEYS.ENABLED] !== false;

  // Connect to WebSocket server
  if (isEnabled) {
    wsClient.connect();
  }
});

// Connect on startup
chrome.runtime.onStartup.addListener(() => {
  console.log('[Background] Extension started');
  if (isEnabled) {
    wsClient.connect();
  }
});

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isEnabled) {
    return;
  }

  switch (message.type) {
    case 'console_log':
      handleConsoleLog(message.data, sender);
      break;

    case 'get_tab_id':
      sendResponse({ tabId: sender.tab?.id || -1 });
      return true;

    case 'get_status':
      sendResponse({
        connected: wsClient.getStatus() === 'connected',
        enabled: isEnabled,
        queueLength: wsClient.getQueueLength(),
      });
      return true;

    case 'toggle_enabled':
      toggleEnabled().then((enabled) => {
        sendResponse({ enabled });
      });
      return true;
  }
});

function handleConsoleLog(log: LogMessage, sender: chrome.runtime.MessageSender): void {
  if (!sender.tab?.id) {
    return;
  }

  // Update tab info if not tracked
  if (!tabs.has(sender.tab.id)) {
    const tabInfo: TabInfo = {
      id: sender.tab.id,
      url: sender.tab.url || '',
      title: sender.tab.title || '',
      sessionId: log.sessionId,
    };
    tabs.set(sender.tab.id, tabInfo);

    // Notify server about new tab
    wsClient.send({
      type: 'tab_opened',
      data: tabInfo,
    });
  }

  // Update log count
  tabLogCounts.set(
    sender.tab.id,
    (tabLogCounts.get(sender.tab.id) || 0) + 1,
  );

  // Ensure the log has the correct tab ID
  const logWithTabId: LogMessage = {
    ...log,
    tabId: sender.tab.id,
  };

  // Send to WebSocket server
  wsClient.send({
    type: 'log',
    data: logWithTabId,
  });
}

// Handle tab closure
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabs.has(tabId)) {
    wsClient.send({
      type: 'tab_closed',
      data: { tabId },
    });

    tabs.delete(tabId);
    tabLogCounts.delete(tabId);
  }
});

// Handle tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && tabs.has(tabId)) {
    const tabInfo: TabInfo = {
      id: tabId,
      url: tab.url || '',
      title: tab.title || '',
      sessionId: tabs.get(tabId)?.sessionId || crypto.randomUUID(),
    };
    tabs.set(tabId, tabInfo);
  }
});

// WebSocket status updates
wsClient.onStatusChange((status) => {
  console.log(`[Background] WebSocket status: ${status}`);

  // Update badge
  if (status === 'connected') {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setBadgeBackgroundColor({ color: '#10B981' });
  } else if (status === 'reconnecting') {
    chrome.action.setBadgeText({ text: '...' });
    chrome.action.setBadgeBackgroundColor({ color: '#F59E0B' });
  } else {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
  }
});

// Toggle enabled state
async function toggleEnabled(): Promise<boolean> {
  isEnabled = !isEnabled;
  await chrome.storage.local.set({ [STORAGE_KEYS.ENABLED]: isEnabled });

  if (isEnabled) {
    wsClient.connect();
  } else {
    wsClient.disconnect();
  }

  return isEnabled;
}

// Get tab statistics
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'get_tabs') {
    const tabStats = Array.from(tabs.values()).map((tab) => ({
      ...tab,
      logCount: tabLogCounts.get(tab.id) || 0,
    }));
    sendResponse({ tabs: tabStats });
    return true;
  }
});

console.log('[Background] Service worker initialized');
