import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const loadSetup = () => import('../../claude/scripts/lib/operations/setup.mjs');

describe('release positioning', () => {
  it('keeps the docs honest about the currently ported workflows', async () => {
    const readme = readFileSync('claude/README.md', 'utf8');
    expect(readme).toContain('not fully functionally equivalent to `openai/codex-plugin-cc` today');
    expect(readme).toContain(
      'Review, adversarial review, rescue delegation, setup, status, result, and cancel are the currently ported and working workflows.',
    );
    expect(readme).toContain(
      'The automatic stop-time review gate is currently unavailable/blocked in the Codex plugin runtime.',
    );

    const setupSkill = readFileSync('claude/skills/claude-setup/SKILL.md', 'utf8');
    expect(setupSkill).toContain('--model <alias>');
    expect(setupSkill).toContain('--enable-review-gate');
    expect(setupSkill).toContain('--disable-review-gate');
    expect(setupSkill).toContain('--json');

    const { runSetup } = await loadSetup();
    const blocked = await runSetup(
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
        env: {},
        probeClaude: vi.fn().mockResolvedValue({
          ok: true,
          availability: 'ready',
          status: 'ready',
          message: 'Claude Code usable',
          sessionId: 'session-123',
        }),
        saveConfig: vi.fn(),
      },
    );

    expect(blocked.output).toContain(
      'not fully functionally equivalent to codex-plugin-cc until Codex executes installed plugin hooks for the requested review gate',
    );
    expect(blocked.output).toContain(
      'Review gate requested but unavailable/blocked in Codex because validated installed-plugin runs did not execute bundled plugin hooks',
    );

    const available = await runSetup(
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
            capability: 'available',
            applied: true,
            reason: 'hooks available',
          },
        },
        env: {},
        probeClaude: vi.fn().mockResolvedValue({
          ok: true,
          availability: 'ready',
          status: 'ready',
          message: 'Claude Code usable',
          sessionId: 'session-456',
        }),
        saveConfig: vi.fn(),
      },
    );

    expect(available.output).toContain('Review gate: available');
    expect(available.output).not.toContain('not fully functionally equivalent to codex-plugin-cc');
  });
});
