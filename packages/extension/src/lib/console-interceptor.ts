import type { LogMessage, LogLevel } from '@console-mcp/shared';

const levels = ['log', 'info', 'warn', 'error', 'debug'] as const;

let sessionId: string | null = null;
let tabId: number | null = null;

// Generate a unique session ID for this page load
function getSessionId(): string {
  if (!sessionId) {
    sessionId = crypto.randomUUID();
  }
  return sessionId;
}

// Get tab ID from chrome runtime
async function getTabId(): Promise<number> {
  if (tabId !== null) {
    return tabId;
  }

  try {
    const response = await chrome.runtime.sendMessage({ type: 'get_tab_id' });
    tabId = response.tabId || -1;
  } catch (error) {
    tabId = -1;
  }

  return tabId;
}

// Serialize argument to JSON-safe format
function serializeArg(arg: unknown): unknown {
  if (arg === null) return null;
  if (arg === undefined) return undefined;

  try {
    const type = typeof arg;

    switch (type) {
      case 'string':
      case 'number':
      case 'boolean':
        return arg;

      case 'function':
        return `[Function: ${arg.name || 'anonymous'}]`;

      case 'symbol':
        return `[Symbol: ${arg.toString()}]`;

      case 'bigint':
        return `[BigInt: ${arg.toString()}]`;

      case 'object':
        if (arg instanceof Error) {
          return {
            name: arg.name,
            message: arg.message,
            stack: arg.stack,
          };
        }

        if (arg instanceof Date) {
          return arg.toISOString();
        }

        if (arg instanceof RegExp) {
          return arg.toString();
        }

        if (Array.isArray(arg)) {
          return arg.map(serializeArg);
        }

        // Handle DOM elements
        if (arg instanceof Element) {
          return `[Element: ${arg.tagName}#${arg.id || ''}]`;
        }

        // Handle DOM nodes
        if (arg instanceof Node) {
          return `[Node: ${arg.nodeName}]`;
        }

        // Regular objects - avoid circular references
        const seen = new WeakSet();
        const serialize = (obj: any): any => {
          if (obj === null || typeof obj !== 'object') {
            return obj;
          }

          if (seen.has(obj)) {
            return '[Circular]';
          }

          seen.add(obj);

          if (Array.isArray(obj)) {
            return obj.map(serialize);
          }

          const result: Record<string, unknown> = {};
          for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
              try {
                result[key] = serialize(obj[key]);
              } catch {
                result[key] = '[Unserializable]';
              }
            }
          }
          return result;
        };

        return serialize(arg);

      default:
        return String(arg);
    }
  } catch (error) {
    return '[Unserializable]';
  }
}

export function interceptConsole(onLog: (data: LogMessage) => void): void {
  // Store original console methods
  const originals = new Map<LogLevel, any>();

  levels.forEach((level) => {
    originals.set(level, console[level]);

    console[level] = function (...args: unknown[]) {
      // Get the stack trace
      const stack = new Error().stack;

      // Create log message
      getTabId().then((currentTabId) => {
        const logMessage: LogMessage = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          level,
          message: args[0]?.toString() || '',
          args: args.map(serializeArg),
          stack: stack,
          tabId: currentTabId,
          url: window.location.href,
          sessionId: getSessionId(),
        };

        onLog(logMessage);
      });

      // Call original console method
      return originals.get(level)!.apply(console, args);
    };
  });

  // Intercept unhandled errors
  window.addEventListener('error', (event) => {
    getTabId().then((currentTabId) => {
      const logMessage: LogMessage = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        level: 'error',
        message: `Uncaught ${event.error?.name || 'Error'}: ${event.message}`,
        args: [
          serializeArg({
            error: event.error,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
          }),
        ],
        stack: event.error?.stack,
        tabId: currentTabId,
        url: window.location.href,
        sessionId: getSessionId(),
      };

      onLog(logMessage);
    });
  });

  // Intercept unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    getTabId().then((currentTabId) => {
      const logMessage: LogMessage = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        level: 'error',
        message: `Unhandled Promise Rejection: ${event.reason}`,
        args: [serializeArg(event.reason)],
        stack:
          event.reason instanceof Error ? event.reason.stack : undefined,
        tabId: currentTabId,
        url: window.location.href,
        sessionId: getSessionId(),
      };

      onLog(logMessage);
    });
  });

  console.log('[Console MCP] Console interceptor installed');
}
