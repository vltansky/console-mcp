// DOM elements
const statusIndicator = document.getElementById('status-indicator') as HTMLElement;
const statusText = document.getElementById('status-text') as HTMLElement;
const toggleBtn = document.getElementById('toggle-btn') as HTMLButtonElement;
const toggleText = document.getElementById('toggle-text') as HTMLElement;
const totalLogsEl = document.getElementById('total-logs') as HTMLElement;
const activeTabsEl = document.getElementById('active-tabs') as HTMLElement;
const tabsList = document.getElementById('tabs-list') as HTMLElement;
const sanitizeCheckbox = document.getElementById('sanitize-checkbox') as HTMLInputElement;
const captureErrorsCheckbox = document.getElementById(
  'capture-errors-checkbox',
) as HTMLInputElement;
const clearBtn = document.getElementById('clear-btn') as HTMLButtonElement;
const exportJsonBtn = document.getElementById('export-json-btn') as HTMLButtonElement;
const maintenanceStatsEl = document.getElementById('maintenance-stats') as HTMLElement;

// Update status display
function updateStatus(status: 'connected' | 'disconnected' | 'reconnecting'): void {
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

async function refreshMaintenanceStats(): Promise<void> {
  try {
    maintenanceStatsEl.innerHTML = '<p class="empty-state">Loading…</p>';
    const stats = await chrome.runtime.sendMessage({ type: 'maintenance_stats' });
    if (!stats || stats.error) {
      throw new Error(stats?.error || 'No stats returned');
    }
    const rows = [
      { label: 'Total Logs', value: stats.totalLogs },
      { label: 'Active Tabs (server)', value: stats.activeTabs },
      { label: 'Sessions Saved', value: stats.sessions },
    ];

    maintenanceStatsEl.innerHTML = rows
      .map(
        (row) => `
        <div class="maintenance-row">
          <span>${row.label}</span>
          <span>${row.value}</span>
        </div>
      `,
      )
      .join('');
  } catch (error) {
    console.error('Failed to fetch maintenance stats:', error);
    maintenanceStatsEl.innerHTML = '<p class="empty-state">Failed to load</p>';
  }
}

clearBtn.addEventListener('click', async () => {
  if (!confirm('Clear all stored console logs?')) {
    return;
  }
  clearBtn.disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: 'maintenance_clear' });
    await Promise.all([updateTabs(), refreshMaintenanceStats()]);
  } catch (error) {
    console.error('Failed to clear logs:', error);
    alert('Failed to clear logs. Check server status.');
  } finally {
    clearBtn.disabled = false;
  }
});

exportJsonBtn.addEventListener('click', async () => {
  exportJsonBtn.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'maintenance_export',
      format: 'json',
    });
    if (!response || !response.data) {
      throw new Error('Invalid export response');
    }
    downloadText(`console-logs-${Date.now()}.json`, response.data, 'application/json');
  } catch (error) {
    console.error('Failed to export logs:', error);
    alert('Failed to export logs. Check server status.');
  } finally {
    exportJsonBtn.disabled = false;
  }
});

// Load settings
async function loadSettings(): Promise<void> {
  const settings = await chrome.storage.local.get([
    'console_mcp_sanitize',
    'console_mcp_capture_errors',
  ]);

  sanitizeCheckbox.checked = settings.console_mcp_sanitize || false;
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

// Escape HTML to prevent XSS
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function downloadText(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Initialize
async function init(): Promise<void> {
  await loadSettings();
  await updateStats();
  await updateTabs();
  await refreshMaintenanceStats();

  // Refresh periodically
  setInterval(() => {
    updateStats();
    updateTabs();
    refreshMaintenanceStats();
  }, 2000);
}

init();
