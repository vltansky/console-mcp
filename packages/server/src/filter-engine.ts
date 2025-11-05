import type { LogMessage, FilterOptions } from '@console-mcp/shared';

export class FilterEngine {
  filter(logs: LogMessage[], options: FilterOptions): LogMessage[] {
    let filtered = logs;

    // Level filter
    if (options.levels?.length) {
      filtered = filtered.filter((log) => options.levels!.includes(log.level));
    }

    // Time filter - after
    if (options.after) {
      const after = this.parseTime(options.after);
      filtered = filtered.filter((log) => log.timestamp >= after);
    }

    // Time filter - before
    if (options.before) {
      const before = this.parseTime(options.before);
      filtered = filtered.filter((log) => log.timestamp <= before);
    }

    // URL filter
    if (options.urlPattern) {
      const regex = new RegExp(options.urlPattern);
      filtered = filtered.filter((log) => regex.test(log.url));
    }

    // Tab filter
    if (options.tabId !== undefined) {
      filtered = filtered.filter((log) => log.tabId === options.tabId);
    }

    // Session filter
    if (options.sessionId) {
      filtered = filtered.filter((log) => log.sessionId === options.sessionId);
    }

    return filtered;
  }

  matchesFilter(log: LogMessage, filter: FilterOptions): boolean {
    // Level check
    if (filter.levels?.length && !filter.levels.includes(log.level)) {
      return false;
    }

    // Time check - after
    if (filter.after) {
      const after = this.parseTime(filter.after);
      if (log.timestamp < after) {
        return false;
      }
    }

    // Time check - before
    if (filter.before) {
      const before = this.parseTime(filter.before);
      if (log.timestamp > before) {
        return false;
      }
    }

    // URL check
    if (filter.urlPattern) {
      const regex = new RegExp(filter.urlPattern);
      if (!regex.test(log.url)) {
        return false;
      }
    }

    // Tab check
    if (filter.tabId !== undefined && log.tabId !== filter.tabId) {
      return false;
    }

    // Session check
    if (filter.sessionId && log.sessionId !== filter.sessionId) {
      return false;
    }

    return true;
  }

  private parseTime(time: string): number {
    // Handle relative time (e.g., "5m", "1h", "24h")
    const relativeMatch = time.match(/^(\d+)([mh])$/);
    if (relativeMatch) {
      const value = parseInt(relativeMatch[1]);
      const unit = relativeMatch[2];
      const multiplier = unit === 'h' ? 3600000 : 60000;
      return Date.now() - value * multiplier;
    }

    // Handle ISO timestamp
    return new Date(time).getTime();
  }
}
