import type { FilterOptions, LogMessage } from 'console-logs-mcp-shared';
import { FilterEngine } from './filter-engine.js';

export interface LogStorageConfig {
  maxLogs?: number;
  ttlMs?: number;
}

export class LogStorage {
  private logs: LogMessage[] = [];
  private readonly maxLogs: number;
  private readonly ttlMs?: number;
  private readonly filterEngine: FilterEngine;
  private subscribers = new Set<{
    callback: (log: LogMessage) => void;
    filter?: FilterOptions;
  }>();

  // Index for faster lookups by tabId
  private logsByTab = new Map<number, LogMessage[]>();
  private latestSessions = new Map<number, { sessionId: string; startedAt: number }>();

  constructor(config: LogStorageConfig = {}) {
    this.maxLogs = config.maxLogs ?? 10000;
    this.ttlMs = config.ttlMs;
    this.filterEngine = new FilterEngine();
  }

  add(log: LogMessage): void {
    this.cleanupExpiredLogs();

    // Add to main storage (circular buffer)
    this.logs.push(log);
    if (this.logs.length > this.maxLogs) {
      const removed = this.logs.shift();
      if (removed) {
        this.removeFromTabIndex(removed);
      }
    }

    // Add to tab index
    if (!this.logsByTab.has(log.tabId)) {
      this.logsByTab.set(log.tabId, []);
    }
    this.logsByTab.get(log.tabId)?.push(log);

    // Track most recent session per tab
    const latestSession = this.latestSessions.get(log.tabId);
    if (!latestSession || latestSession.sessionId !== log.sessionId) {
      this.latestSessions.set(log.tabId, { sessionId: log.sessionId, startedAt: log.timestamp });
    }

    // Notify subscribers
    for (const { callback, filter } of this.subscribers) {
      if (!filter || this.filterEngine.matchesFilter(log, filter)) {
        callback(log);
      }
    }
  }

  getAll(filter?: FilterOptions): LogMessage[] {
    this.cleanupExpiredLogs();

    if (!filter) {
      return [...this.logs];
    }

    // Optimize: if only filtering by tabId, use index
    if (
      filter.tabId !== undefined &&
      !filter.levels &&
      !filter.urlPattern &&
      !filter.after &&
      !filter.before &&
      !filter.sessionId
    ) {
      return this.logsByTab.get(filter.tabId) || [];
    }

    return this.filterEngine.filter(this.logs, filter);
  }

  clear(filter?: { tabId?: number; before?: string }): void {
    if (!filter) {
      this.logs = [];
      this.logsByTab.clear();
      this.latestSessions.clear();
      return;
    }

    this.logs = this.logs.filter((log) => {
      const shouldKeep =
        (filter.tabId !== undefined && log.tabId !== filter.tabId) ||
        (filter.before !== undefined && log.timestamp >= new Date(filter.before).getTime());

      // Update tab index
      if (!shouldKeep) {
        this.removeFromTabIndex(log);
      }

      return shouldKeep;
    });
  }

  subscribe(callback: (log: LogMessage) => void, filter?: FilterOptions): () => void {
    const subscriber = { callback, filter };
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  getTotalCount(): number {
    this.cleanupExpiredLogs();
    return this.logs.length;
  }

  getTabCount(tabId: number): number {
    this.cleanupExpiredLogs();
    return this.logsByTab.get(tabId)?.length ?? 0;
  }

  getAllTabs(): number[] {
    this.cleanupExpiredLogs();
    return Array.from(this.logsByTab.keys());
  }

  getLatestSession(tabId: number): { sessionId: string; startedAt: number } | undefined {
    this.cleanupExpiredLogs();
    return this.latestSessions.get(tabId);
  }

  private removeFromTabIndex(log: LogMessage): void {
    const tabLogs = this.logsByTab.get(log.tabId);
    if (tabLogs) {
      const index = tabLogs.indexOf(log);
      if (index !== -1) {
        tabLogs.splice(index, 1);
      }
      if (tabLogs.length === 0) {
        this.logsByTab.delete(log.tabId);
        this.latestSessions.delete(log.tabId);
      }
    }
  }

  private cleanupExpiredLogs(): void {
    if (!this.ttlMs) {
      return;
    }

    const cutoff = Date.now() - this.ttlMs;
    while (this.logs.length > 0 && this.logs[0].timestamp < cutoff) {
      const removed = this.logs.shift();
      if (removed) {
        this.removeFromTabIndex(removed);
      }
    }
  }
}
