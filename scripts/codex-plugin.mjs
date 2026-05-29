#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  installPlugin,
  installPluginFromPersonalMarketplace,
  uninstallPlugin,
  uninstallPluginFromPersonalMarketplace,
} from './lib/plugin-installer.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const action = process.argv[2];

const usage = () => {
  console.error(
    'Usage: node scripts/codex-plugin.mjs <install|uninstall|install-direct|uninstall-direct>',
  );
  process.exitCode = 1;
};

if (!action) {
  usage();
} else {
  const runByAction = {
    install: installPluginFromPersonalMarketplace,
    uninstall: uninstallPluginFromPersonalMarketplace,
    'install-direct': installPlugin,
    'uninstall-direct': uninstallPlugin,
  };
  const run = runByAction[action];

  if (!run) {
    usage();
  } else {
    try {
      const result = await run({ repoRoot });
      if (action === 'install') {
        console.log(`Installed ${result.pluginId}.`);
        console.log(`Marketplace: ${result.marketplacePath}`);
        console.log(`Plugin source: ${result.personalPluginPath}`);
        console.log('Start a new Codex thread and run $claude-setup.');
      } else {
        if (action === 'uninstall') {
          console.log(`Uninstalled ${result.pluginId}.`);
          console.log('The personal marketplace entry is left in place for easy reinstall.');
        } else if (action === 'install-direct') {
          console.log(`Installed ${result.pluginId} through the repo marketplace.`);
        } else {
          console.log(`Uninstalled ${result.pluginId}.`);
        }
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
