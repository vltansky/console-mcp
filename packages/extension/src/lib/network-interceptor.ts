import type { InitiatorType, NetworkEntry } from 'console-bridge-shared';

let sessionId: string | null = null;
let tabId: number | null = null;

function getSessionId(): string {
  if (!sessionId) {
    sessionId = crypto.randomUUID();
  }
  return sessionId;
}

async function getTabId(): Promise<number> {
  if (tabId !== null) {
    return tabId;
  }

  try {
    const response = await chrome.runtime.sendMessage({ type: 'get_tab_id' });
    tabId = response.tabId || -1;
  } catch {
    tabId = -1;
  }

  return tabId;
}

// Reset session on navigation
export function resetNetworkSession(): void {
  sessionId = null;
}

// Map raw initiatorType to our typed enum
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
  return validTypes.includes(normalized as InitiatorType) ? (normalized as InitiatorType) : 'other';
}

// Strip query params and replace UUIDs for privacy (similar to Wix approach)
function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove query params
    parsed.search = '';
    // Replace UUIDs in path
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

// Check if this is an error response
function isErrorResponse(entry: PerformanceResourceTiming): boolean {
  const status = (entry as any).responseStatus;
  if (status !== undefined) {
    // 4xx, 5xx, or 0 (CORS/network failure)
    return status >= 400 || status === 0;
  }
  // If responseStatus not available, can't determine
  return false;
}

// Extended PerformanceResourceTiming with newer properties
interface ExtendedResourceTiming extends PerformanceResourceTiming {
  responseStatus?: number;
  renderBlockingStatus?: 'blocking' | 'non-blocking';
}

export function interceptNetwork(onEntry: (data: NetworkEntry) => void): void {
  // Process a performance entry
  const processEntry = async (entry: ExtendedResourceTiming) => {
    // Skip beacon requests (telemetry)
    if (entry.initiatorType === 'beacon') {
      return;
    }

    const currentTabId = await getTabId();

    // Calculate timing breakdown
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

    // Check if timing info is available (Timing-Allow-Origin header required for cross-origin)
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

    const networkEntry: NetworkEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      tabId: currentTabId,
      sessionId: getSessionId(),
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
    };

    onEntry(networkEntry);
  };

  // Set up PerformanceObserver for new entries
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      processEntry(entry as ExtendedResourceTiming);
    }
  });

  observer.observe({ entryTypes: ['resource'] });

  // Process entries that were captured before the observer was set up
  requestIdleCallback(() => {
    const existingEntries = performance.getEntriesByType('resource') as ExtendedResourceTiming[];
    for (const entry of existingEntries) {
      processEntry(entry);
    }
  });
}
