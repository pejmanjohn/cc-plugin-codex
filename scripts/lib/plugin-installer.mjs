import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import readline from 'node:readline';
import { join, resolve } from 'node:path';

const DEFAULT_PLUGIN_NAME = 'claude-companion';
const CLIENT_INFO = {
  name: 'cc-plugin-codex-installer',
  version: '0.1.0',
};

export function pluginIdFromMarketplace(marketplaceName, pluginName = DEFAULT_PLUGIN_NAME) {
  return `${pluginName}@${marketplaceName}`;
}

export async function loadMarketplaceConfig(repoRoot, pluginName = DEFAULT_PLUGIN_NAME) {
  const marketplacePath = join(repoRoot, '.agents', 'plugins', 'marketplace.json');
  const marketplace = JSON.parse(await readFile(marketplacePath, 'utf8'));
  const plugin = marketplace.plugins?.find((entry) => entry.name === pluginName);

  if (!plugin) {
    throw new Error(`Plugin "${pluginName}" is not defined in ${marketplacePath}.`);
  }

  return {
    marketplacePath,
    marketplaceName: marketplace.name,
    pluginName,
    pluginId: pluginIdFromMarketplace(marketplace.name, pluginName),
  };
}

export async function callCodexAppServer({
  cwd,
  method,
  params,
  executable = 'codex',
  args = ['app-server'],
}) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const lines = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    let settled = false;
    let stderr = '';

    const cleanup = () => {
      lines.close();
      child.stdin.end();
      if (!child.killed && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
      }
    };

    const finish = (handler, value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      handler(value);
    };

    const writeMessage = (message) => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', (error) => {
      finish(
        rejectPromise,
        new Error(`Failed to start ${executable}: ${error.message}`),
      );
    });

    child.on('exit', (code, signal) => {
      if (settled) {
        return;
      }

      const suffix = stderr.trim() ? `\n${stderr.trim()}` : '';
      finish(
        rejectPromise,
        new Error(
          `${executable} app-server exited before responding to ${method} (code=${code}, signal=${signal})${suffix}`,
        ),
      );
    });

    lines.on('line', (line) => {
      if (!line.trim()) {
        return;
      }

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }

      if (message.id === 1) {
        writeMessage({
          jsonrpc: '2.0',
          id: 2,
          method,
          params,
        });
        return;
      }

      if (message.id !== 2) {
        return;
      }

      if (message.error) {
        const serialized = JSON.stringify(message.error);
        const suffix = stderr.trim() ? `\n${stderr.trim()}` : '';
        finish(
          rejectPromise,
          new Error(`Codex app-server ${method} failed: ${serialized}${suffix}`),
        );
        return;
      }

      finish(resolvePromise, message.result);
    });

    writeMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: CLIENT_INFO,
        capabilities: {
          experimentalApi: true,
          optOutNotificationMethods: [],
        },
      },
    });
  });
}

export async function installPlugin(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const config = await loadMarketplaceConfig(repoRoot, options.pluginName);

  await callCodexAppServer({
    cwd: repoRoot,
    method: 'plugin/install',
    params: {
      marketplacePath: config.marketplacePath,
      pluginName: config.pluginName,
      forceRemoteSync: false,
    },
    executable: options.executable,
    args: options.args,
  });

  return config;
}

export async function uninstallPlugin(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const config = await loadMarketplaceConfig(repoRoot, options.pluginName);

  await callCodexAppServer({
    cwd: repoRoot,
    method: 'plugin/uninstall',
    params: {
      pluginId: config.pluginId,
      forceRemoteSync: false,
    },
    executable: options.executable,
    args: options.args,
  });

  return config;
}
