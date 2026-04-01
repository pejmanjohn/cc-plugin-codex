import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const load = () => import('../../claude/scripts/lib/runtime-config.mjs');

describe('runtime config', () => {
  it('defaults to sonnet and a blocked gate capability', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claude-companion-config-'));
    const { loadRuntimeConfig } = await load();

    const config = await loadRuntimeConfig({ CLAUDE_COMPANION_STATE_ROOT: root });

    expect(config.defaultModel).toBe('sonnet');
    expect(config.defaultEffort).toBe('medium');
    expect(config.reviewGate.capability).toBe('blocked');
  });

  it('persists config updates to config.json', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claude-companion-config-'));
    const { loadRuntimeConfig, saveRuntimeConfig, getConfigPath } = await load();

    const current = await loadRuntimeConfig({ CLAUDE_COMPANION_STATE_ROOT: root });
    await saveRuntimeConfig(
      {
        ...current,
        defaultModel: 'claude-sonnet-4-6',
        reviewGate: { ...current.reviewGate, desiredState: 'enabled' },
      },
      { CLAUDE_COMPANION_STATE_ROOT: root },
    );

    const stored = JSON.parse(readFileSync(getConfigPath({ CLAUDE_COMPANION_STATE_ROOT: root }), 'utf8'));
    expect(stored.defaultModel).toBe('claude-sonnet-4-6');
    expect(stored.reviewGate.desiredState).toBe('enabled');
  });
});
