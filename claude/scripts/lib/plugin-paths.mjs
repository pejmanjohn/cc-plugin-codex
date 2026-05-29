import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const libDir = dirname(fileURLToPath(import.meta.url));

export const scriptsDir = dirname(libDir);
export const pluginRoot = dirname(scriptsDir);

export function pluginPath(...segments) {
  return join(pluginRoot, ...segments);
}
