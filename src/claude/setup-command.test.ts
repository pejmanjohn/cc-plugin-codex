import { describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const loadSetup = () => import('../../claude/scripts/lib/operations/setup.mjs');
const loadClaudeProcess = () => import('../../claude/scripts/lib/claude-process.mjs');

function createFakeClaudeExecutable(body) {
  const root = mkdtempSync(join(tmpdir(), 'claude-fake-cli-'));
  const binDir = join(root, 'bin');
  const exePath = join(binDir, 'claude');

  mkdirSync(binDir, { recursive: true });
  writeFileSync(exePath, `#!/bin/sh\n${body}\n`, 'utf8');
  chmodSync(exePath, 0o755);

  return {
    root,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
    },
  };
}

async function resolveWithin(promise, ms = 500) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

describe('setup operation', () => {
  it('classifies a quota-blocked Claude envelope as unavailable through the real CLI probe', async () => {
    const { probeClaude } = await loadClaudeProcess();
    const fake = createFakeClaudeExecutable(
      'printf \'{"is_error":true,"result":"Usage limit reached","session_id":"session-123"}\'',
    );

    const result = await probeClaude('sonnet', fake.env);

    expect(result.ok).toBe(false);
    expect(result.availability).toBe('unavailable');
    expect(result.message).toContain('Usage limit reached');
    expect(result.sessionId).toBe('session-123');
  });

  it('classifies an unspawnable claude binary as unavailable instead of throwing', async () => {
    const { probeClaude } = await loadClaudeProcess();
    const missingClaudeEnv = {
      ...process.env,
      PATH: mkdtempSync(join(tmpdir(), 'claude-missing-bin-')),
    };

    const result = await resolveWithin(probeClaude('sonnet', missingClaudeEnv));

    expect(result.ok).toBe(false);
    expect(result.availability).toBe('unavailable');
    expect(result.message).toMatch(/(ENOENT|not found|spawn)/i);
  });

  it('returns clear guidance for non-JSON or auth-style claude output', async () => {
    const { probeClaude } = await loadClaudeProcess();
    const fake = createFakeClaudeExecutable(
      [
        'printf \'Claude Code login required\\n\'',
        'printf \'Please sign in to continue.\\n\' >&2',
        'exit 0',
      ].join('\n'),
    );

    const result = await probeClaude('sonnet', fake.env);

    expect(result.ok).toBe(false);
    expect(result.availability).toBe('unavailable');
    expect(result.message).toMatch(/(login|sign in|authenticate|non-JSON)/i);
  });

  it('prints JSON from the real setup entrypoint and persists requested review gate state', async () => {
    const fake = createFakeClaudeExecutable(
      'printf \'{"is_error":false,"result":"Claude Code usable","session_id":"session-456"}\'',
    );
    const stateRoot = mkdtempSync(join(tmpdir(), 'claude-setup-state-'));
    const entrypoint = join(process.cwd(), 'claude/scripts/claude-companion.mjs');
    const stdout = execFileSync(
      'node',
      [entrypoint, 'setup', '--json', '--enable-review-gate'],
      {
        env: {
          ...fake.env,
          CLAUDE_COMPANION_STATE_ROOT: stateRoot,
        },
        encoding: 'utf8',
      },
    );

    const result = JSON.parse(stdout);
    const stored = JSON.parse(readFileSync(join(stateRoot, 'config.json'), 'utf8'));

    expect(result.reviewGate.desiredState).toBe('enabled');
    expect(stored.reviewGate.desiredState).toBe('enabled');
    expect(result.output ?? result).toBeDefined();
  });

  it('reports a usable fallback model when the default model is unavailable', async () => {
    const { runSetup } = await loadSetup();
    const probeClaude = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        availability: 'unavailable',
        message: 'Usage limit reached',
        sessionId: 'session-default',
      })
      .mockResolvedValueOnce({
        ok: true,
        availability: 'ready',
        message: 'Fallback model is usable',
        sessionId: 'session-fallback',
      });

    const result = await runSetup(
      {
        flags: {
          model: undefined,
          enableReviewGate: true,
          disableReviewGate: false,
          json: false,
        },
      },
      {
        config: {
          defaultModel: 'sonnet',
          defaultEffort: 'medium',
          fallbackModel: 'haiku',
          reviewGate: {
            desiredState: 'disabled',
            capability: 'blocked',
            applied: false,
            reason: 'hooks unavailable',
          },
        },
        probeClaude,
        saveConfig: vi.fn(),
      },
    );

    expect(probeClaude).toHaveBeenCalledTimes(2);
    expect(probeClaude).toHaveBeenNthCalledWith(1, 'sonnet', undefined);
    expect(probeClaude).toHaveBeenNthCalledWith(2, 'haiku', undefined);
    expect(result.readiness.status).toBe('unavailable');
    expect(result.fallback?.model).toBe('haiku');
    expect(result.fallback?.status).toBe('ready');
    expect(result.output).toContain('Fallback model haiku is usable');
  });

  it('gives clear guidance when all configured models are unavailable', async () => {
    const { runSetup } = await loadSetup();
    const probeClaude = vi.fn().mockResolvedValue({
      ok: false,
      availability: 'unavailable',
      message: 'Usage limit reached',
      sessionId: 'session-unavailable',
    });

    const result = await runSetup(
      {
        flags: {
          model: undefined,
          enableReviewGate: false,
          disableReviewGate: false,
          json: false,
        },
      },
      {
        config: {
          defaultModel: 'sonnet',
          defaultEffort: 'medium',
          fallbackModel: 'haiku',
          reviewGate: {
            desiredState: 'disabled',
            capability: 'blocked',
            applied: false,
            reason: 'hooks unavailable',
          },
        },
        probeClaude,
        saveConfig: vi.fn(),
      },
    );

    expect(result.output).toContain('All configured Claude models are unavailable');
    expect(result.output).toContain('sonnet');
    expect(result.output).toContain('haiku');
  });
});
