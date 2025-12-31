import type {
  DiscoveryPayload,
  ExtensionMessage,
  LogMessage,
  TabInfo,
} from 'console-bridge-shared';
import { CONSOLE_MCP_IDENTIFIER } from 'console-bridge-shared';
import { Sanitizer } from './lib/sanitizer';
import { WebSocketClient } from './lib/websocket-client';

const DISCOVERY_PORT = 9846;
const DISCOVERY_PORT_RANGE = { start: 9800, end: 9900 };
const DISCOVERY_TIMEOUT_MS = 600;

let wsClient: WebSocketClient | null = null;
let hasInitialized = false;
let initializationPromise: Promise<void> | null = null;

// Buffer messages until the WebSocket client is ready. This avoids losing logs when the
// service worker restarts and the connection is still being re-established.
const pendingMessages: ExtensionMessage[] = [];

const recentLogs: LogMessage[] = [];
const tabRecentLogs = new Map<number, LogMessage[]>();
const RECENT_LOGS_MAX = 50;

const tabs = new Map<number, TabInfo>();
const tabLogCounts = new Map<number, number>();
const tabErrorCounts = new Map<number, number>();
const tabLastErrors = new Map<number, string>();

const STORAGE_KEYS = {
  ENABLED: 'console_mcp_enabled',
  SANITIZE: 'console_mcp_sanitize',
  LOG_LEVELS: 'console_mcp_log_levels',
  LAST_DISCOVERY_PORT: 'console_mcp_last_discovery_port',
  FOCUS_ACTIVE_TAB: 'console_mcp_focus_active_tab',
};

let isEnabled = true;
let shouldSanitize = true;
let focusActiveTabOnly = false;
let lastDiscoveryPort: number | null = null;
let activeTabId: number | null = null;
let connectionStatus: 'connected' | 'disconnected' | 'reconnecting' = 'disconnected';
const sanitizer = new Sanitizer();

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

function createTabEntry(
  tabId: number,
  senderTab: chrome.tabs.Tab | undefined,
  sessionId: string,
): TabInfo {
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
  const errorCount = activeTabId ? (tabErrorCounts.get(activeTabId) ?? 0) : 0;

  if (errorCount > 0) {
    chrome.action.setBadgeText({ text: formatLogCount(errorCount) });
    chrome.action.setBadgeBackgroundColor({ color: '#EF4444' }); // Red for errors
    return;
  }

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
      chrome.action.setBadgeBackgroundColor({ color: '#9CA3AF' });
      break;
  }
}

async function callMaintenanceEndpoint(
  path: string,
  options?: { method?: string; body?: unknown },
) {
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
        console.log(`[Background] Port ${port}: wrong identifier "${payload.identifier}"`);
        return null;
      }

      console.log(
        `[Background] Discovered server via HTTP (port ${port}): ${payload.wsUrl} (server ${payload.serverId ?? 'unknown'})`,
      );
      return { wsUrl: payload.wsUrl, port, serverId: payload.serverId };
    }
    console.log(`[Background] Port ${port}: response not ok (${response.status})`);
  } catch (err) {
    // Log first few ports for debugging
    if (port <= DISCOVERY_PORT + 2) {
      console.log(`[Background] Port ${port}: ${err instanceof Error ? err.message : err}`);
    }
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

async function tryDiscoverServerUrl(): Promise<string | null> {
  try {
    return await discoverServerUrl();
  } catch {
    return null;
  }
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
      STORAGE_KEYS.FOCUS_ACTIVE_TAB,
    ]);

    isEnabled = settings[STORAGE_KEYS.ENABLED] !== false;
    // Default sanitize to true (nullish coalescing: undefined/null -> true)
    shouldSanitize = settings[STORAGE_KEYS.SANITIZE] ?? true;
    focusActiveTabOnly = settings[STORAGE_KEYS.FOCUS_ACTIVE_TAB] === true;

    if (settings[STORAGE_KEYS.SANITIZE] === undefined) {
      await chrome.storage.local.set({ [STORAGE_KEYS.SANITIZE]: true });
    }

    const storedPort = settings[STORAGE_KEYS.LAST_DISCOVERY_PORT];
    if (typeof storedPort === 'number' && Number.isFinite(storedPort)) {
      lastDiscoveryPort = storedPort;
    }

    const wsUrl = await tryDiscoverServerUrl();

    // Create client with placeholder URL - urlResolver will find the real one
    const initialUrl = wsUrl ?? `ws://localhost:${lastDiscoveryPort ?? DISCOVERY_PORT + 1}`;
    wsClient = new WebSocketClient({ url: initialUrl, urlResolver: discoverServerUrl });

    wireStatusHandler();

    wsClient.onMessage(async (message) => {
      await handleServerMessage(message);
    });

    // Connect to WebSocket server (will retry via urlResolver if initial fails)
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

    if (!wsUrl) {
      console.log('[Background] Server not found during init, will retry via WebSocket client');
    }
  })();

  await initializationPromise;
}

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Background] Extension installed');
  await ensureInitialized();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Background] Extension started');
  void ensureInitialized();
});

void ensureInitialized();

// Listen for storage changes (e.g., when user toggles sanitize in popup)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[STORAGE_KEYS.SANITIZE]) {
    shouldSanitize = changes[STORAGE_KEYS.SANITIZE].newValue ?? true;
  }
});

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

    case 'tab_register':
      void ensureInitialized().then(() => {
        const tabId = sender.tab?.id;
        if (!tabId) {
          sendResponse({ success: false });
          return;
        }

        const existingTab = tabs.get(tabId);
        if (!existingTab) {
          createTabEntry(tabId, sender.tab, message.data?.sessionId || crypto.randomUUID());
        } else {
          const updates: Partial<TabInfo> = {};
          if (sender.tab?.url && sender.tab.url !== existingTab.url) {
            updates.url = sender.tab.url;
          }
          if (sender.tab?.title && sender.tab.title !== existingTab.title) {
            updates.title = sender.tab.title;
          }
          if (message.data?.sessionId && existingTab.sessionId !== message.data.sessionId) {
            updates.sessionId = message.data.sessionId;
            updates.lastNavigationAt = Date.now();
          }
          if (Object.keys(updates).length > 0) {
            updateTrackedTab(tabId, updates);
          }
        }

        if (sender.tab?.active) {
          setActiveTabId(tabId);
        }

        sendResponse({ success: true, tabId });
      });
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
          reconnectAttempts: wsClient?.getReconnectAttempts() ?? 0,
          status: wsClient?.getStatus() ?? 'disconnected',
        });
      });
      return true;

    case 'force_reconnect':
      void ensureInitialized().then(() => {
        wsClient?.forceReconnect();
        sendResponse({ success: true });
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
          errorCount: tabErrorCounts.get(tab.id) || 0,
          lastError: tabLastErrors.get(tab.id) || null,
        }));
        sendResponse({ tabs: tabStats });
      });
      return true;

    case 'maintenance_clear':
      void (async () => {
        try {
          await callMaintenanceEndpoint('/maintenance/clear', { method: 'POST', body: {} });
          tabLogCounts.clear();
          tabErrorCounts.clear();
          tabLastErrors.clear();
          recentLogs.length = 0;
          tabRecentLogs.clear();
          updateBadge();
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

    case 'inject_marker':
      void ensureInitialized().then(() => {
        injectMarker();
        sendResponse({ success: true });
      });
      return true;

    case 'get_health_stats':
      void ensureInitialized().then(() => {
        const totalErrors = Array.from(tabErrorCounts.values()).reduce((a, b) => a + b, 0);
        const totalLogs = Array.from(tabLogCounts.values()).reduce((a, b) => a + b, 0);
        const activeTab = activeTabId ? tabs.get(activeTabId) : null;
        const lastError = activeTabId ? tabLastErrors.get(activeTabId) : null;
        const activeTabLogCount = activeTabId ? (tabLogCounts.get(activeTabId) || 0) : 0;
        const activeTabErrorCount = activeTabId ? (tabErrorCounts.get(activeTabId) || 0) : 0;
        sendResponse({
          totalErrors,
          totalLogs,
          activeTabId,
          activeTabTitle: activeTab?.title || null,
          activeTabUrl: activeTab?.url || null,
          lastError,
          activeTabLogCount,
          activeTabErrorCount,
        });
      });
      return true;

    case 'get_recent_logs':
      void ensureInitialized().then(() => {
        const targetTabId = message.tabId;
        if (targetTabId) {
          sendResponse({ logs: tabRecentLogs.get(targetTabId) || [] });
        } else {
          sendResponse({ logs: recentLogs });
        }
      });
      return true;

    case 'set_focus_mode':
      void (async () => {
        focusActiveTabOnly = message.enabled ?? false;
        await chrome.storage.local.set({ [STORAGE_KEYS.FOCUS_ACTIVE_TAB]: focusActiveTabOnly });
        sendResponse({ enabled: focusActiveTabOnly });
      })();
      return true;

    case 'get_focus_mode':
      sendResponse({ enabled: focusActiveTabOnly });
      return true;
  }
});

function handleConsoleLog(log: LogMessage, sender: chrome.runtime.MessageSender): void {
  const tabId = sender.tab?.id;
  if (!tabId) {
    return;
  }

  // Focus mode: ignore logs from non-active tabs
  if (focusActiveTabOnly && tabId !== activeTabId) {
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

  tabLogCounts.set(tabId, (tabLogCounts.get(tabId) || 0) + 1);

  if (log.level === 'error') {
    tabErrorCounts.set(tabId, (tabErrorCounts.get(tabId) || 0) + 1);
    tabLastErrors.set(tabId, log.message);
  }

  if (activeTabId === tabId) {
    updateBadge();
  }

  let logWithTabId: LogMessage = {
    ...log,
    tabId,
  };

  if (shouldSanitize) {
    logWithTabId = sanitizer.sanitize(logWithTabId);
  }

  recentLogs.push(logWithTabId);
  if (recentLogs.length > RECENT_LOGS_MAX) {
    recentLogs.shift();
  }

  const tabLogs = tabRecentLogs.get(tabId) || [];
  tabLogs.push(logWithTabId);
  if (tabLogs.length > RECENT_LOGS_MAX) {
    tabLogs.shift();
  }
  tabRecentLogs.set(tabId, tabLogs);

  sendOrQueue({
    type: 'log',
    data: logWithTabId,
  });
}

function injectMarker(): void {
  const now = Date.now();
  const markerLog: LogMessage = {
    id: `marker-${now}`,
    timestamp: now,
    level: 'info',
    message: '════════════════ USER MARKER ════════════════',
    args: [],
    tabId: activeTabId ?? -1,
    url: activeTabId ? (tabs.get(activeTabId)?.url ?? '') : '',
    sessionId: activeTabId ? (tabs.get(activeTabId)?.sessionId ?? 'marker') : 'marker',
  };

  recentLogs.push(markerLog);
  if (recentLogs.length > RECENT_LOGS_MAX) {
    recentLogs.shift();
  }

  if (activeTabId && activeTabId !== -1) {
    const tabLogs = tabRecentLogs.get(activeTabId) || [];
    tabLogs.push(markerLog);
    if (tabLogs.length > RECENT_LOGS_MAX) {
      tabLogs.shift();
    }
    tabRecentLogs.set(activeTabId, tabLogs);
  }

  sendOrQueue({
    type: 'inject_marker',
    data: { tabId: markerLog.tabId, marker: markerLog.message },
  });

  // Also send as regular log so it appears in streams
  sendOrQueue({
    type: 'log',
    data: markerLog,
  });
}

async function handleServerMessage(message: any): Promise<void> {
  if (message.type === 'execute_js') {
    const tabId = await resolveTargetTabId(message.data.tabId);
    if (tabId === undefined) {
      sendExecuteResponse(message.data.requestId, { error: 'No target tab found' });
      return;
    }

    await handleExecuteJsCommand(tabId, message);
    return;
  }

  if (message.type === 'get_page_info' || message.type === 'query_dom') {
    const tabId = await resolveTargetTabId(message.data.tabId);
    if (tabId === undefined) {
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
      const response = await chrome.tabs.sendMessage(tabId, message);
      if (response) {
        wsClient?.send(response);
      }
    } catch (error) {
      console.error('[Background] Failed to send command to content script:', error);
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

async function resolveTargetTabId(preferredTabId?: number): Promise<number | undefined> {
  if (preferredTabId) {
    return preferredTabId;
  }
  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTabs[0]?.id;
}

async function handleExecuteJsCommand(tabId: number, message: any): Promise<void> {
  const requestId = message.data.requestId;
  const code = message.data.code;

  const expression = `(async () => {\n${code}\n})()`;

  try {
    await chrome.debugger.attach({ tabId }, '1.3');

    try {
      const response = (await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      })) as {
        result?: { type?: string; value?: unknown; description?: string };
        exceptionDetails?: {
          text?: string;
          exception?: { description?: string; value?: string };
        };
      };

      if (response?.exceptionDetails) {
        const details = response.exceptionDetails;
        const errorMessage =
          details.exception?.description ||
          details.exception?.value ||
          details.text ||
          'JavaScript execution failed';
        sendExecuteResponse(requestId, { error: errorMessage });
        return;
      }

      const result = response?.result?.value ?? response?.result?.description;
      sendExecuteResponse(requestId, { result });
    } finally {
      await chrome.debugger.detach({ tabId }).catch(() => {});
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('Another debugger is already attached')) {
      sendExecuteResponse(requestId, {
        error:
          'Cannot execute: DevTools or another debugger is attached to this tab. Close DevTools and retry.',
      });
      return;
    }

    sendExecuteResponse(requestId, { error: errorMessage });
  }
}

function sendExecuteResponse(
  requestId: string,
  payload: { result?: unknown; error?: string },
): void {
  wsClient?.send({
    type: 'execute_js_response',
    data: {
      requestId,
      result: payload.result,
      error: payload.error,
    },
  } as any);
}

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
  tabErrorCounts.delete(tabId);
  tabLastErrors.delete(tabId);
  tabRecentLogs.delete(tabId);
});

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

function wireStatusHandler(): void {
  if (!wsClient) return;
  wsClient.onStatusChange((status) => {
    console.log(`[Background] WebSocket status: ${status}`);
    connectionStatus = status;
    updateBadge();
  });
}

wireStatusHandler();

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
