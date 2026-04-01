import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const cleanupPaths = new Set<string>();

afterEach(() => {
  for (const cleanupPath of cleanupPaths) {
    rmSync(cleanupPath, { recursive: true, force: true });
  }
  cleanupPaths.clear();
});

const createTempDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupPaths.add(dir);
  return dir;
};

const waitForServerReady = async (
  server: ChildProcessWithoutNullStreams,
  requestedWsUrl: string,
) =>
  await new Promise<string>((resolve, reject) => {
    let output = '';

    const timer = setTimeout(() => {
      reject(
        new Error(
          `codex app-server did not announce readiness for ${requestedWsUrl}\n${output}`,
        ),
      );
    }, 15_000);

    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const matchedUrl = output.match(/listening on:\s*(ws:\/\/\S+)/)?.[1];
      if (matchedUrl) {
        clearTimeout(timer);
        server.stdout.off('data', onData);
        server.stderr.off('data', onData);
        server.off('exit', onExit);
        resolve(matchedUrl);
      }
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      reject(
        new Error(
          `codex app-server exited before readiness (code=${code}, signal=${signal})\n${output}`,
        ),
      );
    };

    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
    server.once('exit', onExit);
  });

const createFakeServer = () => {
  const lifecycle = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  return Object.assign(lifecycle, {
    stdout,
    stderr,
    killed: false,
    exitCode: null,
    signalCode: null,
  }) as ChildProcessWithoutNullStreams;
};

describe('waitForServerReady', () => {
  it('returns the assigned websocket URL when the readiness banner spans chunks', async () => {
    const server = createFakeServer();
    const ready = waitForServerReady(server, 'ws://127.0.0.1:0');

    server.stderr.write('listen');
    server.stderr.write('ing on: ws://127.0.0.1:50493\n');

    await expect(ready).resolves.toBe('ws://127.0.0.1:50493');
  });
});

const connectWebSocket = async (wsUrl: string) => {
  const ws = new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      ws.removeEventListener('error', onError);
      resolve();
    };
    const onError = (event: Event) => {
      ws.removeEventListener('open', onOpen);
      reject(event);
    };

    ws.addEventListener('open', onOpen, { once: true });
    ws.addEventListener('error', onError, { once: true });
  });

  return ws;
};

const createRpcClient = (ws: WebSocket) => {
  let nextId = 0;

  return {
    request: (method: string, params: unknown) =>
      new Promise<any>((resolve, reject) => {
        const id = ++nextId;

        const onMessage = (event: MessageEvent<string>) => {
          const message = JSON.parse(String(event.data));
          if (message.id !== id) {
            return;
          }

          ws.removeEventListener('message', onMessage);
          if (message.error) {
            reject(new Error(JSON.stringify(message.error)));
            return;
          }

          resolve(message.result);
        };

        ws.addEventListener('message', onMessage);
        ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      }),
  };
};

const closeWebSocket = async (ws: WebSocket | null) => {
  if (!ws || ws.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise<void>((resolve) => {
    ws.addEventListener('close', () => resolve(), { once: true });
    ws.close();
  });
};

const stopServer = async (server: ChildProcessWithoutNullStreams | null) => {
  if (
    !server ||
    server.killed ||
    server.exitCode !== null ||
    server.signalCode !== null
  ) {
    return;
  }

  await new Promise<void>((resolve) => {
    server.once('exit', () => resolve());
    server.kill('SIGTERM');
  });
};

describe('plugin install contract', () => {
  it(
    'lists, reads, and installs the repo-local plugin through app-server',
    async () => {
      const repoDir = createTempDir('claude-plugin-contract-repo-');
      const homeDir = createTempDir('claude-plugin-contract-home-');
      const pluginDir = join(repoDir, 'plugins', 'claude-companion');
      const marketplacePath = join(repoDir, '.agents', 'plugins', 'marketplace.json');
      const configPath = join(homeDir, '.codex', 'config.toml');
      const requestedWsUrl = 'ws://127.0.0.1:0';

      cpSync('claude', pluginDir, { recursive: true });
      mkdirSync(join(marketplacePath, '..'), { recursive: true });
      mkdirSync(join(homeDir, '.codex'), { recursive: true });
      writeFileSync(
        marketplacePath,
        JSON.stringify(
          {
            name: 'claude-contract-marketplace',
            interface: { displayName: 'Claude Contract Marketplace' },
            plugins: [
              {
                name: 'claude-companion',
                source: { source: 'local', path: './plugins/claude-companion' },
                policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
                category: 'Coding',
              },
            ],
          },
          null,
          2,
        ),
        'utf8',
      );

      let server: ChildProcessWithoutNullStreams | null = null;
      let ws: WebSocket | null = null;

      try {
        server = spawn('codex', ['app-server', '--listen', requestedWsUrl], {
          cwd: repoDir,
          env: { ...process.env, HOME: homeDir },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const wsUrl = await waitForServerReady(server, requestedWsUrl);

        ws = await connectWebSocket(wsUrl);
        const rpc = createRpcClient(ws);

        await rpc.request('initialize', {
          clientInfo: { name: 'claude-contract-test', version: '0.0.1' },
          capabilities: { experimentalApi: true, optOutNotificationMethods: [] },
        });

        const listed = await rpc.request('plugin/list', {
          cwds: [repoDir],
          forceRemoteSync: false,
        });
        const read = await rpc.request('plugin/read', {
          marketplacePath,
          pluginName: 'claude-companion',
        });
        await rpc.request('plugin/install', {
          marketplacePath,
          pluginName: 'claude-companion',
          forceRemoteSync: false,
        });
        const skills = await rpc.request('skills/list', { cwd: repoDir });

        expect(listed.marketplaces).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: marketplacePath }),
          ]),
        );
        expect(read.plugin.summary.id).toBe(
          'claude-companion@claude-contract-marketplace',
        );
        expect(readFileSync(configPath, 'utf8')).toContain(
          '[plugins."claude-companion@claude-contract-marketplace"]',
        );
        expect(
          Object.fromEntries(
            skills.data[0].skills
              .filter((skill: { name: string }) =>
                skill.name.startsWith('claude-companion:'),
              )
              .map((skill: { name: string; interface?: { displayName?: string } }) => [
                skill.name,
                skill.interface?.displayName,
              ]),
          ),
        ).toEqual({
          'claude-companion:claude-adversarial-review': 'Adversarial Review',
          'claude-companion:claude-cancel': 'Cancel',
          'claude-companion:claude-rescue': 'Delegate',
          'claude-companion:claude-result': 'Result',
          'claude-companion:claude-review': 'Review',
          'claude-companion:claude-setup': 'Setup',
          'claude-companion:claude-status': 'Status',
        });
      } finally {
        await closeWebSocket(ws);
        await stopServer(server);
      }
    },
    120_000,
  );
});
