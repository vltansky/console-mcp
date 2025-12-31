import { createDiscoveryServer } from './discovery-server.js';
import { LogStorage } from './log-storage.js';
import { McpServer } from './mcp-server.js';
import { NetworkStorage } from './network-storage.js';
import { ConsoleWebSocketServer } from './websocket-server.js';

// Configuration from environment variables
const logTtlMinutesRaw = process.env.CONSOLE_MCP_LOG_TTL_MINUTES;
const parsedLogTtl = logTtlMinutesRaw ? Number.parseInt(logTtlMinutesRaw) : 60;

const config = {
  wsPort: Number.parseInt(process.env.CONSOLE_MCP_PORT || '9847'),
  maxLogs: Number.parseInt(process.env.CONSOLE_MCP_MAX_LOGS || '10000'),
  maxNetworkEntries: Number.parseInt(process.env.CONSOLE_MCP_MAX_NETWORK || '10000'),
  sanitizeLogs: false, // Sanitization is controlled by the extension, not the server
  discoveryPort: Number.parseInt(process.env.CONSOLE_MCP_DISCOVERY_PORT || '9846'),
  logTtlMinutes: Number.isFinite(parsedLogTtl) ? parsedLogTtl : 60,
};

async function main() {
  // Initialize log storage
  const ttlMs =
    Number.isFinite(config.logTtlMinutes) && config.logTtlMinutes > 0
      ? config.logTtlMinutes * 60 * 1000
      : undefined;
  const storage = new LogStorage({ maxLogs: config.maxLogs, ttlMs });

  // Initialize network storage
  const networkStorage = new NetworkStorage({ maxEntries: config.maxNetworkEntries, ttlMs });

  // Start WebSocket server
  const wsServer = new ConsoleWebSocketServer(storage, networkStorage, {
    port: config.wsPort,
    host: 'localhost',
  });

  // Start MCP server
  const mcpServer = new McpServer(storage, networkStorage, wsServer);

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
}

// Start the server
await main();
