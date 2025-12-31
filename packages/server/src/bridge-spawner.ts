/**
 * Bridge Spawner
 *
 * Handles spawning the bridge server as a detached process.
 * Uses a lock mechanism to prevent race conditions.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, openSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const LOCK_FILE = join(tmpdir(), 'console-bridge.lock');
const PID_FILE = join(tmpdir(), 'console-bridge.pid');
const LOG_DIR = join(tmpdir(), 'console-bridge-logs');

// Ensure log directory exists
try {
  mkdirSync(LOG_DIR, { recursive: true });
} catch {
  // Ignore errors
}

function log(message: string) {
  process.stderr.write(`[BridgeSpawner] ${message}\n`);
}

/**
 * Check if bridge server is running via HTTP ping
 */
async function isBridgeRunning(port: number = 9846): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/discover`, {
      method: 'GET',
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if a process with given PID is running
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire a lock file with timeout
 */
function acquireLock(timeoutMs: number = 5000): boolean {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Try to create lock file exclusively
      if (!existsSync(LOCK_FILE)) {
        writeFileSync(LOCK_FILE, process.pid.toString(), { flag: 'wx' });
        return true;
      }

      // Lock exists - check if it's stale
      const lockPid = parseInt(readFileSync(LOCK_FILE, 'utf-8').trim(), 10);
      if (!isProcessRunning(lockPid)) {
        // Stale lock - remove and try again
        unlinkSync(LOCK_FILE);
        continue;
      }

      // Lock is held by another process - wait
      // Use sync sleep to avoid async complexity
      const sleepMs = 100;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleepMs);
    } catch (error) {
      // Error creating lock - another process might have beaten us
      const sleepMs = 50;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleepMs);
    }
  }

  return false;
}

/**
 * Release the lock file
 */
function releaseLock(): void {
  try {
    if (existsSync(LOCK_FILE)) {
      const lockPid = parseInt(readFileSync(LOCK_FILE, 'utf-8').trim(), 10);
      if (lockPid === process.pid) {
        unlinkSync(LOCK_FILE);
      }
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Spawn the bridge server as a detached process
 */
function spawnBridgeServer(): void {
  // Get the path to bridge-server.js
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const bridgeServerPath = join(__dirname, 'bridge-server.js');

  log(`Spawning bridge server from ${bridgeServerPath}`);

  // Create log files
  const outLog = join(LOG_DIR, 'bridge-stdout.log');
  const errLog = join(LOG_DIR, 'bridge-stderr.log');

  const out = openSync(outLog, 'a');
  const err = openSync(errLog, 'a');

  const child = spawn('node', [bridgeServerPath], {
    detached: true,
    stdio: ['ignore', out, err],
    env: {
      ...process.env,
      // Pass through configuration
      CONSOLE_MCP_PORT: process.env.CONSOLE_MCP_PORT || '9847',
      CONSOLE_MCP_DISCOVERY_PORT: process.env.CONSOLE_MCP_DISCOVERY_PORT || '9846',
      CONSOLE_MCP_MAX_LOGS: process.env.CONSOLE_MCP_MAX_LOGS || '10000',
      CONSOLE_MCP_MAX_NETWORK: process.env.CONSOLE_MCP_MAX_NETWORK || '10000',
      CONSOLE_MCP_LOG_TTL_MINUTES: process.env.CONSOLE_MCP_LOG_TTL_MINUTES || '60',
    },
  });

  // Unref so parent can exit
  child.unref();

  log(`Bridge server spawned with PID ${child.pid}`);
  log(`Logs: ${outLog}, ${errLog}`);
}

/**
 * Wait for bridge to be ready
 */
async function waitForBridge(port: number = 9846, timeoutMs: number = 10000): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await isBridgeRunning(port)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return false;
}

/**
 * Ensure bridge server is running
 *
 * 1. Check if bridge is already running
 * 2. If not, acquire lock and spawn it
 * 3. Wait for it to be ready
 */
export async function ensureBridgeRunning(
  discoveryPort: number = 9846,
): Promise<{ alreadyRunning: boolean }> {
  // First check if bridge is already running
  if (await isBridgeRunning(discoveryPort)) {
    log('Bridge server already running');
    return { alreadyRunning: true };
  }

  log('Bridge server not running, attempting to spawn...');

  // Try to acquire lock
  if (!acquireLock()) {
    log('Could not acquire lock, another process is spawning the bridge');
    // Wait for the other process to finish spawning
    if (await waitForBridge(discoveryPort)) {
      return { alreadyRunning: true };
    }
    throw new Error('Failed to start bridge server - lock timeout');
  }

  try {
    // Double-check after acquiring lock (another process might have started it)
    if (await isBridgeRunning(discoveryPort)) {
      log('Bridge server started by another process');
      return { alreadyRunning: true };
    }

    // Spawn the bridge server
    spawnBridgeServer();

    // Wait for it to be ready
    if (await waitForBridge(discoveryPort)) {
      log('Bridge server is now ready');
      return { alreadyRunning: false };
    }

    throw new Error('Bridge server failed to start within timeout');
  } finally {
    releaseLock();
  }
}

/**
 * Get the PID of the running bridge server
 */
export function getBridgePid(): number | null {
  try {
    if (existsSync(PID_FILE)) {
      const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
      if (isProcessRunning(pid)) {
        return pid;
      }
    }
  } catch {
    // Ignore errors
  }
  return null;
}
