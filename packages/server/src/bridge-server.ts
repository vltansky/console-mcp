/**
 * Standalone Bridge Server
 *
 * This server runs as a detached process and handles:
 * - WebSocket connection from browser extension
 * - HTTP discovery/maintenance endpoints
 * - Log and network storage
 *
 * Multiple MCP instances can connect to this bridge via HTTP API.
 */

import { createDiscoveryServer } from './discovery-server.js';
import { LogStorage } from './log-storage.js';
import { NetworkStorage } from './network-storage.js';
import { ConsoleWebSocketServer } from './websocket-server.js';

// Configuration from environment variables
const logTtlMinutesRaw = process.env.CONSOLE_MCP_LOG_TTL_MINUTES;
const parsedLogTtl = logTtlMinutesRaw ? Number.parseInt(logTtlMinutesRaw) : 60;

const config = {
  wsPort: Number.parseInt(process.env.CONSOLE_MCP_PORT || '9847'),
  maxLogs: Number.parseInt(process.env.CONSOLE_MCP_MAX_LOGS || '10000'),
  maxNetworkEntries: Number.parseInt(process.env.CONSOLE_MCP_MAX_NETWORK || '10000'),
  discoveryPort: Number.parseInt(process.env.CONSOLE_MCP_DISCOVERY_PORT || '9846'),
  logTtlMinutes: Number.isFinite(parsedLogTtl) ? parsedLogTtl : 60,
};

// Log to stderr to avoid interfering with any stdio communication
function log(message: string) {
  process.stderr.write(`[Bridge] ${message}\n`);
}

log(`Starting bridge server (PID: ${process.pid})`);
log(`  WebSocket port: ${config.wsPort}`);
log(`  Discovery port: ${config.discoveryPort}`);

// Initialize storage
const ttlMs =
  Number.isFinite(config.logTtlMinutes) && config.logTtlMinutes > 0
    ? config.logTtlMinutes * 60 * 1000
    : undefined;
const storage = new LogStorage({ maxLogs: config.maxLogs, ttlMs });
const networkStorage = new NetworkStorage({ maxEntries: config.maxNetworkEntries, ttlMs });

// Start WebSocket server
const wsServer = new ConsoleWebSocketServer(storage, networkStorage, {
  port: config.wsPort,
  host: 'localhost',
});

// Bridge API for MCP clients
interface BridgeStats {
  logCount: number;
  networkCount: number;
  tabCount: number;
  connectionCount: number;
  uptime: number;
}

const startTime = Date.now();

function getStats(): BridgeStats {
  return {
    logCount: storage.getTotalCount(),
    networkCount: networkStorage.getTotalCount(),
    tabCount: wsServer.getTabs().length,
    connectionCount: wsServer.getConnectionCount(),
    uptime: Date.now() - startTime,
  };
}

// Start HTTP discovery & maintenance server with extended API for MCP clients
const discoveryServer = createDiscoveryServer(
  {
    wsHost: 'localhost',
    wsPort: config.wsPort,
    discoveryPort: config.discoveryPort,
  },
  {
    getStats: () => ({
      logs: {
        total: storage.getTotalCount(),
        byLevel: {} as Record<string, number>,
      },
      network: {
        total: networkStorage.getTotalCount(),
      },
      tabs: wsServer.getTabs(),
      connections: wsServer.getConnectionCount(),
    }),
    clearLogs: (args) => {
      if (args?.tabId) {
        storage.clear({ tabId: args.tabId });
        networkStorage.clear({ tabId: args.tabId });
      } else {
        storage.clear();
        networkStorage.clear();
      }
      return { cleared: true };
    },
    exportLogs: (args) => {
      const logs = storage.getAll(args.filter);
      return { logs, count: logs.length };
    },
  },
  // Extended handlers for MCP bridge communication
  {
    storage,
    networkStorage,
    wsServer,
  },
);
discoveryServer.listen();

log('Bridge server started successfully');

// Write PID file for process management
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const pidFile = join(tmpdir(), 'console-bridge.pid');
writeFileSync(pidFile, process.pid.toString());
log(`PID file written to ${pidFile}`);

// Graceful shutdown
function shutdown() {
  log('Shutting down...');
  wsServer.close();
  discoveryServer.close();

  // Clean up PID file
  if (existsSync(pidFile)) {
    unlinkSync(pidFile);
  }

  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);

// Keep process alive
process.stdin.resume();
