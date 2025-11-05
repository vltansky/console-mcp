import type { LogMessage, FilterOptions } from '@console-mcp/shared';
import { FilterEngine } from './filter-engine.js';

export interface LogStorageConfig {
  maxLogs?: number;
}

export class LogStorage {
  private logs: LogMessage[] = [];
  private readonly maxLogs: number;
  private readonly filterEngine: FilterEngine;
  private subscribers = new Set<{
    callback: (log: LogMessage) => void;
    filter?: FilterOptions;
  }>();

  // Index for faster lookups by tabId
  private logsByTab = new Map<number, LogMessage[]>();

  constructor(config: LogStorageConfig = {}) {
    this.maxLogs = config.maxLogs ?? 10000;
    this.filterEngine = new FilterEngine();
  }

  add(log: LogMessage): void {
    // Add to main storage (circular buffer)
    this.logs.push(log);
    if (this.logs.length > this.maxLogs) {
      const removed = this.logs.shift();
      // Clean up tab index
      if (removed) {
        const tabLogs = this.logsByTab.get(removed.tabId);
        if (tabLogs) {
          const index = tabLogs.indexOf(removed);
          if (index !== -1) {
            tabLogs.splice(index, 1);
          }
        }
      }
    }

    // Add to tab index
    if (!this.logsByTab.has(log.tabId)) {
      this.logsByTab.set(log.tabId, []);
    }
    this.logsByTab.get(log.tabId)!.push(log);

    // Notify subscribers
    for (const { callback, filter } of this.subscribers) {
      if (!filter || this.filterEngine.matchesFilter(log, filter)) {
        callback(log);
      }
    }
  }

  getAll(filter?: FilterOptions): LogMessage[] {
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
      return;
    }

    this.logs = this.logs.filter((log) => {
      const shouldKeep =
        (filter.tabId !== undefined && log.tabId !== filter.tabId) ||
        (filter.before !== undefined &&
          log.timestamp >= new Date(filter.before).getTime());

      // Update tab index
      if (!shouldKeep) {
        const tabLogs = this.logsByTab.get(log.tabId);
        if (tabLogs) {
          const index = tabLogs.indexOf(log);
          if (index !== -1) {
            tabLogs.splice(index, 1);
          }
        }
      }

      return shouldKeep;
    });
  }

  subscribe(
    callback: (log: LogMessage) => void,
    filter?: FilterOptions,
  ): () => void {
    const subscriber = { callback, filter };
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  getTotalCount(): number {
    return this.logs.length;
  }

  getTabCount(tabId: number): number {
    return this.logsByTab.get(tabId)?.length ?? 0;
  }

  getAllTabs(): number[] {
    return Array.from(this.logsByTab.keys());
  }
}
