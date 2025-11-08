import type { LogMessage, TabInfo } from '@console-mcp/shared';
import { WebSocketClient } from './lib/websocket-client';

// Discovery configuration
const DISCOVERY_PORT = 3332;
const FALLBACK_PORTS = [3333, 3334, 3335];

// Initialize WebSocket client (assigned during initialize)
let wsClient: WebSocketClient;

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

async function tryHttpDiscovery(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const response = await fetch(`http://localhost:${DISCOVERY_PORT}/discover`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (response.ok) {
      const { wsUrl } = (await response.json()) as { wsUrl: string };
      console.log(`[Background] Discovered server via HTTP: ${wsUrl}`);
      return wsUrl;
    }
  } catch {
    // ignore
  }
  return null;
}

function testPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(`ws://localhost:${port}`);
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {}
        resolve(false);
      }, 500);
      ws.onopen = () => {
        clearTimeout(timer);
        ws.close();
        resolve(true);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
    } catch {
      resolve(false);
    }
  });
}

async function discoverServerUrl(): Promise<string> {
  // 1) HTTP discovery
  const httpUrl = await tryHttpDiscovery();
  if (httpUrl) return httpUrl;

  // 2) Port scan fallback
  for (const port of FALLBACK_PORTS) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await testPort(port);
    if (ok) {
      const url = `ws://localhost:${port}`;
      console.log(`[Background] Discovered server via port scan: ${url}`);
      return url;
    }
  }

  // 3) Default fallback
  return 'ws://localhost:3333';
}

// Initialize settings and connect immediately
async function initialize() {
  console.log('[Background] Initializing...');

  // Load settings
  const settings = await chrome.storage.local.get([
    STORAGE_KEYS.ENABLED,
    STORAGE_KEYS.SANITIZE,
    STORAGE_KEYS.LOG_LEVELS,
  ]);

  isEnabled = settings[STORAGE_KEYS.ENABLED] !== false;

  // Discover server URL and initialize client
  const wsUrl = await discoverServerUrl();
  wsClient = new WebSocketClient({ url: wsUrl });

  // Connect to WebSocket server
  if (isEnabled) {
    wsClient.connect();
  }
}

// Initialize extension
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Background] Extension installed');
  await initialize();
});

// Connect on startup
chrome.runtime.onStartup.addListener(() => {
  console.log('[Background] Extension started');
  initialize();
});

// Initialize immediately when service worker loads
initialize();

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'console_log':
      if (isEnabled) {
        handleConsoleLog(message.data, sender);
      }
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

    case 'get_tabs':
      const tabStats = Array.from(tabs.values()).map((tab) => ({
        ...tab,
        logCount: tabLogCounts.get(tab.id) || 0,
      }));
      sendResponse({ tabs: tabStats });
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
  tabLogCounts.set(sender.tab.id, (tabLogCounts.get(sender.tab.id) || 0) + 1);

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
function wireStatusHandler(): void {
  if (!wsClient) return;
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
}

// Wire handler after initialization sets wsClient
wireStatusHandler();

// Toggle enabled state
async function toggleEnabled(): Promise<boolean> {
  isEnabled = !isEnabled;
  await chrome.storage.local.set({ [STORAGE_KEYS.ENABLED]: isEnabled });

  if (isEnabled) {
    wsClient?.connect();
  } else {
    wsClient?.disconnect();
  }

  return isEnabled;
}

console.log('[Background] Service worker initialized');
