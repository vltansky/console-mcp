import type { LogMessage } from '@console-mcp/shared';

export type ExportFormat = 'json' | 'csv' | 'txt';

export interface ExportOptions {
  format: ExportFormat;
  fields?: Array<keyof LogMessage>;
  prettyPrint?: boolean;
}

export class ExportEngine {
  export(
    logs: LogMessage[],
    format: ExportFormat,
    options: Partial<ExportOptions> = {},
  ): string {
    switch (format) {
      case 'json':
        return this.exportJSON(logs, options);
      case 'csv':
        return this.exportCSV(logs, options);
      case 'txt':
        return this.exportTXT(logs, options);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  private exportJSON(logs: LogMessage[], options: Partial<ExportOptions>): string {
    const data = options.fields
      ? logs.map((log) => this.selectFields(log, options.fields!))
      : logs;

    return JSON.stringify(data, null, options.prettyPrint ? 2 : 0);
  }

  private exportCSV(logs: LogMessage[], options: Partial<ExportOptions>): string {
    const fields = options.fields || [
      'timestamp',
      'level',
      'message',
      'url',
      'tabId',
    ];

    // Header
    const header = fields.join(',');

    // Rows
    const rows = logs.map((log) => {
      return fields
        .map((field) => {
          const value = log[field as keyof LogMessage];
          if (value === undefined || value === null) {
            return '';
          }
          // Escape and quote
          const str = String(value);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        })
        .join(',');
    });

    return [header, ...rows].join('\n');
  }

  private exportTXT(logs: LogMessage[], _options: Partial<ExportOptions>): string {
    return logs
      .map((log) => {
        const timestamp = new Date(log.timestamp).toISOString();
        const level = log.level.toUpperCase().padEnd(5);
        const url = log.url ? ` [${log.url}]` : '';
        return `[${timestamp}] ${level}${url}: ${log.message}`;
      })
      .join('\n');
  }

  private selectFields(
    log: LogMessage,
    fields: Array<keyof LogMessage>,
  ): Partial<LogMessage> {
    const result: Partial<LogMessage> = {};
    for (const field of fields) {
      result[field] = log[field];
    }
    return result;
  }
}
