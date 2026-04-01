import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const load = () => import('../../claude/scripts/lib/jobs-store.mjs');

describe('jobs store', () => {
  it('persists the core job schema for later flows', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claude-companion-jobs-'));
    const { createJob, listJobs } = await load();

    const created = await createJob(root, '/repo/example', {
      kind: 'rescue',
      title: 'Investigate test failures',
      summary: 'Foreground rescue run',
      status: 'queued',
      phase: 'queued',
    });

    const jobs = await listJobs(root, '/repo/example');

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: created.id,
      kind: 'rescue',
      title: 'Investigate test failures',
      summary: 'Foreground rescue run',
      workspaceRoot: '/repo/example',
      status: 'queued',
      phase: 'queued',
      pid: null,
      sessionId: null,
      threadId: null,
      renderedOutput: null,
      parsedPayload: null,
      rawOutput: null,
      error: null,
      logFilePath: null,
    });
  });

  it('keeps a small recent-jobs index instead of scanning stray job files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claude-companion-jobs-'));
    const { createJob, listJobs } = await load();

    await createJob(root, '/repo/example', {
      kind: 'review',
      title: 'Review current diff',
      summary: '2 findings',
      status: 'completed',
      phase: 'completed',
      renderedOutput: 'Claude review found 2 issues.',
    });

    const workspaceDir = join(root, 'workspaces', readdirSync(join(root, 'workspaces'))[0]);
    const jobsDir = join(workspaceDir, 'jobs');
    writeFileSync(
      join(jobsDir, 'orphan.json'),
      JSON.stringify({
        id: 'orphan',
        kind: 'review',
        title: 'Stray file',
        summary: 'Should not be indexed',
        workspaceRoot: '/repo/example',
        status: 'completed',
        phase: 'completed',
      }),
      'utf8',
    );

    const jobs = await listJobs(root, '/repo/example');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('Review current diff');
  });

  it('reclaims a stale lock directory before updating a job', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claude-companion-jobs-'));
    const { createJob, readJob, updateJob } = await load();

    const job = await createJob(root, '/repo/example', {
      kind: 'rescue',
      title: 'Stalled background rescue',
      summary: 'Waiting on stale lock recovery',
      status: 'running',
      phase: 'running',
    });

    const workspaceDir = join(root, 'workspaces', readdirSync(join(root, 'workspaces'))[0]);
    const lockDir = join(workspaceDir, 'locks', `${job.id}.lock`);
    mkdirSync(lockDir, { recursive: true });

    const staleAt = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(lockDir, staleAt, staleAt);

    const updated = await Promise.race([
      updateJob(root, '/repo/example', job.id, {
        status: 'cancelled',
        phase: 'cancelled',
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('timed out waiting for stale lock recovery')), 200);
      }),
    ]);

    const stored = await readJob(root, '/repo/example', job.id);

    expect(updated.status).toBe('cancelled');
    expect(stored.status).toBe('cancelled');
    expect(stored.phase).toBe('cancelled');
    expect(stored.completedAt).not.toBeNull();
  });
});
