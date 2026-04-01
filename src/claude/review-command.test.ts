import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const load = () => import('../../claude/scripts/lib/operations/review.mjs');
const loadStore = () => import('../../claude/scripts/lib/jobs-store.mjs');

describe('review operations', () => {
  it('runs standard review and renders findings', async () => {
    const { runReview } = await load();

    const result = await runReview(
      {
        command: 'review',
        flags: { base: undefined, model: 'sonnet', json: false },
        trailingText: 'focus on auth',
      },
      {
        workspaceRoot: '/repo/example',
        config: { defaultModel: 'sonnet', defaultEffort: 'medium' },
        resolveReviewTarget: vi.fn(async () => ({
          kind: 'worktree',
          branch: 'feat/auth',
          statusText: ' M src/auth.ts',
          diffText: 'diff --git a/src/auth.ts b/src/auth.ts',
        })),
        buildReviewContext: vi.fn(async () => 'review context'),
        runClaudeReview: vi.fn(async () => ({
          rawOutput:
            '{"findings":[{"severity":"high","title":"Missing null guard","body":"Auth token may be undefined","file":"src/auth.ts","line_start":12,"line_end":12,"confidence":0.94,"recommendation":"Guard the token before dereferencing."}]}',
          parsedPayload: {
            findings: [
              {
                severity: 'high',
                title: 'Missing null guard',
                body: 'Auth token may be undefined',
                file: 'src/auth.ts',
                line_start: 12,
                line_end: 12,
                confidence: 0.94,
                recommendation: 'Guard the token before dereferencing.',
              },
            ],
          },
        })),
        createJob: vi.fn(async (_stateRoot, _workspaceRoot, job) => ({ id: 'job-1', ...job })),
        updateJob: vi.fn(async (_stateRoot, _workspaceRoot, _jobId, patch) => ({
          id: 'job-1',
          ...patch,
        })),
        renderReviewOutput: vi.fn(() => 'Claude review found 1 issue.'),
        stateRoot: '/state',
      },
    );

    expect(result.output).toContain('1 issue');
    expect(result.job.kind).toBe('review');
  });

  it('marks the review job failed when Claude review throws after creation', async () => {
    const { runReview } = await load();
    const { createJob, listJobs, readJob, updateJob } = await loadStore();
    const stateRoot = mkdtempSync(join(tmpdir(), 'claude-companion-jobs-'));
    const failure = new Error('Claude review exploded');

    await expect(
      runReview(
        {
          command: 'review',
          flags: { base: undefined, model: 'sonnet', json: false },
          trailingText: 'focus on auth',
        },
        {
          workspaceRoot: '/repo/example',
          config: { defaultModel: 'sonnet', defaultEffort: 'medium' },
          resolveReviewTarget: vi.fn(async () => ({
            kind: 'worktree',
            branch: 'feat/auth',
            statusText: ' M src/auth.ts',
            diffText: 'diff --git a/src/auth.ts b/src/auth.ts',
          })),
          buildReviewContext: vi.fn(async () => 'review context'),
          runClaudeReview: vi.fn(async () => {
            throw failure;
          }),
          createJob,
          updateJob,
          renderReviewOutput: vi.fn(() => 'Claude review found 1 issue.'),
          stateRoot,
        },
      ),
    ).rejects.toThrow('Claude review exploded');

    const jobs = await listJobs(stateRoot, '/repo/example');
    expect(jobs).toHaveLength(1);

    const storedJob = await readJob(stateRoot, '/repo/example', jobs[0].id);

    expect(storedJob.status).toBe('failed');
    expect(storedJob.phase).toBe('failed');
    expect(storedJob.error).toMatchObject({
      name: 'Error',
      message: 'Claude review exploded',
    });
    expect(storedJob.completedAt).not.toBeNull();
  });

  it('selects the adversarial prompt for adversarial review', async () => {
    const { pickReviewPrompt } = await load();
    expect(pickReviewPrompt('adversarial-review')).toBe('claude/prompts/adversarial-system.md');
  });
});
