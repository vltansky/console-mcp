import { LogStorage } from './log-storage.js';
import { McpServer } from './mcp-server.js';
import { ConsoleWebSocketServer } from './websocket-server.js';
import { createDiscoveryServer } from './discovery-server.js';

// Configuration from environment variables
const logTtlMinutesRaw = process.env.CONSOLE_MCP_LOG_TTL_MINUTES;
const parsedLogTtl = logTtlMinutesRaw ? Number.parseInt(logTtlMinutesRaw) : 60;

const config = {
  wsPort: Number.parseInt(process.env.CONSOLE_MCP_PORT || '9847'),
  maxLogs: Number.parseInt(process.env.CONSOLE_MCP_MAX_LOGS || '10000'),
  sanitizeLogs: process.env.CONSOLE_MCP_SANITIZE_LOGS === 'true',
  discoveryPort: Number.parseInt(process.env.CONSOLE_MCP_DISCOVERY_PORT || '9846'),
  logTtlMinutes: Number.isFinite(parsedLogTtl) ? parsedLogTtl : 60,
};

// Initialize log storage
const ttlMs =
  Number.isFinite(config.logTtlMinutes) && config.logTtlMinutes > 0
    ? config.logTtlMinutes * 60 * 1000
    : undefined;
const storage = new LogStorage({ maxLogs: config.maxLogs, ttlMs });

// Start WebSocket server
const wsServer = new ConsoleWebSocketServer(storage, {
  port: config.wsPort,
  host: 'localhost',
});

// Start MCP server
const mcpServer = new McpServer(storage, wsServer);

// Start HTTP discovery & maintenance server
const discoveryServer = createDiscoveryServer(
  {
    wsHost: 'localhost',
    wsPort: config.wsPort,
    discoveryPort: config.discoveryPort,
  },
  {
    getStats: () => mcpServer.getStatsSnapshot(),
    clearLogs: (args) => mcpServer.clearLogs(args),
    exportLogs: (args) => mcpServer.exportLogsSnapshot(args),
  },
);
discoveryServer.listen();

// Graceful shutdown
process.on('SIGINT', () => {
  wsServer.close();
  discoveryServer.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  wsServer.close();
  discoveryServer.close();
  process.exit(0);
});

// Start the MCP server
try {
  await mcpServer.start();
} catch (error) {
  process.exit(1);
}
