import { describe, expect, it } from 'vitest';

const load = () => import('../../claude/scripts/lib/review-context.mjs');

describe('review context', () => {
  it('embeds branch, status, diff, and focus text', async () => {
    const { buildReviewContext } = await load();

    const context = await buildReviewContext({
      workspaceRoot: '/repo/example',
      mode: 'review',
      target: {
        kind: 'worktree',
        branch: 'feat/plugin-port',
        statusText: ' M src/app.ts',
        diffText: 'diff --git a/src/app.ts b/src/app.ts',
      },
      trailingText: 'check auth and retries',
    });

    expect(context).toContain('feat/plugin-port');
    expect(context).toContain(' M src/app.ts');
    expect(context).toContain('check auth and retries');
  });
});
