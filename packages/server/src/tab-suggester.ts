import type { TabInfo, LogMessage } from 'console-logs-mcp-shared';

export interface TabSuggestion {
  tab: TabInfo;
  score: number;
  reasons: string[];
  logCount: number;
  lastActivity?: number;
}

export interface SuggestionContext {
  urlPatterns?: string[];
  workingDirectory?: string;
  ports?: number[];
  domains?: string[];
}

export class TabSuggester {
  suggestTabs(
    tabs: TabInfo[],
    getLogsForTab: (tabId: number) => LogMessage[],
    context?: SuggestionContext,
  ): TabSuggestion[] {
    const suggestions: TabSuggestion[] = [];

    for (const tab of tabs) {
      const logs = getLogsForTab(tab.id);
      const logCount = logs.length;
      const lastActivity = logs.length > 0 ? Math.max(...logs.map((l) => l.timestamp)) : undefined;

      const score = this.calculateScore(tab, logs, context);
      const reasons = this.generateReasons(tab, logs, context);

      suggestions.push({
        tab,
        score,
        reasons,
        logCount,
        lastActivity,
      });
    }

    return suggestions.sort((a, b) => b.score - a.score);
  }

  private calculateScore(tab: TabInfo, logs: LogMessage[], context?: SuggestionContext): number {
    let score = 0;

    // Base score from log activity
    score += Math.min(logs.length / 10, 20);

    // Recency bonus
    if (logs.length > 0) {
      const lastLogTime = Math.max(...logs.map((l) => l.timestamp));
      const ageMinutes = (Date.now() - lastLogTime) / (1000 * 60);
      if (ageMinutes < 5) {
        score += 30;
      } else if (ageMinutes < 30) {
        score += 15;
      } else if (ageMinutes < 60) {
        score += 5;
      }
    }

    // Context-based scoring
    if (context) {
      // URL pattern matching
      if (context.urlPatterns) {
        for (const pattern of context.urlPatterns) {
          try {
            const regex = new RegExp(pattern, 'i');
            if (regex.test(tab.url)) {
              score += 50;
              break;
            }
          } catch {
            if (tab.url.toLowerCase().includes(pattern.toLowerCase())) {
              score += 50;
              break;
            }
          }
        }
      }

      // Port matching
      if (context.ports) {
        try {
          const url = new URL(tab.url);
          const port = Number.parseInt(url.port || (url.protocol === 'https:' ? '443' : '80'));
          if (context.ports.includes(port)) {
            score += 40;
          }
        } catch {
          // Invalid URL, skip port check
        }
      }

      // Domain matching
      if (context.domains) {
        try {
          const url = new URL(tab.url);
          const hostname = url.hostname;
          for (const domain of context.domains) {
            if (hostname === domain || hostname.endsWith(`.${domain}`)) {
              score += 35;
              break;
            }
          }
        } catch {
          // Invalid URL, skip domain check
        }
      }

      // Working directory hints
      if (context.workingDirectory) {
        const projectName = this.extractProjectName(context.workingDirectory);
        if (projectName && tab.url.toLowerCase().includes(projectName.toLowerCase())) {
          score += 25;
        }
      }
    }

    // Localhost/development server detection
    if (this.isLocalDevelopment(tab.url)) {
      score += 15;
    }

    if (tab.isActive) {
      score += 20;
    }

    return score;
  }

  private generateReasons(tab: TabInfo, logs: LogMessage[], context?: SuggestionContext): string[] {
    const reasons: string[] = [];

    // Activity reasons
    if (logs.length > 0) {
      const lastLogTime = Math.max(...logs.map((l) => l.timestamp));
      const ageMinutes = (Date.now() - lastLogTime) / (1000 * 60);

      if (ageMinutes < 5) {
        reasons.push('Very recent activity (last 5 minutes)');
      } else if (ageMinutes < 30) {
        reasons.push('Recent activity (last 30 minutes)');
      }

      if (logs.length > 50) {
        reasons.push(`High log volume (${logs.length} logs)`);
      } else if (logs.length > 10) {
        reasons.push(`Active logging (${logs.length} logs)`);
      }

      const errorCount = logs.filter((l) => l.level === 'error').length;
      if (errorCount > 0) {
        reasons.push(`Contains ${errorCount} error${errorCount > 1 ? 's' : ''}`);
      }
    }

    if (tab.isActive) {
      reasons.push('Currently active tab');
    }

    if (tab.lastNavigationAt) {
      const minutesSinceNav = (Date.now() - tab.lastNavigationAt) / (1000 * 60);
      if (minutesSinceNav < 5) {
        reasons.push('Fresh navigation (<5 minutes ago)');
      } else if (minutesSinceNav < 30) {
        reasons.push('Navigation occurred within the last 30 minutes');
      }
    } else if (logs.length === 0) {
      reasons.push('No logs captured yet');
    }

    // Context-based reasons
    if (context) {
      if (context.urlPatterns) {
        for (const pattern of context.urlPatterns) {
          try {
            const regex = new RegExp(pattern, 'i');
            if (regex.test(tab.url)) {
              reasons.push(`Matches URL pattern: ${pattern}`);
              break;
            }
          } catch {
            if (tab.url.toLowerCase().includes(pattern.toLowerCase())) {
              reasons.push(`URL contains: ${pattern}`);
              break;
            }
          }
        }
      }

      if (context.ports) {
        try {
          const url = new URL(tab.url);
          const port = Number.parseInt(url.port || (url.protocol === 'https:' ? '443' : '80'));
          if (context.ports.includes(port)) {
            reasons.push(`Matches expected port: ${port}`);
          }
        } catch {
          // Invalid URL
        }
      }

      if (context.domains) {
        try {
          const url = new URL(tab.url);
          const hostname = url.hostname;
          for (const domain of context.domains) {
            if (hostname === domain || hostname.endsWith(`.${domain}`)) {
              reasons.push(`Matches domain: ${domain}`);
              break;
            }
          }
        } catch {
          // Invalid URL
        }
      }

      if (context.workingDirectory) {
        const projectName = this.extractProjectName(context.workingDirectory);
        if (projectName && tab.url.toLowerCase().includes(projectName.toLowerCase())) {
          reasons.push(`URL matches project name: ${projectName}`);
        }
      }
    }

    // Development server detection
    if (this.isLocalDevelopment(tab.url)) {
      reasons.push('Local development server');
    }

    return reasons;
  }

  private isLocalDevelopment(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      return (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '0.0.0.0' ||
        hostname.endsWith('.local') ||
        hostname.match(/^192\.168\.\d+\.\d+$/) !== null ||
        hostname.match(/^10\.\d+\.\d+\.\d+$/) !== null
      );
    } catch {
      return false;
    }
  }

  private extractProjectName(workingDirectory: string): string | null {
    const parts = workingDirectory.split(/[/\\]/);
    return parts[parts.length - 1] || null;
  }

  detectCommonPorts(workingDirectory?: string): number[] {
    const commonPorts = [3000, 3001, 4200, 5000, 5173, 8000, 8080, 8888, 9000];

    if (!workingDirectory) {
      return commonPorts;
    }

    const dir = workingDirectory.toLowerCase();

    if (dir.includes('vite') || dir.includes('vue')) {
      return [5173, ...commonPorts];
    }

    if (dir.includes('next') || dir.includes('react')) {
      return [3000, ...commonPorts];
    }

    if (dir.includes('angular')) {
      return [4200, ...commonPorts];
    }

    if (dir.includes('django') || dir.includes('flask')) {
      return [8000, 5000, ...commonPorts];
    }

    return commonPorts;
  }
}
