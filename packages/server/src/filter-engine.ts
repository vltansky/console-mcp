import type { FilterOptions, LogMessage } from 'console-bridge-shared';

export interface CompiledFilter {
  options: FilterOptions;
  urlRegex?: RegExp;
  afterTs?: number;
  beforeTs?: number;
}

export class FilterEngine {
  compileFilter(options: FilterOptions): CompiledFilter {
    return {
      options,
      urlRegex: options.urlPattern ? new RegExp(options.urlPattern) : undefined,
      afterTs: options.after ? this.parseTime(options.after) : undefined,
      beforeTs: options.before ? this.parseTime(options.before) : undefined,
    };
  }

  filter(logs: LogMessage[], options: FilterOptions): LogMessage[] {
    const compiled = this.compileFilter(options);
    return logs.filter((log) => this.matchesCompiledFilter(log, compiled));
  }

  matchesFilter(log: LogMessage, filter: FilterOptions): boolean {
    return this.matchesCompiledFilter(log, this.compileFilter(filter));
  }

  matchesCompiledFilter(log: LogMessage, compiled: CompiledFilter): boolean {
    const { options, urlRegex, afterTs, beforeTs } = compiled;

    if (options.levels?.length && !options.levels.includes(log.level)) {
      return false;
    }

    if (afterTs !== undefined && log.timestamp < afterTs) {
      return false;
    }

    if (beforeTs !== undefined && log.timestamp > beforeTs) {
      return false;
    }

    if (urlRegex && !urlRegex.test(log.url)) {
      return false;
    }

    if (options.tabId !== undefined && log.tabId !== options.tabId) {
      return false;
    }

    if (options.sessionId && log.sessionId !== options.sessionId) {
      return false;
    }

    return true;
  }

  private parseTime(time: string): number {
    // Handle relative time (e.g., "5m", "1h", "24h")
    const relativeMatch = time.match(/^(\d+)([mh])$/);
    if (relativeMatch) {
      const value = Number.parseInt(relativeMatch[1]);
      const unit = relativeMatch[2];
      const multiplier = unit === 'h' ? 3600000 : 60000;
      return Date.now() - value * multiplier;
    }

    // Handle ISO timestamp
    return new Date(time).getTime();
  }
}
