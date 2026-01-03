import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BridgeClient } from './bridge-client.js';
import { BridgeMcpServer } from './mcp-server-bridge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const config = {
  discoveryPort: Number.parseInt(process.env.CONSOLE_MCP_DISCOVERY_PORT || '9846'),
};

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBridge(client: BridgeClient, maxAttempts = 20): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await client.isRunning()) {
      return true;
    }
    await sleep(100);
  }
  return false;
}

function spawnBridgeServer(): void {
  const bridgeServerPath = join(__dirname, 'bridge-server.js');

  const child = spawn(process.execPath, [bridgeServerPath], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      CONSOLE_MCP_DISCOVERY_PORT: config.discoveryPort.toString(),
    },
  });

  child.unref();
}

async function main() {
  const bridgeClient = new BridgeClient({ discoveryPort: config.discoveryPort });

  if (!(await bridgeClient.isRunning())) {
    process.stderr.write('[MCP] Bridge not running, spawning...\n');
    spawnBridgeServer();

    const ready = await waitForBridge(bridgeClient);
    if (!ready) {
      process.stderr.write('[MCP] Failed to start bridge server\n');
      process.exit(1);
    }
    process.stderr.write('[MCP] Bridge server started\n');
  }

  const mcpServer = new BridgeMcpServer(bridgeClient);
  await mcpServer.start();
}

await main();
