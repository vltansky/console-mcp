// DOM elements
const statusIndicator = document.getElementById('status-indicator') as HTMLElement;
const statusText = document.getElementById('status-text') as HTMLElement;
const statusContainer = document.getElementById('status-container') as HTMLElement;
const toggleBtn = document.getElementById('toggle-btn') as HTMLButtonElement;
const toggleText = document.getElementById('toggle-text') as HTMLElement;
const activeTabsEl = document.getElementById('active-tabs') as HTMLElement;
const tabsList = document.getElementById('tabs-list') as HTMLElement;
const refreshTabsBtn = document.getElementById('refresh-tabs-btn') as HTMLButtonElement;
const sanitizeCheckbox = document.getElementById('sanitize-checkbox') as HTMLInputElement;
const captureErrorsCheckbox = document.getElementById(
  'capture-errors-checkbox',
) as HTMLInputElement;

// Classes for states
const toggleEnabledClasses =
  'bg-accent-sky text-white shadow-lg shadow-accent-sky/20 hover:bg-accent-sky/90 border-transparent';
const toggleDisabledClasses =
  'bg-ink-800 text-ink-400 hover:bg-ink-700 hover:text-ink-200 border-transparent';

const statusIndicatorClasses = {
  connected: 'bg-accent-mint shadow-[0_0_8px_rgba(52,211,153,0.6)]',
  disconnected: 'bg-accent-rose shadow-[0_0_8px_rgba(251,113,133,0.6)]',
  reconnecting: 'bg-accent-amber shadow-[0_0_8px_rgba(251,191,36,0.6)]',
} as const;

const statusContainerClasses = {
  connected: 'border-accent-mint/20 bg-accent-mint/5',
  disconnected: 'border-accent-rose/20 bg-accent-rose/5',
  reconnecting: 'border-accent-amber/20 bg-accent-amber/5',
} as const;

const statusTextClasses = {
  connected: 'text-accent-mint',
  disconnected: 'text-accent-rose',
  reconnecting: 'text-accent-amber',
} as const;

let cachedTabs: any[] = [];

// Update status display
function updateStatus(status: 'connected' | 'disconnected' | 'reconnecting'): void {
  statusIndicator.className = `h-2 w-2 rounded-full transition-all ${statusIndicatorClasses[status]}`;

  if (statusContainer) {
    statusContainer.className = `flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors duration-300 ${statusContainerClasses[status]}`;
  }

  if (statusText) {
    statusText.className = `text-[10px] font-medium uppercase tracking-wider ${statusTextClasses[status]}`;
  }

  switch (status) {
    case 'connected':
      statusText.textContent = 'Online';
      break;
    case 'disconnected':
      statusText.textContent = 'Offline';
      break;
    case 'reconnecting':
      statusText.textContent = 'Connecting';
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

    if (response.connected) {
      updateStatus('connected');
    } else {
      updateStatus('disconnected');
    }
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
                   ? '<span class="h-1.5 w-1.5 rounded-full bg-accent-mint shadow-[0_0_6px_rgba(52,211,153,0.6)]" title="Active"></span>'
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

if (refreshTabsBtn) {
  refreshTabsBtn.addEventListener('click', async () => {
    refreshTabsBtn.disabled = true;
    const icon = refreshTabsBtn.querySelector('svg');
    if(icon) icon.classList.add('animate-spin');

    try {
      await updateTabs();
    } finally {
      setTimeout(() => {
        refreshTabsBtn.disabled = false;
        if(icon) icon.classList.remove('animate-spin');
      }, 400);
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
