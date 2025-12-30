import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { CONSOLE_MCP_IDENTIFIER, type FilterOptions } from 'console-logs-mcp-shared';

export interface DiscoveryConfig {
	wsHost: string;
	wsPort: number;
	discoveryPort?: number;
	identifier?: string;
	serverId?: string;
}

export interface DiscoveryServer {
	listen: () => void;
	close: () => void;
}

export interface MaintenanceHandlers {
	getStats?: () => any;
	clearLogs?: (args: { tabId?: number; before?: string }) => void;
	exportLogs?: (args: {
		format: 'json' | 'csv' | 'txt';
		filter?: FilterOptions;
		fields?: string[];
		prettyPrint?: boolean;
	}) => string;
}

export function createDiscoveryServer(
	config: DiscoveryConfig,
	maintenanceHandlers?: MaintenanceHandlers,
): DiscoveryServer {
	const DISCOVERY_PORT = config.discoveryPort ?? 3332;
	const identifier = config.identifier ?? CONSOLE_MCP_IDENTIFIER;
	const serverId = config.serverId ?? randomUUID();

	const readBody = (req: IncomingMessage): Promise<any> =>
		new Promise((resolve, reject) => {
			const chunks: Buffer[] = [];
			req.on('data', (chunk) => chunks.push(chunk));
			req.on('end', () => {
				if (chunks.length === 0) {
					resolve({});
					return;
				}
				try {
					const data = JSON.parse(Buffer.concat(chunks).toString());
					resolve(data);
				} catch (error) {
					reject(error);
				}
			});
			req.on('error', reject);
		});

	const server = createServer((req: IncomingMessage, res: ServerResponse) => {
		(async () => {
			// Basic CORS for extensions
			res.setHeader('Access-Control-Allow-Origin', '*');
			res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
			res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

			if (req.method === 'OPTIONS') {
				res.writeHead(204);
				res.end();
				return;
			}

			const url = new URL(req.url ?? '/', 'http://localhost');

			if (req.method === 'GET' && url.pathname === '/discover') {
				const payload = {
					identifier,
					serverId,
					wsPort: config.wsPort,
					wsHost: config.wsHost,
					wsUrl: `ws://${config.wsHost}:${config.wsPort}`,
					timestamp: Date.now(),
				};
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(payload));
				return;
			}

			if (req.method === 'GET' && url.pathname === '/maintenance/stats') {
				if (!maintenanceHandlers?.getStats) {
					res.writeHead(503);
					res.end('Maintenance handler unavailable');
					return;
				}
				const stats = maintenanceHandlers.getStats();
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(stats));
				return;
			}

			if (req.method === 'POST' && url.pathname === '/maintenance/clear') {
				if (!maintenanceHandlers?.clearLogs) {
					res.writeHead(503);
					res.end('Maintenance handler unavailable');
					return;
				}
				const body = await readBody(req);
				maintenanceHandlers.clearLogs(body);
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ status: 'cleared' }));
				return;
			}

			if (req.method === 'POST' && url.pathname === '/maintenance/export') {
				if (!maintenanceHandlers?.exportLogs) {
					res.writeHead(503);
					res.end('Maintenance handler unavailable');
					return;
				}
				const body = await readBody(req);
				if (!body.format) {
					res.writeHead(400);
					res.end('Missing format');
					return;
				}
				const data = maintenanceHandlers.exportLogs(body);
				const contentType =
					body.format === 'json'
						? 'application/json'
						: body.format === 'csv'
							? 'text/csv'
							: 'text/plain';
				res.writeHead(200, { 'Content-Type': contentType });
				res.end(data);
				return;
			}

			res.writeHead(404);
			res.end();
		})().catch((error) => {
			res.writeHead(500);
			res.end((error as Error).message);
		});
	});

	return {
		listen: () => {
			server.listen(DISCOVERY_PORT, 'localhost', () => {
				// Log to stderr to avoid interfering with MCP stdio
				process.stderr.write(
					`[Discovery] Listening on http://localhost:${DISCOVERY_PORT}/discover -> ws://${config.wsHost}:${config.wsPort} (id: ${serverId})\n`,
				);
			});
			server.on('error', (error) => {
				process.stderr.write(`[Discovery] Server error: ${(error as Error).message}\n`);
			});
		},
		close: () => {
			server.close();
		},
	};
}
