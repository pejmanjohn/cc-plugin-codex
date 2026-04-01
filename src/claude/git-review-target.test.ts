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
});
