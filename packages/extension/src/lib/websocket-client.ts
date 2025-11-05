import type { ExtensionMessage, ServerMessage } from '@console-mcp/shared';

export interface WebSocketClientConfig {
  url: string;
  maxReconnectAttempts?: number;
  batchSize?: number;
  batchInterval?: number;
}

export class WebSocketClient {
  private ws?: WebSocket;
  private reconnectAttempts = 0;
  private messageQueue: ExtensionMessage[] = [];
  private reconnectTimeout?: number;
  private heartbeatInterval?: number;
  private batchTimeout?: number;
  private pendingBatch: ExtensionMessage[] = [];

  private readonly config: Required<WebSocketClientConfig>;
  private onMessageCallback?: (message: ServerMessage) => void;
  private onStatusChangeCallback?: (status: 'connected' | 'disconnected' | 'reconnecting') => void;

  constructor(config: WebSocketClientConfig) {
    this.config = {
      url: config.url,
      maxReconnectAttempts: config.maxReconnectAttempts ?? Infinity,
      batchSize: config.batchSize ?? 50,
      batchInterval: config.batchInterval ?? 100,
    };
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] Already connected');
      return;
    }

    console.log(`[WebSocket] Connecting to ${this.config.url}...`);
    this.updateStatus('reconnecting');

    try {
      this.ws = new WebSocket(this.config.url);

      this.ws.onopen = () => {
        console.log('[WebSocket] Connected');
        this.reconnectAttempts = 0;
        this.updateStatus('connected');
        this.flushQueue();
        this.startHeartbeat();
      };

      this.ws.onclose = (event) => {
        console.log(`[WebSocket] Disconnected: ${event.code} ${event.reason}`);
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
    } catch (error) {
      console.error('[WebSocket] Failed to create connection:', error);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error(
        '[WebSocket] Max reconnection attempts reached, giving up',
      );
      return;
    }

    // Exponential backoff with max 30 seconds
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(
      `[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`,
    );

    this.reconnectTimeout = window.setTimeout(() => {
      this.connect();
    }, delay);
  }

  private flushQueue(): void {
    if (this.messageQueue.length === 0) {
      return;
    }

    console.log(`[WebSocket] Flushing ${this.messageQueue.length} queued messages`);

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()!;
      this.sendImmediate(message);
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
    // Batch log messages for efficiency
    if (message.type === 'log') {
      this.pendingBatch.push(message);

      if (this.pendingBatch.length >= this.config.batchSize) {
        this.flushBatch();
      } else if (!this.batchTimeout) {
        this.batchTimeout = window.setTimeout(() => {
          this.flushBatch();
        }, this.config.batchInterval);
      }
    } else {
      // Send non-log messages immediately
      this.sendImmediate(message);
    }
  }

  private flushBatch(): void {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = undefined;
    }

    if (this.pendingBatch.length === 0) {
      return;
    }

    // Send each message in the batch
    for (const message of this.pendingBatch) {
      this.sendImmediate(message);
    }

    this.pendingBatch = [];
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = window.setInterval(() => {
      this.send({
        type: 'heartbeat',
        data: { timestamp: Date.now() },
      });
    }, 30000); // 30 seconds
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
    this.flushBatch();

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

  getQueueLength(): number {
    return this.messageQueue.length + this.pendingBatch.length;
  }
}
