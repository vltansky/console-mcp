import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export interface DiscoveryConfig {
	wsHost: string;
	wsPort: number;
	discoveryPort?: number;
}

export interface DiscoveryServer {
	listen: () => void;
	close: () => void;
}

export function createDiscoveryServer(config: DiscoveryConfig): DiscoveryServer {
	const DISCOVERY_PORT = config.discoveryPort ?? 3332;

	const server = createServer((req: IncomingMessage, res: ServerResponse) => {
		// Basic CORS for extensions
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

		if (req.method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}

		if (req.method === 'GET' && req.url === '/discover') {
			const payload = {
				wsPort: config.wsPort,
				wsHost: config.wsHost,
				wsUrl: `ws://${config.wsHost}:${config.wsPort}`,
				timestamp: Date.now(),
			};
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(payload));
			return;
		}

		res.writeHead(404);
		res.end();
	});

	return {
		listen: () => {
			server.listen(DISCOVERY_PORT, 'localhost', () => {
				// Log to stderr to avoid interfering with MCP stdio
				process.stderr.write(
					`[Discovery] Listening on http://localhost:${DISCOVERY_PORT}/discover -> ws://${config.wsHost}:${config.wsPort}\n`,
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
