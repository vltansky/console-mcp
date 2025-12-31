// DOM elements
const statusIndicator = document.getElementById('status-indicator') as HTMLElement;
const statusText = document.getElementById('status-text') as HTMLElement;
const statusContainer = document.getElementById('status-container') as HTMLButtonElement;
const toggleBtn = document.getElementById('toggle-btn') as HTMLButtonElement;
const activeTabsEl = document.getElementById('active-tabs') as HTMLElement;
const tabsList = document.getElementById('tabs-list') as HTMLElement;
const sanitizeCheckbox = document.getElementById('sanitize-checkbox') as HTMLInputElement;
const clearLogsBtn = document.getElementById('clear-logs-btn') as HTMLButtonElement;
const openInCursorBtn = document.getElementById('analyze-btn') as HTMLButtonElement;
const openInCursorBtnText = document.getElementById('analyze-btn-text') as HTMLElement;
const markBtn = document.getElementById('mark-btn') as HTMLButtonElement;
const copyLogsBtn = document.getElementById('copy-logs-btn') as HTMLButtonElement;
const errorCountEl = document.getElementById('error-count') as HTMLElement;
const logCountEl = document.getElementById('log-count') as HTMLElement;
const lastErrorContainer = document.getElementById('last-error-container') as HTMLElement;
const lastErrorText = document.getElementById('last-error-text') as HTMLElement;
const allClearContainer = document.getElementById('all-clear-container') as HTMLElement;
const healthHud = document.getElementById('health-hud') as HTMLElement;

let isReconnecting = false;

// Status indicator classes
const statusIndicatorClasses = {
  connected: 'bg-accent-primary',
  disconnected: 'bg-accent-error',
  reconnecting: 'bg-accent-warning',
} as const;

const statusContainerClasses = {
  connected: 'border-accent-primary/20 bg-accent-primary/5',
  disconnected: 'border-accent-error/20 bg-accent-error/5',
  reconnecting: 'border-accent-warning/20 bg-accent-warning/5',
} as const;

const statusTextClasses = {
  connected: 'text-accent-primary',
  disconnected: 'text-accent-error',
  reconnecting: 'text-accent-warning',
} as const;

let cachedTabs: any[] = [];
let currentHealthStats: {
  totalErrors: number;
  totalLogs: number;
  activeTabId: number | null;
  activeTabTitle: string | null;
  activeTabUrl: string | null;
  lastError: string | null;
} = {
  totalErrors: 0,
  totalLogs: 0,
  activeTabId: null,
  activeTabTitle: null,
  activeTabUrl: null,
  lastError: null,
};

// Update status display
function updateStatus(
  status: 'connected' | 'disconnected' | 'reconnecting',
  reconnectAttempts = 0,
): void {
  statusIndicator.className = `h-2 w-2 rounded-full transition-all ${statusIndicatorClasses[status]}`;

  const isOffline = status !== 'connected';

  if (statusContainer) {
    statusContainer.className = `flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors duration-300 ${statusContainerClasses[status]} ${isOffline ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`;
    statusContainer.title = isOffline ? 'Click to retry connection' : 'Connected to server';
    statusContainer.disabled = !isOffline || isReconnecting;
  }

  if (statusText) {
    statusText.className = `text-[10px] font-medium uppercase tracking-wider ${statusTextClasses[status]}`;
  }

  switch (status) {
    case 'connected':
      statusText.textContent = 'Online';
      break;
    case 'disconnected':
      statusText.textContent =
        reconnectAttempts > 0 ? `Offline (#${reconnectAttempts})` : 'Offline';
      break;
    case 'reconnecting':
      statusText.textContent = reconnectAttempts > 0 ? `Retry #${reconnectAttempts}` : 'Connecting';
      break;
  }
}

// Update stats
async function updateStats(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get_status' });

    const status = response.status || (response.connected ? 'connected' : 'disconnected');
    const attempts = response.reconnectAttempts || 0;

    setToggleState(response.enabled);
    updateStatus(status, attempts);
  } catch (error) {
    console.error('Failed to get status:', error);
    setToggleState(false);
    updateStatus('disconnected');
  }
}

function setToggleState(enabled: boolean): void {
  if (enabled) {
    toggleBtn.textContent = 'Enabled';
    toggleBtn.className = 'px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider transition-all bg-accent-primary text-ink-950';
  } else {
    toggleBtn.textContent = 'Disabled';
    toggleBtn.className = 'px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider transition-all bg-ink-700 text-ink-400';
  }
}

async function updateHealthStats(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get_health_stats' });
    currentHealthStats = response;

    errorCountEl.textContent = String(response.totalErrors || 0);
    logCountEl.textContent = String(response.totalLogs || 0);

    if (response.totalErrors > 0) {
      // Show error state
      errorCountEl.className = 'text-lg font-bold text-red-400';
      healthHud.className = 'p-3 rounded-xl border transition-all duration-300 border-red-900/50 bg-red-950/20';
      lastErrorContainer.classList.remove('hidden');
      allClearContainer.classList.add('hidden');
      lastErrorText.textContent = response.lastError || 'Unknown error';

      openInCursorBtnText.textContent = `Open in Cursor (${response.totalErrors})`;
      openInCursorBtn.className = 'flex gap-2 justify-center items-center px-4 py-3 text-sm font-semibold text-white bg-red-500 rounded-xl transition-all hover:bg-red-600';
    } else {
      // Show clean state
      errorCountEl.className = 'text-lg font-bold text-emerald-400';
      healthHud.className = 'p-3 rounded-xl border transition-all duration-300 border-ink-800 bg-ink-900/50';
      lastErrorContainer.classList.add('hidden');
      allClearContainer.classList.remove('hidden');

      // Reset analyze button
      openInCursorBtnText.textContent = 'Open in Cursor';
      openInCursorBtn.className = 'flex gap-2 justify-center items-center px-4 py-3 text-sm font-semibold rounded-xl transition-all bg-accent-primary text-ink-950 hover:bg-accent-primary/90';
    }
  } catch (error) {
    console.error('Failed to get health stats:', error);
  }
}

function renderTabs(): void {
  if (!tabsList) {
    return;
  }
  if (cachedTabs.length === 0) {
    tabsList.innerHTML = `
      <div class="flex flex-col gap-2 justify-center items-center py-3 h-full text-ink-500">
        <span class="text-[11px]">No active tabs connected</span>
      </div>`;
    return;
  }

  tabsList.innerHTML = cachedTabs
    .map((tab: any) => {
      const hasErrors = (tab.errorCount || 0) > 0;
      const healthDot = hasErrors
        ? 'bg-red-400'
        : (tab.logCount || 0) > 0
          ? 'bg-emerald-400'
          : 'bg-ink-600';

      return `
        <div class="flex justify-between items-center p-2 rounded-lg border border-transparent transition-all cursor-default group hover:bg-ink-800/50 hover:border-ink-800">
          <div class="flex flex-1 gap-2 items-center min-w-0">
            <span class="h-2 w-2 rounded-full ${healthDot} flex-shrink-0" title="${hasErrors ? 'Has errors' : 'Healthy'}"></span>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5">
                <div class="text-[11px] font-medium truncate text-ink-100" title="${escapeHtml(tab.title || 'Untitled')}">${escapeHtml(tab.title || 'Untitled')}</div>
                ${tab.isActive ? '<span class="text-[8px] text-accent-primary font-bold uppercase">Active</span>' : ''}
              </div>
              <div class="text-[9px] text-ink-500 truncate font-mono" title="${escapeHtml(tab.url || '')}">${escapeHtml(tab.url || '')}</div>
            </div>
          </div>
          <div class="flex flex-shrink-0 gap-2 items-center pl-2">
            ${hasErrors ? `<span class="text-[10px] font-bold text-red-400">${tab.errorCount}</span>` : ''}
            <span class="text-[10px] text-ink-500">${tab.logCount || 0}</span>
          </div>
        </div>
      `;
    })
    .join('');
}

// Update tabs list
async function updateTabs(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get_tabs' });
    cachedTabs = response.tabs || [];

    if (activeTabsEl) {
      activeTabsEl.textContent = cachedTabs.length.toString();
    }

    renderTabs();
  } catch (error) {
    console.error('Failed to get tabs:', error);
  }
}

// Toggle enabled/disabled
toggleBtn.addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'toggle_enabled' });
    await updateStats();
  } catch (error) {
    console.error('Failed to toggle:', error);
  }
});

// Force reconnect when clicking status (only when offline)
statusContainer.addEventListener('click', async () => {
  if (isReconnecting) {
    return;
  }

  try {
    isReconnecting = true;
    statusText.textContent = 'Retrying...';
    statusContainer.disabled = true;

    await chrome.runtime.sendMessage({ type: 'force_reconnect' });

    // Wait a bit then refresh status
    await new Promise((r) => setTimeout(r, 1000));
    await updateStats();
  } catch (error) {
    console.error('Failed to reconnect:', error);
    updateStatus('disconnected');
  } finally {
    isReconnecting = false;
  }
});

openInCursorBtn.addEventListener('click', () => {
  const tabTitle = currentHealthStats.activeTabTitle || 'the active tab';
  const prompt = `Analyze console logs from "${tabTitle}" using console_logs. Summarize activity, flag any errors or warnings, and suggest fixes if needed. If a USER MARKER is present, focus on logs after it.`;

  const encodedPrompt = encodeURIComponent(prompt);
  const deepLink = `https://cursor.com/link/prompt?text=${encodedPrompt}`;

  window.open(deepLink, '_blank');
});

markBtn.addEventListener('click', async () => {
  try {
    markBtn.disabled = true;
    const originalHTML = markBtn.innerHTML;
    markBtn.innerHTML = `
      <svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
      <span>Marking...</span>
    `;

    await chrome.runtime.sendMessage({ type: 'inject_marker' });

    markBtn.innerHTML = `
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
      <span>Marked!</span>
    `;

    setTimeout(() => {
      markBtn.innerHTML = originalHTML;
      markBtn.disabled = false;
    }, 1500);
  } catch (error) {
    console.error('Failed to inject marker:', error);
    markBtn.disabled = false;
  }
});

copyLogsBtn.addEventListener('click', async () => {
  try {
    copyLogsBtn.disabled = true;
    const originalHTML = copyLogsBtn.innerHTML;

    const response = await chrome.runtime.sendMessage({ type: 'get_recent_logs' });
    const logs = response.logs || [];

    if (logs.length === 0) {
      copyLogsBtn.innerHTML = `
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        <span>No logs</span>
      `;
      setTimeout(() => {
        copyLogsBtn.innerHTML = originalHTML;
        copyLogsBtn.disabled = false;
      }, 1500);
      return;
    }

    // Format logs for clipboard
    const formattedLogs = logs.map((log: any) => {
      const ts = new Date(log.timestamp);
      const time = `${ts.getHours().toString().padStart(2, '0')}:${ts.getMinutes().toString().padStart(2, '0')}:${ts.getSeconds().toString().padStart(2, '0')}`;
      return `[${log.level}] ${time} ${log.message}`;
    }).join('\n');

    await navigator.clipboard.writeText(formattedLogs);

    copyLogsBtn.innerHTML = `
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
      <span>Copied ${logs.length}</span>
    `;

    setTimeout(() => {
      copyLogsBtn.innerHTML = originalHTML;
      copyLogsBtn.disabled = false;
    }, 1500);
  } catch (error) {
    console.error('Failed to copy logs:', error);
    copyLogsBtn.disabled = false;
  }
});

async function loadSettings(): Promise<void> {
  const settings = await chrome.storage.local.get(['console_mcp_sanitize']);

  // Default sanitize to true
  sanitizeCheckbox.checked = settings.console_mcp_sanitize ?? true;

  if (settings.console_mcp_sanitize === undefined) {
    await chrome.storage.local.set({ console_mcp_sanitize: true });
  }
}

sanitizeCheckbox.addEventListener('change', async () => {
  await chrome.storage.local.set({ console_mcp_sanitize: sanitizeCheckbox.checked });
});

if (clearLogsBtn) {
  clearLogsBtn.addEventListener('click', async () => {
    if (!confirm('Clear all logs? This cannot be undone.')) {
      return;
    }

    clearLogsBtn.disabled = true;
    const originalHTML = clearLogsBtn.innerHTML;

    try {
      const response = await chrome.runtime.sendMessage({ type: 'maintenance_clear' });
      if (response.error) {
        console.error('Failed to clear logs:', response.error);
        clearLogsBtn.innerHTML = `
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          <span>Error</span>
        `;
        setTimeout(() => {
          clearLogsBtn.innerHTML = originalHTML;
          clearLogsBtn.disabled = false;
        }, 2000);
      } else {
        clearLogsBtn.innerHTML = `
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
          <span>Cleared</span>
        `;
        setTimeout(() => {
          clearLogsBtn.innerHTML = originalHTML;
          clearLogsBtn.disabled = false;
        }, 1000);
        await updateTabs();
        await updateHealthStats();
      }
    } catch (error) {
      console.error('Failed to clear logs:', error);
      clearLogsBtn.innerHTML = originalHTML;
      clearLogsBtn.disabled = false;
    }
  });
}

// Escape HTML to prevent XSS
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function init(): Promise<void> {
  await loadSettings();
  await updateStats();
  await updateHealthStats();
  await updateTabs();

  // Refresh periodically
  setInterval(() => {
    updateStats();
    updateHealthStats();
    updateTabs();
  }, 2000);
}

init();
