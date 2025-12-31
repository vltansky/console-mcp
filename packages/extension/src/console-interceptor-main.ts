// This script runs in the MAIN world (page context) to intercept console calls
// It communicates with the content script via window.postMessage

(function () {
  if ((window as any).__consoleMcpInstalled) return;
  (window as any).__consoleMcpInstalled = true;

  const SOURCE = 'console-mcp';
  const levels = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const originals: Record<string, (...args: unknown[]) => void> = {};

  // Generate session ID for this page load
  const SESSION_ID = generateId();

  function generateId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function serializeArg(arg: unknown, seen?: WeakSet<object>): unknown {
    if (!seen) seen = new WeakSet();
    if (arg === null) return null;
    if (arg === undefined) return undefined;

    const type = typeof arg;
    if (type === 'string' || type === 'number' || type === 'boolean') return arg;
    if (type === 'function')
      return '[Function: ' + ((arg as { name?: string }).name || 'anonymous') + ']';
    if (type === 'symbol') return '[Symbol: ' + (arg as symbol).toString() + ']';
    if (type === 'bigint') return '[BigInt: ' + (arg as bigint).toString() + ']';

    if (type === 'object') {
      try {
        if (arg instanceof Error) {
          return { name: arg.name, message: arg.message, stack: arg.stack };
        }
        if (arg instanceof Date) return arg.toISOString();
        if (arg instanceof RegExp) return arg.toString();
        if (arg instanceof Element)
          return '[Element: ' + arg.tagName + (arg.id ? '#' + arg.id : '') + ']';
        if (arg instanceof Node) return '[Node: ' + arg.nodeName + ']';

        if (seen.has(arg as object)) return '[Circular]';
        seen.add(arg as object);

        if (Array.isArray(arg)) {
          return arg.slice(0, 100).map((item) => serializeArg(item, seen));
        }

        const result: Record<string, unknown> = {};
        const keys = Object.keys(arg as object).slice(0, 50);
        for (const key of keys) {
          try {
            result[key] = serializeArg((arg as Record<string, unknown>)[key], seen);
          } catch {
            result[key] = '[Unserializable]';
          }
        }
        return result;
      } catch {
        return '[Unserializable]';
      }
    }
    return String(arg);
  }

  function sendLog(level: string, args: unknown[], stack?: string): void {
    const message = args.length > 0 ? String(args[0]) : '';
    window.postMessage(
      {
        source: SOURCE,
        kind: 'console_log',
        data: {
          id: generateId(),
          timestamp: Date.now(),
          level,
          message,
          args: args.map((arg) => serializeArg(arg)),
          stack,
          url: window.location.href,
          sessionId: SESSION_ID,
        },
      },
      '*'
    );
  }

  for (const level of levels) {
    originals[level] = console[level];
    console[level] = function (...args: unknown[]) {
      const stack = new Error().stack;
      sendLog(level, args, stack);
      return originals[level].apply(console, args);
    };
  }

  window.addEventListener('error', (event) => {
    sendLog(
      'error',
      [
        'Uncaught ' + (event.error?.name || 'Error') + ': ' + event.message,
        { filename: event.filename, lineno: event.lineno, colno: event.colno },
      ],
      event.error?.stack
    );
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message =
      'Unhandled Promise Rejection: ' +
      (reason instanceof Error ? reason.message : String(reason));
    sendLog('error', [message, serializeArg(reason)], reason instanceof Error ? reason.stack : undefined);
  });
})();
