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
    chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
    return;
  }

  switch (connectionStatus) {
    case 'connected':
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setBadgeBackgroundColor({ color: '#10B981' });
      break;
    case 'reconnecting':
      chrome.action.setBadgeText({ text: '...' });
      chrome.action.setBadgeBackgroundColor({ color: '#F59E0B' });
      break;
    default:
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });
      break;
  }
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
    sendOrQueue({
      type: 'tab_opened',
      data: tabInfo,
    });
  }

  // Update log count
  tabLogCounts.set(sender.tab.id, (tabLogCounts.get(sender.tab.id) || 0) + 1);
  if (activeTabId === sender.tab.id) {
    updateBadge();
  }

  // Ensure the log has the correct tab ID
  const logWithTabId: LogMessage = {
    ...log,
    tabId: sender.tab.id,
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

    tabs.delete(tabId);
    tabLogCounts.delete(tabId);
  }

  if (activeTabId === tabId) {
    activeTabId = null;
    updateBadge();
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

chrome.tabs.onActivated.addListener((activeInfo) => {
  activeTabId = activeInfo.tabId;
  updateBadge();
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
