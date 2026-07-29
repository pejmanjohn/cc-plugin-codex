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

  it('replaces oversized diffs with a changed-file list and read-from-workspace guidance', async () => {
    const { buildReviewContext } = await load();
    const hugeBody = 'x'.repeat(300 * 1024);
    const diffText = [
      'diff --git a/src/app.ts b/src/app.ts',
      hugeBody,
      'diff --git a/src/lib/util.ts b/src/lib/util.ts',
      '--- untracked: docs/new-notes.md ---',
      'note contents',
    ].join('\n');

    const context = await buildReviewContext({
      workspaceRoot: '/repo/example',
      mode: 'review',
      target: {
        kind: 'worktree',
        branch: 'feat/huge',
        statusText: ' M src/app.ts',
        diffText,
      },
      trailingText: '',
    });

    expect(context).toContain('Diff: omitted');
    expect(context).toContain('- src/app.ts');
    expect(context).toContain('- src/lib/util.ts');
    expect(context).toContain('- docs/new-notes.md');
    expect(context).toContain('Read these files directly from the workspace');
    expect(context).not.toContain(hugeBody);
  });
});
