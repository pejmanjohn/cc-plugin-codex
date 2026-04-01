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
});
