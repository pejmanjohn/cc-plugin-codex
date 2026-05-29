import { spawn } from 'node:child_process';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import readline from 'node:readline';
import { dirname, join, resolve } from 'node:path';

const DEFAULT_PLUGIN_NAME = 'claude-companion';
const DEFAULT_PERSONAL_MARKETPLACE_NAME = 'personal';
const DEFAULT_PERSONAL_MARKETPLACE_CATEGORY = 'Coding';
const CLIENT_INFO = {
  name: 'cc-plugin-codex-installer',
  version: '0.1.0',
};

export function pluginIdFromMarketplace(marketplaceName, pluginName = DEFAULT_PLUGIN_NAME) {
  return `${pluginName}@${marketplaceName}`;
}

export function personalMarketplaceEntry(pluginName = DEFAULT_PLUGIN_NAME) {
  return {
    name: pluginName,
    source: {
      source: 'local',
      path: `./plugins/${pluginName}`,
    },
    policy: {
      installation: 'AVAILABLE',
      authentication: 'ON_INSTALL',
    },
    category: DEFAULT_PERSONAL_MARKETPLACE_CATEGORY,
  };
}

export function personalInstallPaths(options = {}) {
  const pluginName = options.pluginName ?? DEFAULT_PLUGIN_NAME;
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const home = resolve(options.homeDir ?? homedir());

  return {
    pluginName,
    repoRoot,
    sourcePluginPath: resolve(options.sourcePluginPath ?? join(repoRoot, 'claude')),
    personalPluginPath: join(home, 'plugins', pluginName),
    marketplacePath: join(home, '.agents', 'plugins', 'marketplace.json'),
  };
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

async function readJsonObject(path) {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object.`);
  }

  return parsed;
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function entriesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function ensurePersonalPluginLink(paths) {
  await mkdir(dirname(paths.personalPluginPath), { recursive: true });

  const sourceRealPath = await realpath(paths.sourcePluginPath);
  const existing = await pathExists(paths.personalPluginPath);

  if (!existing) {
    await symlink(
      sourceRealPath,
      paths.personalPluginPath,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    return { action: 'created', path: paths.personalPluginPath };
  }

  const personalRealPath = await realpath(paths.personalPluginPath);
  if (personalRealPath === sourceRealPath) {
    return { action: 'reused', path: paths.personalPluginPath };
  }

  throw new Error(
    `${paths.personalPluginPath} already exists and points to ${personalRealPath}, not ${sourceRealPath}. ` +
      'Move or remove that path before installing Claude Companion.',
  );
}

export async function ensurePersonalMarketplace(options = {}) {
  const paths = personalInstallPaths(options);
  let marketplace;
  let created = false;

  if (await pathExists(paths.marketplacePath)) {
    marketplace = await readJsonObject(paths.marketplacePath);
  } else {
    created = true;
    marketplace = {
      name: DEFAULT_PERSONAL_MARKETPLACE_NAME,
      interface: {
        displayName: 'Personal',
      },
      plugins: [],
    };
  }

  if (typeof marketplace.name !== 'string' || !marketplace.name.trim()) {
    throw new Error(`${paths.marketplacePath} must contain a non-empty string field "name".`);
  }

  if (marketplace.interface !== undefined && (
    !marketplace.interface ||
    typeof marketplace.interface !== 'object' ||
    Array.isArray(marketplace.interface)
  )) {
    throw new Error(`${paths.marketplacePath} field "interface" must be an object.`);
  }

  if (marketplace.interface === undefined) {
    marketplace.interface = {
      displayName: marketplace.name,
    };
  }

  if (marketplace.plugins === undefined) {
    marketplace.plugins = [];
  }

  if (!Array.isArray(marketplace.plugins)) {
    throw new Error(`${paths.marketplacePath} field "plugins" must be an array.`);
  }

  const entry = personalMarketplaceEntry(paths.pluginName);
  const existingIndex = marketplace.plugins.findIndex(
    (plugin) => plugin && typeof plugin === 'object' && plugin.name === paths.pluginName,
  );
  let changed = created;

  if (existingIndex === -1) {
    marketplace.plugins.push(entry);
    changed = true;
  } else if (!entriesEqual(marketplace.plugins[existingIndex], entry)) {
    marketplace.plugins[existingIndex] = entry;
    changed = true;
  }

  if (changed) {
    await mkdir(dirname(paths.marketplacePath), { recursive: true });
    await writeFile(paths.marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`, 'utf8');
  }

  return {
    ...paths,
    marketplaceName: marketplace.name,
    pluginId: pluginIdFromMarketplace(marketplace.name, paths.pluginName),
    changed,
  };
}

export async function loadPersonalMarketplaceConfig(options = {}) {
  const paths = personalInstallPaths(options);
  let marketplaceName = DEFAULT_PERSONAL_MARKETPLACE_NAME;

  if (await pathExists(paths.marketplacePath)) {
    const marketplace = await readJsonObject(paths.marketplacePath);
    if (typeof marketplace.name !== 'string' || !marketplace.name.trim()) {
      throw new Error(`${paths.marketplacePath} must contain a non-empty string field "name".`);
    }
    marketplaceName = marketplace.name;
  }

  return {
    ...paths,
    marketplaceName,
    pluginId: pluginIdFromMarketplace(marketplaceName, paths.pluginName),
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

async function runCodexPluginCommand({
  action,
  pluginId,
  executable = 'codex',
  argsPrefix = [],
  cwd,
}) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      executable,
      [...argsPrefix, 'plugin', action, pluginId],
      {
        cwd,
        stdio: 'inherit',
      },
    );

    child.on('error', rejectPromise);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          `${executable} plugin ${action} ${pluginId} failed (code=${code}, signal=${signal})`,
        ),
      );
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

export async function installPluginFromPersonalMarketplace(options = {}) {
  const paths = personalInstallPaths(options);
  const link = await ensurePersonalPluginLink(paths);
  const config = await ensurePersonalMarketplace(options);

  await runCodexPluginCommand({
    action: 'add',
    pluginId: config.pluginId,
    executable: options.executable,
    argsPrefix: options.argsPrefix,
    cwd: config.repoRoot,
  });

  return {
    ...config,
    link,
  };
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

export async function uninstallPluginFromPersonalMarketplace(options = {}) {
  const config = await loadPersonalMarketplaceConfig(options);

  await runCodexPluginCommand({
    action: 'remove',
    pluginId: config.pluginId,
    executable: options.executable,
    argsPrefix: options.argsPrefix,
    cwd: config.repoRoot,
  });

  return config;
}
