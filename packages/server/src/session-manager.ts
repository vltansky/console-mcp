import type { LogMessage, Session } from '@console-mcp/shared';
import { randomUUID } from 'crypto';

export class SessionManager {
  private sessions = new Map<string, Session>();

  save(logs: LogMessage[], name?: string): string {
    const sessionId = randomUUID();
    const tabs = [...new Set(logs.map((l) => l.tabId))];

    const session: Session = {
      id: sessionId,
      startTime: logs[0]?.timestamp || Date.now(),
      endTime: logs[logs.length - 1]?.timestamp || Date.now(),
      logCount: logs.length,
      tabs,
      logs,
    };

    this.sessions.set(sessionId, session);
    console.log(
      `[SessionManager] Saved session ${sessionId} (${logs.length} logs)`,
    );
    return sessionId;
  }

  load(sessionId: string): LogMessage[] | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    return session.logs;
  }

  get(sessionId: string): Session | null {
    return this.sessions.get(sessionId) || null;
  }

  list(): Session[] {
    return Array.from(this.sessions.values()).map((session) => ({
      ...session,
      logs: [], // Don't include logs in list view for performance
    }));
  }

  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  clear(): void {
    this.sessions.clear();
  }

  getCount(): number {
    return this.sessions.size;
  }
}
