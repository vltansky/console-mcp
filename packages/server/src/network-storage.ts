import type { InitiatorType, NetworkEntry, NetworkFilterOptions } from 'console-bridge-shared';

export interface NetworkStorageConfig {
  maxEntries?: number;
  ttlMs?: number;
}

export class NetworkStorage {
  private entries: NetworkEntry[] = [];
  private readonly maxEntries: number;
  private readonly ttlMs?: number;

  // Index for faster lookups by tabId
  private entriesByTab = new Map<number, NetworkEntry[]>();
  private latestSessions = new Map<number, { sessionId: string; startedAt: number }>();

  constructor(config: NetworkStorageConfig = {}) {
    this.maxEntries = config.maxEntries ?? 10000;
    this.ttlMs = config.ttlMs;
  }

  add(entry: NetworkEntry): void {
    this.cleanupExpiredEntries();

    // Add to main storage (circular buffer)
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      const removed = this.entries.shift();
      if (removed) {
        this.removeFromTabIndex(removed);
      }
    }

    // Add to tab index
    if (!this.entriesByTab.has(entry.tabId)) {
      this.entriesByTab.set(entry.tabId, []);
    }
    this.entriesByTab.get(entry.tabId)?.push(entry);

    // Track most recent session per tab
    const latestSession = this.latestSessions.get(entry.tabId);
    if (!latestSession || latestSession.sessionId !== entry.sessionId) {
      this.latestSessions.set(entry.tabId, {
        sessionId: entry.sessionId,
        startedAt: entry.timestamp,
      });
    }
  }

  getAll(filter?: NetworkFilterOptions): NetworkEntry[] {
    this.cleanupExpiredEntries();

    if (!filter) {
      return [...this.entries];
    }

    // Optimize: if only filtering by tabId, use index
    if (
      filter.tabId !== undefined &&
      !filter.urlPattern &&
      !filter.initiatorTypes &&
      !filter.minDuration &&
      !filter.maxDuration &&
      filter.isError === undefined &&
      !filter.after &&
      !filter.before &&
      !filter.sessionId
    ) {
      return this.entriesByTab.get(filter.tabId) || [];
    }

    return this.filter(this.entries, filter);
  }

  getSlow(minDuration: number = 300, filter?: NetworkFilterOptions): NetworkEntry[] {
    const entries = this.getAll(filter);
    return entries.filter((e) => e.duration >= minDuration);
  }

  getErrors(filter?: NetworkFilterOptions): NetworkEntry[] {
    const entries = this.getAll(filter);
    return entries.filter((e) => e.isError);
  }

  clear(filter?: { tabId?: number; before?: string }): void {
    if (!filter) {
      this.entries = [];
      this.entriesByTab.clear();
      this.latestSessions.clear();
      return;
    }

    this.entries = this.entries.filter((entry) => {
      const shouldKeep =
        (filter.tabId !== undefined && entry.tabId !== filter.tabId) ||
        (filter.before !== undefined && entry.timestamp >= new Date(filter.before).getTime());

      if (!shouldKeep) {
        this.removeFromTabIndex(entry);
      }

      return shouldKeep;
    });
  }

  getTotalCount(): number {
    this.cleanupExpiredEntries();
    return this.entries.length;
  }

  getTabCount(tabId: number): number {
    this.cleanupExpiredEntries();
    return this.entriesByTab.get(tabId)?.length ?? 0;
  }

  getAllTabs(): number[] {
    this.cleanupExpiredEntries();
    return Array.from(this.entriesByTab.keys());
  }

  getLatestSession(tabId: number): { sessionId: string; startedAt: number } | undefined {
    this.cleanupExpiredEntries();
    return this.latestSessions.get(tabId);
  }

  private filter(entries: NetworkEntry[], filter: NetworkFilterOptions): NetworkEntry[] {
    return entries.filter((entry) => this.matchesFilter(entry, filter));
  }

  private matchesFilter(entry: NetworkEntry, filter: NetworkFilterOptions): boolean {
    // Filter by tabId
    if (filter.tabId !== undefined && entry.tabId !== filter.tabId) {
      return false;
    }

    // Filter by sessionId
    if (filter.sessionId !== undefined && entry.sessionId !== filter.sessionId) {
      return false;
    }

    // Filter by URL pattern
    if (filter.urlPattern) {
      try {
        const regex = new RegExp(filter.urlPattern, 'i');
        if (!regex.test(entry.url) && !regex.test(entry.pageUrl)) {
          return false;
        }
      } catch {
        // Invalid regex, skip
      }
    }

    // Filter by initiator types
    if (filter.initiatorTypes && filter.initiatorTypes.length > 0) {
      if (!filter.initiatorTypes.includes(entry.initiatorType as InitiatorType)) {
        return false;
      }
    }

    // Filter by duration
    if (filter.minDuration !== undefined && entry.duration < filter.minDuration) {
      return false;
    }

    if (filter.maxDuration !== undefined && entry.duration > filter.maxDuration) {
      return false;
    }

    // Filter by error status
    if (filter.isError !== undefined && entry.isError !== filter.isError) {
      return false;
    }

    // Filter by time range
    if (filter.after) {
      const afterTime = this.parseTime(filter.after);
      if (afterTime && entry.timestamp < afterTime) {
        return false;
      }
    }

    if (filter.before) {
      const beforeTime = this.parseTime(filter.before);
      if (beforeTime && entry.timestamp > beforeTime) {
        return false;
      }
    }

    return true;
  }

  private parseTime(timeStr: string): number | null {
    // Try relative time format: "5m", "1h", "30s"
    const relativeMatch = timeStr.match(/^(\d+)(s|m|h|d)$/);
    if (relativeMatch) {
      const value = parseInt(relativeMatch[1], 10);
      const unit = relativeMatch[2];
      const multipliers: Record<string, number> = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
      };
      return Date.now() - value * multipliers[unit];
    }

    // Try ISO timestamp
    const timestamp = new Date(timeStr).getTime();
    return isNaN(timestamp) ? null : timestamp;
  }

  private removeFromTabIndex(entry: NetworkEntry): void {
    const tabEntries = this.entriesByTab.get(entry.tabId);
    if (!tabEntries) return;

    // Fast path: entries are typically removed from front (oldest first)
    if (tabEntries[0] === entry) {
      tabEntries.shift();
    } else {
      const index = tabEntries.indexOf(entry);
      if (index !== -1) {
        tabEntries.splice(index, 1);
      }
    }

    if (tabEntries.length === 0) {
      this.entriesByTab.delete(entry.tabId);
      this.latestSessions.delete(entry.tabId);
    }
  }

  private cleanupExpiredEntries(): void {
    if (!this.ttlMs) {
      return;
    }

    const cutoff = Date.now() - this.ttlMs;
    while (this.entries.length > 0 && this.entries[0].timestamp < cutoff) {
      const removed = this.entries.shift();
      if (removed) {
        this.removeFromTabIndex(removed);
      }
    }
  }
}
