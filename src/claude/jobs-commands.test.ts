import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const loadStore = () => import('../../claude/scripts/lib/jobs-store.mjs');
const loadJobs = () => import('../../claude/scripts/lib/operations/jobs.mjs');

describe('jobs operations', () => {
  const invalidJobIds = ['/tmp/foo', '../foo'];

  it('renders status from the recent-jobs index and ignores stray files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claude-companion-jobs-'));
    const { createJob } = await loadStore();
    const { runStatus } = await loadJobs();

    const job = await createJob(root, '/repo/example', {
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
        summary: 'Should not show up',
        workspaceRoot: '/repo/example',
        status: 'completed',
        phase: 'completed',
      }),
      'utf8',
    );

    const status = await runStatus({ flags: { json: false } }, { stateRoot: root, workspaceRoot: '/repo/example' });

    expect(status.output).toContain(job.id);
    expect(status.output).not.toContain('orphan');
  });

  it.each(invalidJobIds)('rejects invalid job ids in runResult: %s', async (jobId) => {
    const root = mkdtempSync(join(tmpdir(), 'claude-companion-jobs-'));
    const { runResult } = await loadJobs();

    await expect(
      runResult(
        { flags: { json: false, job: jobId } },
        { stateRoot: root, workspaceRoot: '/repo/example' },
      ),
    ).rejects.toThrow(/invalid job id/i);
  });

  it.each(invalidJobIds)('rejects invalid job ids in runCancel: %s', async (jobId) => {
    const root = mkdtempSync(join(tmpdir(), 'claude-companion-jobs-'));
    const { runCancel } = await loadJobs();

    await expect(
      runCancel(
        { flags: { json: false, job: jobId } },
        { stateRoot: root, workspaceRoot: '/repo/example' },
      ),
    ).rejects.toThrow(/invalid job id/i);
  });

  it('cancels a detached running rescue job by process group and records the terminal state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claude-companion-jobs-'));
    const { createJob, readJob } = await loadStore();
    const { runCancel } = await loadJobs();
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);

    const job = await createJob(root, '/repo/example', {
      kind: 'rescue',
      title: 'Background rescue',
      summary: 'Running job',
      status: 'running',
      phase: 'running',
      pid: 43210,
      processGroupId: 43210,
    });

    const result = await runCancel(
      { flags: { json: false, job: job.id } },
      { stateRoot: root, workspaceRoot: '/repo/example' },
    );
    const stored = await readJob(root, '/repo/example', job.id);

    expect(killSpy).toHaveBeenCalledWith(-43210, 'SIGTERM');
    expect(result.output).toContain(job.id);
    expect(stored.status).toBe('cancelled');
    expect(stored.phase).toBe('cancelled');
    expect(stored.completedAt).not.toBeNull();
    expect(stored.pid).toBeNull();
    killSpy.mockRestore();
  });

  it('refuses to cancel an already-terminal job without overwriting its state', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claude-companion-jobs-'));
    const { createJob, readJob } = await loadStore();
    const { runCancel } = await loadJobs();

    const job = await createJob(root, '/repo/example', {
      kind: 'review',
      title: 'Completed review',
      summary: 'All done',
      status: 'completed',
      phase: 'completed',
      renderedOutput: 'Finished.',
      completedAt: '2026-03-31T00:00:00.000Z',
    });

    await expect(
      runCancel(
        { flags: { json: false, job: job.id } },
        { stateRoot: root, workspaceRoot: '/repo/example' },
      ),
    ).rejects.toThrow(/cancel/i);

    const stored = await readJob(root, '/repo/example', job.id);
    expect(stored.status).toBe('completed');
    expect(stored.phase).toBe('completed');
  });
});
