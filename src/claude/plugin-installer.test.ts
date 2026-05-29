import { describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const createTempDir = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

describe('plugin installer', () => {
  it('installs and uninstalls through the personal marketplace CLI flow', async () => {
    const repoRoot = createTempDir('plugin-installer-repo-');
    const homeDir = createTempDir('plugin-installer-home-');
    const logPath = join(repoRoot, 'cli.log');
    const fakeCliPath = join(repoRoot, 'fake-codex-cli.mjs');

    mkdirSync(join(repoRoot, 'claude', '.codex-plugin'), { recursive: true });
    writeFileSync(
      join(repoRoot, 'claude', '.codex-plugin', 'plugin.json'),
      JSON.stringify({ name: 'claude-companion' }, null, 2),
      'utf8',
    );

    writeFileSync(
      fakeCliPath,
      `
import { appendFileSync } from 'node:fs';

const [, , logPath, ...args] = process.argv;
appendFileSync(logPath, JSON.stringify(args) + '\\n');
      `.trim(),
      'utf8',
    );

    const installer = await import(
      pathToFileURL(join(process.cwd(), 'scripts', 'lib', 'plugin-installer.mjs')).href
    );

    const installResult = await installer.installPluginFromPersonalMarketplace({
      repoRoot,
      homeDir,
      executable: process.execPath,
      argsPrefix: [fakeCliPath, logPath],
    });

    await installer.uninstallPluginFromPersonalMarketplace({
      repoRoot,
      homeDir,
      executable: process.execPath,
      argsPrefix: [fakeCliPath, logPath],
    });

    const marketplacePath = join(homeDir, '.agents', 'plugins', 'marketplace.json');
    const personalPluginPath = join(homeDir, 'plugins', 'claude-companion');
    const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8'));
    const cliCalls = readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(installResult.pluginId).toBe('claude-companion@personal');
    expect(marketplace).toEqual({
      name: 'personal',
      interface: {
        displayName: 'Personal',
      },
      plugins: [
        {
          name: 'claude-companion',
          source: {
            source: 'local',
            path: './plugins/claude-companion',
          },
          policy: {
            installation: 'AVAILABLE',
            authentication: 'ON_INSTALL',
          },
          category: 'Coding',
        },
      ],
    });
    expect(existsSync(personalPluginPath)).toBe(true);
    expect(realpathSync(personalPluginPath)).toBe(realpathSync(join(repoRoot, 'claude')));
    expect(cliCalls).toEqual([
      ['plugin', 'add', 'claude-companion@personal'],
      ['plugin', 'remove', 'claude-companion@personal'],
    ]);
  });

  it('preserves an existing personal marketplace name and display metadata', async () => {
    const repoRoot = createTempDir('plugin-installer-repo-');
    const homeDir = createTempDir('plugin-installer-home-');
    const marketplacePath = join(homeDir, '.agents', 'plugins', 'marketplace.json');

    mkdirSync(join(repoRoot, 'claude'), { recursive: true });
    mkdirSync(join(homeDir, '.agents', 'plugins'), { recursive: true });
    writeFileSync(
      marketplacePath,
      JSON.stringify(
        {
          name: 'team-local',
          interface: {
            displayName: 'Team Local',
          },
          plugins: [
            {
              name: 'other-plugin',
              source: {
                source: 'local',
                path: './plugins/other-plugin',
              },
              policy: {
                installation: 'AVAILABLE',
                authentication: 'ON_INSTALL',
              },
              category: 'Productivity',
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    const installer = await import(
      pathToFileURL(join(process.cwd(), 'scripts', 'lib', 'plugin-installer.mjs')).href
    );

    const result = await installer.ensurePersonalMarketplace({ repoRoot, homeDir });
    const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8'));

    expect(result.pluginId).toBe('claude-companion@team-local');
    expect(marketplace.name).toBe('team-local');
    expect(marketplace.interface).toEqual({ displayName: 'Team Local' });
    expect(marketplace.plugins.map((plugin: { name: string }) => plugin.name)).toEqual([
      'other-plugin',
      'claude-companion',
    ]);
  });

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
