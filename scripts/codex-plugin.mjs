#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { installPlugin, uninstallPlugin } from './lib/plugin-installer.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const action = process.argv[2];

const usage = () => {
  console.error('Usage: node scripts/codex-plugin.mjs <install|uninstall>');
  process.exitCode = 1;
};

if (!action) {
  usage();
} else {
  const run = action === 'install' ? installPlugin : action === 'uninstall' ? uninstallPlugin : null;

  if (!run) {
    usage();
  } else {
    try {
      const result = await run({ repoRoot });
      if (action === 'install') {
        console.log(`Installed ${result.pluginId}. Open Codex and run $claude-setup.`);
      } else {
        console.log(`Uninstalled ${result.pluginId}.`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
