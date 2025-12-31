import type { ExtensionMessage, ServerMessage } from 'console-bridge-shared';

export interface WebSocketClientConfig {
  url: string;
  maxReconnectAttempts?: number;
  urlResolver?: () => Promise<string>;
}

export class WebSocketClient {
  private ws?: WebSocket;
  private reconnectAttempts = 0;
  private messageQueue: ExtensionMessage[] = [];
  private reconnectTimeout?: number;
  private heartbeatInterval?: number;

  private readonly config: Required<WebSocketClientConfig>;
  private onMessageCallback?: (message: ServerMessage) => void;
  private onStatusChangeCallback?: (status: 'connected' | 'disconnected' | 'reconnecting') => void;
  private resolvedUrl: string | null = null;

  constructor(config: WebSocketClientConfig) {
    this.config = {
      url: config.url,
      maxReconnectAttempts: config.maxReconnectAttempts ?? Number.POSITIVE_INFINITY,
      urlResolver: config.urlResolver,
    };
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] Already connected');
      return;
    }

    console.log(`[WebSocket] Connecting to ${this.config.url}...`);
    this.updateStatus('reconnecting');

    void this.openConnection();
  }

  private async openConnection(): Promise<void> {
    let url: string;
    try {
      url = await this.resolveUrl();
      console.log(`[WebSocket] Connecting to ${url}...`);
    } catch (error) {
      console.warn('[WebSocket] Server discovery failed, will retry:', error);
      this.updateStatus('disconnected');
      this.scheduleReconnect();
      return;
    }

    try {
      this.ws = new WebSocket(url);
    } catch (error) {
      console.error('[WebSocket] Failed to create WebSocket:', error);
      this.invalidateResolvedUrl();
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log('[WebSocket] Connected');
      this.reconnectAttempts = 0;
      this.updateStatus('connected');
      this.flushQueue();
      this.startHeartbeat();
    };

    this.ws.onclose = (event) => {
      console.log(`[WebSocket] Disconnected: ${event.code} ${event.reason}`);
      this.invalidateResolvedUrl();
      this.updateStatus('disconnected');
      this.stopHeartbeat();
      this.scheduleReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('[WebSocket] Error:', error);
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ServerMessage;
        this.handleMessage(message);
      } catch (error) {
        console.error('[WebSocket] Failed to parse message:', error);
      }
    };
  }

  setUrlResolver(resolver: () => Promise<string>): void {
    this.config.urlResolver = resolver;
    this.invalidateResolvedUrl();
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('[WebSocket] Max reconnection attempts reached, giving up');
      return;
    }

    // Exponential backoff with max 30 seconds
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
    this.reconnectAttempts++;

    console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay) as unknown as number;
  }

  private async resolveUrl(): Promise<string> {
    if (this.resolvedUrl) {
      return this.resolvedUrl;
    }

    if (this.config.urlResolver) {
      this.resolvedUrl = await this.config.urlResolver();
    } else {
      this.resolvedUrl = this.config.url;
    }

    return this.resolvedUrl;
  }

  private invalidateResolvedUrl(): void {
    if (this.config.urlResolver) {
      this.resolvedUrl = null;
    }
  }

  private flushQueue(): void {
    if (this.messageQueue.length === 0) {
      return;
    }

    console.log(`[WebSocket] Flushing ${this.messageQueue.length} queued messages`);

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        this.sendImmediate(message);
      }
    }
  }

  private sendImmediate(message: ExtensionMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('[WebSocket] Failed to send message:', error);
        this.messageQueue.push(message);
      }
    } else {
      this.messageQueue.push(message);
    }
  }

  send(message: ExtensionMessage): void {
    // Send all messages immediately to avoid batching issues in service workers
    this.sendImmediate(message);
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.send({
        type: 'heartbeat',
        data: { timestamp: Date.now() },
      });
    }, 30000) as unknown as number; // 30 seconds
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  private handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'configure':
        console.log('[WebSocket] Received configuration:', message.data);
        // Could update client-side settings here
        break;

      case 'ping':
        // Server is checking if we're alive
        break;
    }

    this.onMessageCallback?.(message);
  }

  private updateStatus(status: 'connected' | 'disconnected' | 'reconnecting'): void {
    this.onStatusChangeCallback?.(status);
  }

  onMessage(callback: (message: ServerMessage) => void): void {
    this.onMessageCallback = callback;
  }

  onStatusChange(callback: (status: 'connected' | 'disconnected' | 'reconnecting') => void): void {
    this.onStatusChangeCallback = callback;
  }

  disconnect(): void {
    console.log('[WebSocket] Disconnecting...');

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
  }

  getStatus(): 'connected' | 'disconnected' | 'reconnecting' {
    if (!this.ws) return 'disconnected';

    switch (this.ws.readyState) {
      case WebSocket.OPEN:
        return 'connected';
      case WebSocket.CONNECTING:
        return 'reconnecting';
      default:
        return 'disconnected';
    }
  }

  /**
   * Validate connection by checking if server is actually reachable.
   * More reliable than getStatus() as it detects server crashes where
   * WebSocket still shows OPEN but server is gone.
   */
  async checkConnection(discoveryPort: number): Promise<boolean> {
    if (this.getStatus() !== 'connected') {
      return false;
    }

    try {
      const response = await fetch(`http://localhost:${discoveryPort}/discover`, {
        method: 'GET',
        signal: AbortSignal.timeout(1000),
      });

      if (!response.ok) {
        this.handleStaleConnection();
        return false;
      }

      return true;
    } catch {
      this.handleStaleConnection();
      return false;
    }
  }

  private handleStaleConnection(): void {
    console.log('[WebSocket] Detected stale connection, forcing reconnect');
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    this.invalidateResolvedUrl();
    this.updateStatus('disconnected');
    this.scheduleReconnect();
  }

  getQueueLength(): number {
    return this.messageQueue.length;
  }

  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  forceReconnect(): void {
    console.log('[WebSocket] Force reconnect requested');

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }

    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }

    this.invalidateResolvedUrl();
    this.reconnectAttempts = 0;
    this.connect();
  }
}
