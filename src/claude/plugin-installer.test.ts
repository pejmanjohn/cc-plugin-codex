import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const createTempDir = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

describe('plugin installer', () => {
  it('installs and uninstalls through codex app-server RPC with the repo marketplace contract', async () => {
    const repoRoot = createTempDir('plugin-installer-repo-');
    const logPath = join(repoRoot, 'requests.log');
    const marketplacePath = join(repoRoot, '.agents', 'plugins', 'marketplace.json');
    const fakeServerPath = join(repoRoot, 'fake-app-server.mjs');

    mkdirSync(join(repoRoot, '.agents', 'plugins'), { recursive: true });
    writeFileSync(
      marketplacePath,
      JSON.stringify(
        {
          name: 'cc-plugin-codex-marketplace',
          plugins: [{ name: 'claude-companion' }],
        },
        null,
        2,
      ),
      'utf8',
    );

    writeFileSync(
      fakeServerPath,
      `
import { appendFileSync } from 'node:fs';
import readline from 'node:readline';

const logPath = process.argv[2];
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  if (!line.trim()) {
    return;
  }

  const message = JSON.parse(line);
  appendFileSync(logPath, JSON.stringify(message) + '\\n');

  if (message.method === 'initialize') {
    process.stdout.write(JSON.stringify({ id: message.id, result: { ok: true } }) + '\\n');
    return;
  }

  if (message.method === 'plugin/install' || message.method === 'plugin/uninstall') {
    process.stdout.write(JSON.stringify({ id: message.id, result: { ok: true } }) + '\\n');
    process.exit(0);
  }
});
      `.trim(),
      'utf8',
    );

    const installer = await import(
      pathToFileURL(join(process.cwd(), 'scripts', 'lib', 'plugin-installer.mjs')).href
    );

    await installer.installPlugin({
      repoRoot,
      executable: process.execPath,
      args: [fakeServerPath, logPath],
    });

    await installer.uninstallPlugin({
      repoRoot,
      executable: process.execPath,
      args: [fakeServerPath, logPath],
    });

    const requests = readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(requests).toEqual([
      expect.objectContaining({ method: 'initialize' }),
      expect.objectContaining({
        method: 'plugin/install',
        params: {
          marketplacePath,
          pluginName: 'claude-companion',
          forceRemoteSync: false,
        },
      }),
      expect.objectContaining({ method: 'initialize' }),
      expect.objectContaining({
        method: 'plugin/uninstall',
        params: {
          pluginId: 'claude-companion@cc-plugin-codex-marketplace',
          forceRemoteSync: false,
        },
      }),
    ]);
  });
});
