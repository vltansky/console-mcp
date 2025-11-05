import { interceptConsole } from './lib/console-interceptor';
import type { LogMessage } from '@console-mcp/shared';

// Install console interceptor
interceptConsole((logData: LogMessage) => {
  // Send log to background script
  chrome.runtime.sendMessage({
    type: 'console_log',
    data: logData,
  }).catch((error) => {
    // Silently fail if background script is not available
    // This can happen during extension reload
    if (process.env.NODE_ENV === 'development') {
      console.debug('[Content Script] Failed to send log:', error);
    }
  });
});

console.log('[Console MCP] Content script initialized');
