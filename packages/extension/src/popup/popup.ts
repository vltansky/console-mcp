// DOM elements
const statusIndicator = document.getElementById('status-indicator')!;
const statusText = document.getElementById('status-text')!;
const toggleBtn = document.getElementById('toggle-btn')!;
const toggleText = document.getElementById('toggle-text')!;
const clearBtn = document.getElementById('clear-btn')!;
const totalLogsEl = document.getElementById('total-logs')!;
const activeTabsEl = document.getElementById('active-tabs')!;
const queuedLogsEl = document.getElementById('queued-logs')!;
const tabsList = document.getElementById('tabs-list')!;
const sanitizeCheckbox = document.getElementById(
  'sanitize-checkbox',
) as HTMLInputElement;
const captureErrorsCheckbox = document.getElementById(
  'capture-errors-checkbox',
) as HTMLInputElement;

// Update status display
function updateStatus(
  status: 'connected' | 'disconnected' | 'reconnecting',
): void {
  statusIndicator.className = `status-indicator ${status}`;

  switch (status) {
    case 'connected':
      statusText.textContent = 'Connected';
      break;
    case 'disconnected':
      statusText.textContent = 'Disconnected';
      break;
    case 'reconnecting':
      statusText.textContent = 'Reconnecting...';
      break;
  }
}

// Update stats
async function updateStats(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get_status' });

    if (response.enabled) {
      toggleBtn.classList.remove('disabled');
      toggleText.textContent = 'Disable';
    } else {
      toggleBtn.classList.add('disabled');
      toggleText.textContent = 'Enable';
    }

    queuedLogsEl.textContent = response.queueLength.toString();

    if (response.connected) {
      updateStatus('connected');
    } else {
      updateStatus('disconnected');
    }
  } catch (error) {
    console.error('Failed to get status:', error);
  }
}

// Update tabs list
async function updateTabs(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get_tabs' });
    const tabs = response.tabs || [];

    activeTabsEl.textContent = tabs.length.toString();

    let totalLogs = 0;
    for (const tab of tabs) {
      totalLogs += tab.logCount || 0;
    }
    totalLogsEl.textContent = totalLogs.toString();

    // Render tabs
    if (tabs.length === 0) {
      tabsList.innerHTML = '<p class="empty-state">No active tabs</p>';
    } else {
      tabsList.innerHTML = tabs
        .map(
          (tab: any) => `
        <div class="tab-item">
          <div class="tab-info">
            <div class="tab-title">${escapeHtml(tab.title || 'Untitled')}</div>
            <div class="tab-url">${escapeHtml(tab.url || '')}</div>
          </div>
          <div class="tab-logs">${tab.logCount || 0} logs</div>
        </div>
      `,
        )
        .join('');
    }
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

// Clear logs (this would need to be implemented on the server side)
clearBtn.addEventListener('click', async () => {
  if (confirm('Are you sure you want to clear all logs?')) {
    // TODO: Implement clear logs functionality
    console.log('Clear logs requested');
  }
});

// Load settings
async function loadSettings(): Promise<void> {
  const settings = await chrome.storage.local.get([
    'console_mcp_sanitize',
    'console_mcp_capture_errors',
  ]);

  sanitizeCheckbox.checked = settings.console_mcp_sanitize || false;
  captureErrorsCheckbox.checked =
    settings.console_mcp_capture_errors !== false;
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
