import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const load = () => import('../../claude/scripts/lib/git-review-target.mjs');

function initRepo() {
  const root = mkdtempSync(join(tmpdir(), 'claude-review-target-'));
  spawnSync('git', ['init'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'Plan Test'], { cwd: root });
  spawnSync('git', ['config', 'user.email', 'plan@test.local'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# repo\n', 'utf8');
  spawnSync('git', ['add', 'README.md'], { cwd: root });
  spawnSync('git', ['commit', '-m', 'init'], { cwd: root });
  return root;
}

describe('review target resolution', () => {
  it('prefers worktree review when the repository is dirty', async () => {
    const root = initRepo();
    writeFileSync(join(root, 'README.md'), '# repo\nchanged\n', 'utf8');

    const { resolveReviewTarget } = await load();
    const target = await resolveReviewTarget(root, { base: undefined });

    expect(target.kind).toBe('worktree');
  });

  it('includes untracked file contents that git diff omits', async () => {
    const root = initRepo();
    writeFileSync(join(root, 'brand-new.mjs'), 'export const answer = 42;\n', 'utf8');

    const { resolveReviewTarget } = await load();
    const target = await resolveReviewTarget(root, { base: undefined });

    expect(target.kind).toBe('worktree');
    expect(target.diffText).toContain('untracked: brand-new.mjs');
    expect(target.diffText).toContain('export const answer = 42;');
  });

  it('omits binary untracked files from the review context', async () => {
    const root = initRepo();
    writeFileSync(join(root, 'blob.bin'), Buffer.from([0x89, 0x00, 0x50, 0x4e, 0x47]));

    const { resolveReviewTarget } = await load();
    const target = await resolveReviewTarget(root, { base: undefined });

    expect(target.diffText).toContain('untracked (binary, omitted): blob.bin');
    expect(target.diffText).not.toContain('\u0000');
  });
});
