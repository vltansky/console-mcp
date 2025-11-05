import type {
  LogMessage,
  SearchParams,
  KeywordSearchParams,
  SearchResult,
  SearchMatch,
} from '@console-mcp/shared';

export class SearchEngine {
  search(logs: LogMessage[], params: SearchParams): SearchResult {
    const regex = new RegExp(
      params.pattern,
      params.caseSensitive ? 'g' : 'gi',
    );

    const matches: SearchMatch[] = [];
    const fields = params.fields || ['message', 'args', 'stack'];
    const limit = params.limit || 100;

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];

      for (const field of fields) {
        const text = this.getFieldText(log, field);
        const match = text.match(regex);

        if (match) {
          matches.push({
            log,
            matchedField: field,
            matchedText: match[0],
            context:
              params.contextLines !== undefined && params.contextLines > 0
                ? this.getContext(logs, i, params.contextLines)
                : undefined,
          });

          if (matches.length >= limit) {
            return { matches, total: matches.length };
          }

          break; // Only count each log once
        }
      }
    }

    return { matches, total: matches.length };
  }

  searchKeywords(
    logs: LogMessage[],
    params: KeywordSearchParams,
  ): SearchResult {
    const limit = params.limit || 100;
    const matches: SearchMatch[] = [];

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      const text = `${log.message} ${JSON.stringify(log.args)}${log.stack ? ` ${log.stack}` : ''}`.toLowerCase();

      // Check if all/any keywords match
      const keywordMatches = params.keywords.map((kw) =>
        text.includes(kw.toLowerCase()),
      );

      let isMatch: boolean;
      if (params.logic === 'OR') {
        isMatch = keywordMatches.some((m) => m);
      } else {
        // Default to AND logic
        isMatch = keywordMatches.every((m) => m);
      }

      // Check exclude keywords
      if (isMatch && params.exclude?.length) {
        const hasExcluded = params.exclude.some((ex) =>
          text.includes(ex.toLowerCase()),
        );
        if (hasExcluded) {
          isMatch = false;
        }
      }

      if (isMatch) {
        matches.push({
          log,
          matchedField: 'message',
          matchedText: log.message.substring(0, 100),
          context: undefined,
        });

        if (matches.length >= limit) {
          break;
        }
      }
    }

    return { matches, total: matches.length };
  }

  private getFieldText(log: LogMessage, field: string): string {
    switch (field) {
      case 'message':
        return log.message;
      case 'args':
        return JSON.stringify(log.args);
      case 'stack':
        return log.stack || '';
      default:
        return '';
    }
  }

  private getContext(
    logs: LogMessage[],
    index: number,
    lines: number,
  ): { before: LogMessage[]; after: LogMessage[] } {
    return {
      before: logs.slice(Math.max(0, index - lines), index),
      after: logs.slice(index + 1, Math.min(logs.length, index + 1 + lines)),
    };
  }
}
