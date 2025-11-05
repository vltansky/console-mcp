#!/usr/bin/env node

import { ConsoleWebSocketServer } from './websocket-server.js';
import { LogStorage } from './log-storage.js';
import { McpServer } from './mcp-server.js';

// Configuration from environment variables
const config = {
  wsPort: parseInt(process.env.CONSOLE_MCP_PORT || '3333'),
  maxLogs: parseInt(process.env.CONSOLE_MCP_MAX_LOGS || '10000'),
  sanitizeLogs: process.env.CONSOLE_MCP_SANITIZE_LOGS === 'true',
};

console.error('[Console MCP] Starting server...');
console.error(`[Console MCP] Configuration:`, config);

// Initialize log storage
const storage = new LogStorage({ maxLogs: config.maxLogs });

// Start WebSocket server
const wsServer = new ConsoleWebSocketServer(storage, {
  port: config.wsPort,
  host: 'localhost',
});

// Start MCP server
const mcpServer = new McpServer(storage, wsServer);

// Graceful shutdown
process.on('SIGINT', () => {
  console.error('\n[Console MCP] Shutting down...');
  wsServer.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('\n[Console MCP] Shutting down...');
  wsServer.close();
  process.exit(0);
});

// Start the MCP server
try {
  await mcpServer.start();
} catch (error) {
  console.error('[Console MCP] Failed to start:', error);
  process.exit(1);
}
