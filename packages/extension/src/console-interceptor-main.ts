// This script runs in the MAIN world (page context) to intercept console calls and network performance
// It communicates with the content script via window.postMessage

(function () {
  if ((window as any).__consoleMcpInstalled) return;
  (window as any).__consoleMcpInstalled = true;

  const SOURCE = 'console-mcp';
  const NETWORK_SOURCE = 'console-mcp-network';
  const levels = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const originals: Record<string, (...args: unknown[]) => void> = {};
  const processedEntries = new Set<string>();

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
      '*',
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
      event.error?.stack,
    );
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message =
      'Unhandled Promise Rejection: ' + (reason instanceof Error ? reason.message : String(reason));
    sendLog(
      'error',
      [message, serializeArg(reason)],
      reason instanceof Error ? reason.stack : undefined,
    );
  });

  // ─────────────────────────────────────────────────────────────
  // Network Performance Interception
  // ─────────────────────────────────────────────────────────────

  type InitiatorType =
    | 'fetch'
    | 'xmlhttprequest'
    | 'script'
    | 'link'
    | 'css'
    | 'img'
    | 'image'
    | 'font'
    | 'audio'
    | 'video'
    | 'beacon'
    | 'other';

  interface ExtendedResourceTiming extends PerformanceResourceTiming {
    responseStatus?: number;
    renderBlockingStatus?: 'blocking' | 'non-blocking';
  }

  function normalizeInitiatorType(raw: string): InitiatorType {
    const normalized = raw.toLowerCase();
    const validTypes: InitiatorType[] = [
      'fetch',
      'xmlhttprequest',
      'script',
      'link',
      'css',
      'img',
      'image',
      'font',
      'audio',
      'video',
      'beacon',
    ];
    return validTypes.includes(normalized as InitiatorType)
      ? (normalized as InitiatorType)
      : 'other';
  }

  function sanitizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.search = '';
      const sanitizedPath = parsed.pathname.replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        '_UUID_',
      );
      parsed.pathname = sanitizedPath;
      return parsed.toString();
    } catch {
      return url;
    }
  }

  function isErrorResponse(entry: ExtendedResourceTiming): boolean {
    const status = entry.responseStatus;
    if (status !== undefined) {
      return status >= 400 || status === 0;
    }
    return false;
  }

  function processNetworkEntry(entry: ExtendedResourceTiming): void {
    // Skip beacon requests
    if (entry.initiatorType === 'beacon') return;

    // Deduplicate entries using name + startTime
    const entryKey = `${entry.name}:${entry.startTime}`;
    if (processedEntries.has(entryKey)) return;
    processedEntries.add(entryKey);

    // Limit Set size to prevent memory leak
    if (processedEntries.size > 1000) {
      const iterator = processedEntries.values();
      for (let i = 0; i < 500; i++) {
        const val = iterator.next().value;
        if (val) processedEntries.delete(val);
      }
    }

    const dnsTime =
      entry.domainLookupEnd !== entry.domainLookupStart
        ? Math.ceil(entry.domainLookupEnd - entry.domainLookupStart)
        : undefined;

    const connectionTime =
      entry.connectEnd !== entry.connectStart
        ? Math.ceil(entry.connectEnd - entry.connectStart)
        : undefined;

    const tlsTime =
      entry.secureConnectionStart > 0
        ? Math.ceil(entry.connectEnd - entry.secureConnectionStart)
        : undefined;

    const hasTimingInfo = !(
      entry.requestStart === 0 &&
      entry.responseStart === 0 &&
      entry.transferSize === 0
    );

    let ttfb: number | undefined;
    let downloadTime: number | undefined;
    let stallTime: number | undefined;

    if (hasTimingInfo) {
      ttfb = Math.ceil(entry.responseStart - entry.requestStart);
      downloadTime = Math.ceil(entry.responseEnd - entry.responseStart);
      stallTime = Math.ceil(
        entry.requestStart - entry.startTime - (connectionTime || 0) - (dnsTime || 0),
      );
    }

    const isCached = hasTimingInfo && entry.transferSize === 0 && entry.decodedBodySize > 0;

    window.postMessage(
      {
        source: NETWORK_SOURCE,
        kind: 'network_entry',
        data: {
          id: generateId(),
          timestamp: Date.now(),
          sessionId: SESSION_ID,
          url: sanitizeUrl(entry.name),
          pageUrl: window.location.href,

          duration: Math.ceil(entry.duration),
          dnsTime,
          connectionTime,
          tlsTime,
          ttfb,
          downloadTime,
          stallTime,

          initiatorType: normalizeInitiatorType(entry.initiatorType),
          status: entry.responseStatus,
          size: entry.encodedBodySize || undefined,
          decodedSize: entry.decodedBodySize || undefined,
          headerSize:
            entry.transferSize && entry.encodedBodySize
              ? entry.transferSize - entry.encodedBodySize
              : undefined,
          protocol: (entry as any).nextHopProtocol || undefined,
          cached: isCached || undefined,

          isError: isErrorResponse(entry),
          isBlocking: entry.renderBlockingStatus === 'blocking' || undefined,
        },
      },
      '*',
    );
  }

  // Observe new resource entries
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        processNetworkEntry(entry as ExtendedResourceTiming);
      }
    });
    observer.observe({ entryTypes: ['resource'] });
  } catch {
    // PerformanceObserver not supported
  }

  // Process entries that existed before observer was set up
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => {
      const entries = performance.getEntriesByType('resource') as ExtendedResourceTiming[];
      for (const entry of entries) {
        processNetworkEntry(entry);
      }
    });
  } else {
    setTimeout(() => {
      const entries = performance.getEntriesByType('resource') as ExtendedResourceTiming[];
      for (const entry of entries) {
        processNetworkEntry(entry);
      }
    }, 0);
  }
})();
