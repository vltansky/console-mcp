/**
 * Bridge Client
 *
 * HTTP client for MCP servers to communicate with the standalone bridge server.
 * Enables multiple MCP instances to share the same bridge.
 */

import type {
  DomSnapshotNode,
  FilterOptions,
  LogMessage,
  NetworkEntry,
  NetworkFilterOptions,
  TabInfo,
} from 'console-bridge-shared';

export interface BridgeClientConfig {
  discoveryPort?: number;
  host?: string;
}

export class BridgeClient {
  private readonly baseUrl: string;

  constructor(config: BridgeClientConfig = {}) {
    const port = config.discoveryPort ?? 9846;
    const host = config.host ?? 'localhost';
    this.baseUrl = `http://${host}:${port}`;
  }

  /**
   * Check if the bridge server is running
   */
  async isRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/discover`, {
        method: 'GET',
        signal: AbortSignal.timeout(1000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get bridge server discovery info
   */
  async discover(): Promise<{
    identifier: string;
    serverId: string;
    wsPort: number;
    wsHost: string;
    wsUrl: string;
  } | null> {
    try {
      const response = await fetch(`${this.baseUrl}/discover`);
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  /**
   * Get connected tabs
   */
  async getTabs(): Promise<{ tabs: TabInfo[]; connectionCount: number }> {
    const response = await fetch(`${this.baseUrl}/api/tabs`);
    if (!response.ok) {
      throw new Error(`Failed to get tabs: ${response.statusText}`);
    }
    return await response.json();
  }

  /**
   * Query logs from the bridge
   */
  async getLogs(filter?: FilterOptions): Promise<{ logs: LogMessage[]; count: number }> {
    const response = await fetch(`${this.baseUrl}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter }),
    });
    if (!response.ok) {
      throw new Error(`Failed to get logs: ${response.statusText}`);
    }
    return await response.json();
  }

  /**
   * Search logs
   */
  async searchLogs(options: {
    action: 'regex' | 'keywords';
    pattern?: string;
    keywords?: string[];
    filter?: FilterOptions;
    caseSensitive?: boolean;
    fields?: string[];
    contextLines?: number;
    logic?: 'AND' | 'OR';
    exclude?: string[];
  }): Promise<{ results: LogMessage[]; count: number }> {
    const response = await fetch(`${this.baseUrl}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    if (!response.ok) {
      throw new Error(`Failed to search logs: ${response.statusText}`);
    }
    return await response.json();
  }

  /**
   * Query network entries from the bridge
   */
  async getNetwork(options?: {
    action?: 'list' | 'slow' | 'errors';
    filter?: NetworkFilterOptions;
    minDuration?: number;
  }): Promise<{ entries: NetworkEntry[]; count: number }> {
    const response = await fetch(`${this.baseUrl}/api/network`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options ?? {}),
    });
    if (!response.ok) {
      throw new Error(`Failed to get network entries: ${response.statusText}`);
    }
    return await response.json();
  }

  /**
   * Execute JavaScript in browser
   */
  async executeJS(code: string, tabId?: number): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, tabId }),
    });
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }
    return data.result;
  }

  /**
   * Query DOM elements
   */
  async queryDOM(
    selector: string,
    tabId?: number,
    properties?: string[],
  ): Promise<Array<{ selector: string; properties: Record<string, unknown> }>> {
    const response = await fetch(`${this.baseUrl}/api/query-dom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector, tabId, properties }),
    });
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }
    return data.elements;
  }

  /**
   * Get DOM snapshot
   */
  async getDomSnapshot(tabId?: number): Promise<DomSnapshotNode | null> {
    const response = await fetch(`${this.baseUrl}/api/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tabId }),
    });
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }
    return data.snapshot;
  }

  /**
   * Clear logs
   */
  async clearLogs(args?: { tabId?: number; before?: string }): Promise<void> {
    const response = await fetch(`${this.baseUrl}/maintenance/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args ?? {}),
    });
    if (!response.ok) {
      throw new Error(`Failed to clear logs: ${response.statusText}`);
    }
  }

  /**
   * Get stats
   */
  async getStats(): Promise<{
    logs: { total: number; byLevel: Record<string, number> };
    network: { total: number };
    tabs: TabInfo[];
    connections: number;
  }> {
    const response = await fetch(`${this.baseUrl}/maintenance/stats`);
    if (!response.ok) {
      throw new Error(`Failed to get stats: ${response.statusText}`);
    }
    return await response.json();
  }
}
