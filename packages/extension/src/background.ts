import type { DiscoveryPayload, ExtensionMessage, LogMessage, TabInfo } from 'console-logs-mcp-shared';
import { CONSOLE_MCP_IDENTIFIER } from 'console-logs-mcp-shared';
import { WebSocketClient } from './lib/websocket-client';

// Discovery configuration
const DISCOVERY_PORT = 9846;
const DISCOVERY_PORT_RANGE = { start: 9800, end: 9900 };
const DISCOVERY_TIMEOUT_MS = 600;

// Initialize WebSocket client (assigned during initialize)
let wsClient: WebSocketClient | null = null;
let hasInitialized = false;
let initializationPromise: Promise<void> | null = null;

// Buffer messages until the WebSocket client is ready. This avoids losing logs when the
// service worker restarts and the connection is still being re-established.
const pendingMessages: ExtensionMessage[] = [];

// Track tab information
const tabs = new Map<number, TabInfo>();
const tabLogCounts = new Map<number, number>();

// Storage keys
const STORAGE_KEYS = {
  ENABLED: 'console_mcp_enabled',
  SANITIZE: 'console_mcp_sanitize',
  LOG_LEVELS: 'console_mcp_log_levels',
  LAST_DISCOVERY_PORT: 'console_mcp_last_discovery_port',
};

// Extension state
let isEnabled = true;
let lastDiscoveryPort: number | null = null;
let activeTabId: number | null = null;
let connectionStatus: 'connected' | 'disconnected' | 'reconnecting' = 'disconnected';

function tabInfoChanged(a: TabInfo, b: TabInfo): boolean {
  return (
    a.url !== b.url ||
    a.title !== b.title ||
    a.sessionId !== b.sessionId ||
    a.isActive !== b.isActive ||
    a.lastNavigationAt !== b.lastNavigationAt
  );
}

function sendTabEvent(type: 'tab_opened' | 'tab_updated', tabInfo: TabInfo): void {
  sendOrQueue({
    type,
    data: tabInfo,
  });
}

function createTabEntry(tabId: number, senderTab: chrome.tabs.Tab | undefined, sessionId: string): TabInfo {
  const tabInfo: TabInfo = {
    id: tabId,
    url: senderTab?.url || '',
    title: senderTab?.title || '',
    sessionId,
    isActive: senderTab?.active ?? activeTabId === tabId,
    lastNavigationAt: Date.now(),
  };
  tabs.set(tabId, tabInfo);
  sendTabEvent('tab_opened', tabInfo);
  if (tabInfo.isActive) {
    setActiveTabId(tabId);
  }
  return tabInfo;
}

function updateTrackedTab(tabId: number, updates: Partial<TabInfo>): void {
  const current = tabs.get(tabId);
  if (!current) {
    return;
  }

  const next: TabInfo = {
    ...current,
    ...updates,
  };

  if (updates.sessionId && updates.sessionId !== current.sessionId && !updates.lastNavigationAt) {
    next.lastNavigationAt = Date.now();
  }

  if (!tabInfoChanged(current, next)) {
    return;
  }

  tabs.set(tabId, next);
  sendTabEvent('tab_updated', next);
}

function setActiveTabId(tabId: number | null): void {
  if (activeTabId === tabId) {
    updateBadge();
    return;
  }

  const previous = activeTabId;
  activeTabId = tabId;

  if (previous !== null) {
    updateTrackedTab(previous, { isActive: false });
  }

  if (tabId !== null) {
    updateTrackedTab(tabId, { isActive: true });
  }

  updateBadge();
}

function enqueueMessage(message: ExtensionMessage): void {
  pendingMessages.push(message);
}

function flushPendingMessages(): void {
  if (!wsClient || pendingMessages.length === 0) {
    return;
  }

  const messages = pendingMessages.splice(0, pendingMessages.length);
  for (const message of messages) {
    wsClient.send(message);
  }
}

function sendOrQueue(message: ExtensionMessage): void {
  if (wsClient) {
    wsClient.send(message);
    return;
  }

  enqueueMessage(message);
}

function getActiveTabLogCount(): number {
  if (activeTabId === null) {
    return 0;
  }
  return tabLogCounts.get(activeTabId) ?? 0;
}

function formatLogCount(count: number): string {
  if (count === 0) return '';
  if (count > 999) return '1k+';
  return String(count);
}

function updateBadge(): void {
  const logCount = getActiveTabLogCount();

  if (logCount > 0) {
    chrome.action.setBadgeText({ text: formatLogCount(logCount) });
    chrome.action.setBadgeBackgroundColor({ color: '#4B5563' });
    return;
  }

  switch (connectionStatus) {
    case 'connected':
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setBadgeBackgroundColor({ color: '#9CA3AF' });
      break;
    case 'reconnecting':
      chrome.action.setBadgeText({ text: '...' });
      chrome.action.setBadgeBackgroundColor({ color: '#A3A3A3' });
      break;
    default:
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
      break;
  }
}

async function callMaintenanceEndpoint(path: string, options?: { method?: string; body?: unknown }) {
  await ensureInitialized();
  const port = lastDiscoveryPort ?? DISCOVERY_PORT;
  const url = `http://localhost:${port}${path}`;

  const response = await fetch(url, {
    method: options?.method ?? 'GET',
    headers: options?.body
      ? {
          'Content-Type': 'application/json',
        }
      : undefined,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Maintenance request failed (${response.status})`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

interface DiscoveryResult {
  wsUrl: string;
  port: number;
  serverId?: string;
}

async function tryHttpDiscovery(port: number): Promise<DiscoveryResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
    const response = await fetch(`http://localhost:${port}/discover`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);
    if (response.ok) {
      const payload = (await response.json()) as DiscoveryPayload;
      if (payload.identifier !== CONSOLE_MCP_IDENTIFIER) {
        return null;
      }

      console.log(
        `[Background] Discovered server via HTTP (port ${port}): ${payload.wsUrl} (server ${payload.serverId ?? 'unknown'})`,
      );
      return { wsUrl: payload.wsUrl, port, serverId: payload.serverId };
    }
  } catch {
    // ignore failed attempts
  }
  return null;
}

async function rememberDiscoveryPort(port: number): Promise<void> {
  lastDiscoveryPort = port;
  await chrome.storage.local.set({ [STORAGE_KEYS.LAST_DISCOVERY_PORT]: port });
}

async function discoverServerUrl(): Promise<string> {
  const httpResult = await discoverViaHttpRange();
  if (httpResult) {
    await rememberDiscoveryPort(httpResult.port);
    return httpResult.wsUrl;
  }

  throw new Error('Console MCP server not found via discovery');
}

async function discoverViaHttpRange(): Promise<DiscoveryResult | null> {
  const tried = new Set<number>();

  const prioritized: Array<number | null> = [lastDiscoveryPort, DISCOVERY_PORT];
  for (const candidate of prioritized) {
    if (candidate === null || tried.has(candidate)) {
      continue;
    }
    tried.add(candidate);
    // eslint-disable-next-line no-await-in-loop
    const result = await tryHttpDiscovery(candidate);
    if (result) {
      return result;
    }
  }

  for (let port = DISCOVERY_PORT_RANGE.start; port <= DISCOVERY_PORT_RANGE.end; port++) {
    if (tried.has(port)) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const result = await tryHttpDiscovery(port);
    if (result) {
      return result;
    }
  }

  return null;
}

async function ensureInitialized(): Promise<void> {
  if (hasInitialized) {
    return;
  }

  if (initializationPromise) {
    await initializationPromise;
    return;
  }

  initializationPromise = (async () => {
    console.log('[Background] Initializing...');

    // Load settings
    const settings = await chrome.storage.local.get([
      STORAGE_KEYS.ENABLED,
      STORAGE_KEYS.SANITIZE,
      STORAGE_KEYS.LOG_LEVELS,
      STORAGE_KEYS.LAST_DISCOVERY_PORT,
    ]);

    isEnabled = settings[STORAGE_KEYS.ENABLED] !== false;
    const storedPort = settings[STORAGE_KEYS.LAST_DISCOVERY_PORT];
    if (typeof storedPort === 'number' && Number.isFinite(storedPort)) {
      lastDiscoveryPort = storedPort;
    }

    // Discover server URL and initialize client
    const wsUrl = await discoverServerUrl();
    wsClient = new WebSocketClient({ url: wsUrl, urlResolver: discoverServerUrl });

    wireStatusHandler();

    // Handle incoming messages from server (browser commands)
    wsClient.onMessage(async (message) => {
      await handleServerMessage(message);
    });

    // Connect to WebSocket server
    if (isEnabled) {
      wsClient.connect();
    }

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id) {
      activeTabId = activeTab.id;
    }

    flushPendingMessages();
    updateBadge();
    hasInitialized = true;
  })();

  try {
    await initializationPromise;
  } catch (error) {
    console.error('[Background] Failed to initialize:', error);
    wsClient = null;
    initializationPromise = null;
    throw error;
  }
}

// Initialize extension
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Background] Extension installed');
  await ensureInitialized();
});

// Connect on startup
chrome.runtime.onStartup.addListener(() => {
  console.log('[Background] Extension started');
  void ensureInitialized();
});

// Initialize immediately when service worker loads
void ensureInitialized();

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'console_log':
      if (isEnabled) {
        void ensureInitialized().then(() => {
          if (isEnabled) {
            handleConsoleLog(message.data, sender);
          }
        });
      }
      return true;

    case 'get_tab_id':
      sendResponse({ tabId: sender.tab?.id || -1 });
      return true;

    case 'get_status':
      void ensureInitialized().then(() => {
        sendResponse({
          connected: wsClient?.getStatus() === 'connected',
          enabled: isEnabled,
          queueLength: wsClient?.getQueueLength() || pendingMessages.length,
        });
      });
      return true;

    case 'toggle_enabled':
      void ensureInitialized().then(() => {
        toggleEnabled().then((enabled) => {
          sendResponse({ enabled });
        });
      });
      return true;

    case 'get_tabs':
      void ensureInitialized().then(() => {
        const tabStats = Array.from(tabs.values()).map((tab) => ({
          ...tab,
          logCount: tabLogCounts.get(tab.id) || 0,
        }));
        sendResponse({ tabs: tabStats });
      });
      return true;

    case 'maintenance_clear':
      void (async () => {
        try {
          await callMaintenanceEndpoint('/maintenance/clear', { method: 'POST', body: {} });
          sendResponse({ success: true });
        } catch (error) {
          sendResponse({ error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;

    case 'maintenance_stats':
      void (async () => {
        try {
          const stats = await callMaintenanceEndpoint('/maintenance/stats');
          sendResponse(stats);
        } catch (error) {
          sendResponse({ error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;

    case 'maintenance_export':
      void (async () => {
        try {
          const format = message.format || 'json';
          const data = await callMaintenanceEndpoint('/maintenance/export', {
            method: 'POST',
            body: { format },
          });
          sendResponse({ data, format });
        } catch (error) {
          sendResponse({ error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
  }
});

function handleConsoleLog(log: LogMessage, sender: chrome.runtime.MessageSender): void {
  const tabId = sender.tab?.id;
  if (!tabId) {
    return;
  }

  const existingTab = tabs.get(tabId);

  if (!existingTab) {
    createTabEntry(tabId, sender.tab, log.sessionId);
  } else {
    const updates: Partial<TabInfo> = {};

    if (sender.tab?.url && sender.tab.url !== existingTab.url) {
      updates.url = sender.tab.url;
    }

    if (sender.tab?.title && sender.tab.title !== existingTab.title) {
      updates.title = sender.tab.title;
    }

    if (existingTab.sessionId !== log.sessionId) {
      updates.sessionId = log.sessionId;
      updates.lastNavigationAt = Date.now();
    }

    updateTrackedTab(tabId, updates);
  }

  if (sender.tab?.active) {
    setActiveTabId(tabId);
  }

  // Update log count
  tabLogCounts.set(tabId, (tabLogCounts.get(tabId) || 0) + 1);
  if (activeTabId === tabId) {
    updateBadge();
  }

  // Ensure the log has the correct tab ID
  const logWithTabId: LogMessage = {
    ...log,
    tabId,
  };

  // Send to WebSocket server
  sendOrQueue({
    type: 'log',
    data: logWithTabId,
  });
}

async function handleServerMessage(message: any): Promise<void> {
  // Handle browser commands from server
  if (message.type === 'execute_js' || message.type === 'get_page_info' || message.type === 'query_dom') {
    const targetTabId = message.data.tabId;

    // If no tabId specified, use active tab
    let tabId = targetTabId;
    if (!tabId) {
      const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = activeTabs[0]?.id;
    }

    if (!tabId) {
      console.error('[Background] No target tab found for command');
      // Send error response back to server
      if (wsClient) {
        wsClient.send({
          type: `${message.type}_response`,
          data: {
            requestId: message.data.requestId,
            error: 'No target tab found',
          },
        } as any);
      }
      return;
    }

    try {
      // Forward command to content script
      const response = await chrome.tabs.sendMessage(tabId, message);

      // Forward response back to server
      if (response) {
        wsClient.send(response);
      }
    } catch (error) {
      console.error('[Background] Failed to send command to content script:', error);
      // Send error response back to server
      if (wsClient) {
        wsClient.send({
          type: `${message.type}_response`,
          data: {
            requestId: message.data.requestId,
            error: error instanceof Error ? error.message : String(error),
          },
        } as any);
      }
    }
  }
}

// Handle tab closure
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabs.has(tabId)) {
    sendOrQueue({
      type: 'tab_closed',
      data: { tabId },
    });
  }

  if (activeTabId === tabId) {
    setActiveTabId(null);
  }

  tabs.delete(tabId);
  tabLogCounts.delete(tabId);
});

// Handle tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tabs.has(tabId)) {
    return;
  }

  const updates: Partial<TabInfo> = {};

  if (changeInfo.url) {
    updates.url = tab.url || '';
  }

  if (changeInfo.title) {
    updates.title = tab.title || '';
  }

  if (Object.keys(updates).length > 0) {
    updateTrackedTab(tabId, updates);
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  setActiveTabId(activeInfo.tabId);
});

// WebSocket status updates
function wireStatusHandler(): void {
  if (!wsClient) return;
  wsClient.onStatusChange((status) => {
    console.log(`[Background] WebSocket status: ${status}`);
    connectionStatus = status;
    updateBadge();
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

  updateBadge();
  return isEnabled;
}

console.log('[Background] Service worker initialized');
