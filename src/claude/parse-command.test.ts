import { describe, expect, it } from 'vitest';

const load = () => import('../../claude/scripts/lib/parse-command.mjs');

describe('parseCommand', () => {
  it('parses review flags and trailing text', async () => {
    const { parseCommand } = await load();

    expect(
      parseCommand(['review', '--base', 'main', '--model', 'sonnet', 'focus on race conditions']),
    ).toEqual({
      command: 'review',
      flags: {
        background: false,
        base: 'main',
        model: 'sonnet',
        effort: undefined,
        resume: false,
        fresh: false,
        job: undefined,
        json: false,
        enableReviewGate: false,
        disableReviewGate: false,
      },
      trailingText: 'focus on race conditions',
    });
  });

  it('parses delegate model and effort flags', async () => {
    const { parseCommand } = await load();

    expect(
      parseCommand(['delegate', '--model', 'opus', '--effort', 'high', 'fix the worker']),
    ).toEqual(
      expect.objectContaining({
        command: 'delegate',
        flags: expect.objectContaining({
          model: 'opus',
          effort: 'high',
        }),
        trailingText: 'fix the worker',
      }),
    );
  });

  it('rejects unknown flags instead of folding them into the prompt', async () => {
    const { parseCommand } = await load();

    expect(() => parseCommand(['delegate', '--dangerously-skip-permissions', 'fix the worker'])).toThrow(
      /Unknown flag --dangerously-skip-permissions\. Supported flags:/,
    );
  });

  it('treats flag-like tokens after the task text begins as prose', async () => {
    const { parseCommand } = await load();

    expect(parseCommand(['delegate', 'fix', 'the', '--json', 'flag', 'output'])).toEqual(
      expect.objectContaining({
        flags: expect.objectContaining({ json: false }),
        trailingText: 'fix the --json flag output',
      }),
    );
  });

  it('supports a bare -- separator for task text that starts with a flag-like token', async () => {
    const { parseCommand } = await load();

    expect(parseCommand(['delegate', '--model', 'opus', '--', '--verbose is broken'])).toEqual(
      expect.objectContaining({
        flags: expect.objectContaining({ model: 'opus' }),
        trailingText: '--verbose is broken',
      }),
    );
  });
});
