// DOM elements
const statusIndicator = document.getElementById('status-indicator') as HTMLElement;
const statusText = document.getElementById('status-text') as HTMLElement;
const statusContainer = document.getElementById('status-container') as HTMLButtonElement;
const toggleBtn = document.getElementById('toggle-btn') as HTMLButtonElement;
const toggleText = document.getElementById('toggle-text') as HTMLElement;
const activeTabsEl = document.getElementById('active-tabs') as HTMLElement;
const tabsList = document.getElementById('tabs-list') as HTMLElement;
const sanitizeCheckbox = document.getElementById('sanitize-checkbox') as HTMLInputElement;
const captureErrorsCheckbox = document.getElementById(
  'capture-errors-checkbox',
) as HTMLInputElement;
const clearLogsBtn = document.getElementById('clear-logs-btn') as HTMLButtonElement;

let isReconnecting = false;

// Classes for states
const toggleEnabledClasses =
  'bg-accent-primary text-ink-950 hover:bg-accent-primary/90 border-transparent';
const toggleDisabledClasses =
  'bg-ink-800 text-ink-400 hover:bg-ink-700 hover:text-ink-200 border-transparent';

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
      statusText.textContent = reconnectAttempts > 0 ? `Offline (#${reconnectAttempts})` : 'Offline';
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

    if (response.enabled) {
      setToggleState(true);
    } else {
      setToggleState(false);
    }

    const status = response.status || (response.connected ? 'connected' : 'disconnected');
    const attempts = response.reconnectAttempts || 0;
    updateStatus(status, attempts);
  } catch (error) {
    console.error('Failed to get status:', error);
    updateStatus('disconnected');
  }
}

function setToggleState(enabled: boolean): void {
  toggleText.textContent = enabled ? 'Capture Enabled' : 'Capture Disabled';
  toggleBtn.className = `flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all duration-200 ${enabled ? toggleEnabledClasses : toggleDisabledClasses}`;
}

function renderTabs(): void {
  if (!tabsList) {
    return;
  }
  if (cachedTabs.length === 0) {
    tabsList.innerHTML = `
      <div class="flex flex-col items-center justify-center h-full text-ink-500 gap-2 py-4">
        <span class="text-xs">No active tabs connected</span>
      </div>`;
    return;
  }

  tabsList.innerHTML = cachedTabs
    .map(
      (tab: any) => `
        <div class="group flex items-center justify-between p-2.5 rounded-lg border border-transparent hover:bg-ink-800/50 hover:border-ink-800 transition-all cursor-default">
          <div class="flex-1 min-w-0 pr-3">
            <div class="flex items-center gap-2 mb-0.5">
               <div class="font-medium text-xs text-ink-100 truncate" title="${escapeHtml(tab.title || 'Untitled')}">${escapeHtml(tab.title || 'Untitled')}</div>
               ${
                 tab.isActive
                   ? '<span class="h-1.5 w-1.5 rounded-full bg-accent-primary" title="Active"></span>'
                   : ''
               }
            </div>
            <div class="text-[10px] text-ink-500 truncate font-mono" title="${escapeHtml(tab.url || '')}">${escapeHtml(tab.url || '')}</div>
          </div>
          <div class="flex flex-col items-end gap-0.5">
            <span class="text-xs font-bold text-ink-200">${tab.logCount || 0}</span>
            <span class="text-[9px] uppercase tracking-wider text-ink-600">Logs</span>
          </div>
        </div>
      `,
    )
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

// Load settings
async function loadSettings(): Promise<void> {
  const settings = await chrome.storage.local.get([
    'console_mcp_sanitize',
    'console_mcp_capture_errors',
  ]);

  // Default sanitize to true (nullish coalescing: undefined/null -> true)
  sanitizeCheckbox.checked = settings.console_mcp_sanitize ?? true;

  // Persist default to storage if not already set
  if (settings.console_mcp_sanitize === undefined) {
    await chrome.storage.local.set({ console_mcp_sanitize: true });
  }

  captureErrorsCheckbox.checked = settings.console_mcp_capture_errors !== false;
}

// Save settings
sanitizeCheckbox.addEventListener('change', async () => {
  await chrome.storage.local.set({
    console_mcp_sanitize: sanitizeCheckbox.checked,
  });
});

captureErrorsCheckbox.addEventListener('change', async () => {
  await chrome.storage.local.set({
    console_mcp_capture_errors: captureErrorsCheckbox.checked,
  });
});

// Clear logs
if (clearLogsBtn) {
  clearLogsBtn.addEventListener('click', async () => {
    if (!confirm('Clear all logs? This cannot be undone.')) {
      return;
    }

    clearLogsBtn.disabled = true;
    const originalText = clearLogsBtn.textContent;

    try {
      const response = await chrome.runtime.sendMessage({ type: 'maintenance_clear' });
      if (response.error) {
        console.error('Failed to clear logs:', response.error);
        clearLogsBtn.textContent = 'Error';
        setTimeout(() => {
          clearLogsBtn.textContent = originalText;
          clearLogsBtn.disabled = false;
        }, 2000);
      } else {
        clearLogsBtn.textContent = 'Cleared';
        setTimeout(() => {
          clearLogsBtn.textContent = originalText;
          clearLogsBtn.disabled = false;
        }, 1000);
        await updateTabs();
      }
    } catch (error) {
      console.error('Failed to clear logs:', error);
      clearLogsBtn.textContent = 'Error';
      setTimeout(() => {
        clearLogsBtn.textContent = originalText;
        clearLogsBtn.disabled = false;
      }, 2000);
    }
  });
}

// Escape HTML to prevent XSS
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize
async function init(): Promise<void> {
  await loadSettings();
  await updateStats();
  await updateTabs();

  // Refresh periodically
  setInterval(() => {
    updateStats();
    updateTabs();
  }, 2000);
}

init();
