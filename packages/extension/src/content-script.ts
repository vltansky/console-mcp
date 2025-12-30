import type { LogMessage, ServerMessage, BrowserCommandResponse } from 'console-logs-mcp-shared';
import { interceptConsole } from './lib/console-interceptor';

interface ExecuteResultPayload {
  result?: unknown;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
}

const EXECUTE_SOURCE = 'console-mcp-execute';
const EXECUTE_TIMEOUT_MS = 30_000;
const executeCallbacks = new Map<string, { resolve: (payload: ExecuteResultPayload) => void; timer: number }>();

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data as { source?: string; kind?: string; requestId?: string; payload?: ExecuteResultPayload };
  if (!data || data.source !== EXECUTE_SOURCE || data.kind !== 'execute_js_result' || !data.requestId) {
    return;
  }

  const entry = executeCallbacks.get(data.requestId);
  if (entry) {
    clearTimeout(entry.timer);
    executeCallbacks.delete(data.requestId);
    entry.resolve(data.payload || {});
  }
});

function injectExecuteScript(code: string, requestId: string): void {
  const script = document.createElement('script');
  const escapedCode = code.replace(/<\/script/gi, '<\\/script');
  script.textContent = `
    (async () => {
      const respond = (payload) => {
        window.postMessage({ source: '${EXECUTE_SOURCE}', kind: 'execute_js_result', requestId: ${JSON.stringify(requestId)}, payload }, '*');
      };
      try {
        const result = await (async () => { ${escapedCode} })();
        respond({ result });
      } catch (error) {
        respond({
          error: error instanceof Error
            ? { message: error.message, stack: error.stack, name: error.name }
            : { message: String(error) },
        });
      }
    })();
  `;
  (document.documentElement || document.head)?.appendChild(script);
  script.remove();
}

function executeInPage(code: string, requestId: string): Promise<ExecuteResultPayload> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      executeCallbacks.delete(requestId);
      resolve({ error: { message: 'Execution timed out', name: 'TimeoutError' } });
    }, EXECUTE_TIMEOUT_MS) as unknown as number;

    executeCallbacks.set(requestId, { resolve, timer });

    injectExecuteScript(code, requestId);
  });
}

// Install console interceptor
interceptConsole((logData: LogMessage) => {
  // Send log to background script
  chrome.runtime
    .sendMessage({
      type: 'console_log',
      data: logData,
    })
    .catch((error) => {
      // Silently fail if background script is not available
      // This can happen during extension reload
      if (process.env.NODE_ENV === 'development') {
        console.debug('[Content Script] Failed to send log:', error);
      }
    });
});

// Listen for commands from background script
chrome.runtime.onMessage.addListener((message: ServerMessage, _sender, sendResponse) => {
  handleCommand(message)
    .then((response) => {
      sendResponse(response);
    })
    .catch((error) => {
      sendResponse({
        error: error instanceof Error ? error.message : String(error),
      });
    });

  // Return true to indicate async response
  return true;
});

async function handleCommand(message: ServerMessage): Promise<any> {
  switch (message.type) {
    case 'execute_js': {
      try {
        const payload = await executeInPage(message.data.code, message.data.requestId);

        const response: BrowserCommandResponse = {
          type: 'execute_js_response',
          data: {
            requestId: message.data.requestId,
            result: payload.result,
            error: payload.error?.message,
          },
        };

        return response;
      } catch (error) {
        const response: BrowserCommandResponse = {
          type: 'execute_js_response',
          data: {
            requestId: message.data.requestId,
            error: error instanceof Error ? error.message : String(error),
          },
        };

        return response;
      }
    }

    case 'get_page_info': {
      try {
        const response: BrowserCommandResponse = {
          type: 'page_info_response',
          data: {
            requestId: message.data.requestId,
            title: document.title,
            url: window.location.href,
            html: message.data.includeHtml ? document.documentElement.outerHTML : undefined,
          },
        };

        return response;
      } catch (error) {
        const response: BrowserCommandResponse = {
          type: 'page_info_response',
          data: {
            requestId: message.data.requestId,
            title: '',
            url: '',
            error: error instanceof Error ? error.message : String(error),
          },
        };

        return response;
      }
    }

    case 'query_dom': {
      try {
        const elements = document.querySelectorAll(message.data.selector);
        const defaultProperties = ['textContent', 'className', 'id', 'tagName'];
        const propertiesToExtract = message.data.properties || defaultProperties;

        const results = Array.from(elements).map((element) => {
          const properties: Record<string, unknown> = {};

          for (const prop of propertiesToExtract) {
            try {
              properties[prop] = (element as any)[prop];
            } catch {
              properties[prop] = undefined;
            }
          }

          return {
            selector: message.data.selector,
            properties,
          };
        });

        const response: BrowserCommandResponse = {
          type: 'query_dom_response',
          data: {
            requestId: message.data.requestId,
            elements: results,
          },
        };

        return response;
      } catch (error) {
        const response: BrowserCommandResponse = {
          type: 'query_dom_response',
          data: {
            requestId: message.data.requestId,
            elements: [],
            error: error instanceof Error ? error.message : String(error),
          },
        };

        return response;
      }
    }

    default:
      // Not a command for content script
      return null;
  }
}

console.log('[Console MCP] Content script initialized');
