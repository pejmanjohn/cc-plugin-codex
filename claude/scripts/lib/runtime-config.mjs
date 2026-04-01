import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const DEFAULT_CONFIG = {
  defaultModel: 'sonnet',
  defaultEffort: 'medium',
  fallbackModel: undefined,
  reviewGate: {
    desiredState: 'disabled',
    capability: 'blocked',
    applied: false,
    reason: 'Codex hooks exist, but installed plugin-bundled hooks did not execute in the validated codex exec and desktop hosts.',
  },
};

export function getStateRoot(env = process.env) {
  return env.CLAUDE_COMPANION_STATE_ROOT ?? join(homedir(), '.codex', 'claude-companion');
}

export function getConfigPath(env = process.env) {
  return join(getStateRoot(env), 'config.json');
}

export async function loadRuntimeConfig(env = process.env) {
  const path = getConfigPath(env);

  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      reviewGate: {
        ...DEFAULT_CONFIG.reviewGate,
        ...(parsed.reviewGate ?? {}),
      },
    };
  } catch {
    return {
      ...DEFAULT_CONFIG,
      reviewGate: { ...DEFAULT_CONFIG.reviewGate },
    };
  }
}

export async function saveRuntimeConfig(config, env = process.env) {
  const path = getConfigPath(env);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2), 'utf8');
}
