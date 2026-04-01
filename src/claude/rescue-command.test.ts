import { describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const loadRescue = () => import('../../claude/scripts/lib/operations/rescue.mjs');
const loadStore = () => import('../../claude/scripts/lib/jobs-store.mjs');
const loadWorker = () => import('../../claude/scripts/run-background-job.mjs');
const loadClaudeProcess = () => import('../../claude/scripts/lib/claude-process.mjs');

function createFakeClaudeExecutable(body: string) {
  const root = mkdtempSync(join(tmpdir(), 'claude-fake-cli-'));
  const binDir = join(root, 'bin');
  const exePath = join(binDir, 'claude');

  mkdirSync(binDir, { recursive: true });
  writeFileSync(exePath, `#!/bin/sh\n${body}\n`, 'utf8');
  chmodSync(exePath, 0o755);

  return {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
    },
  };
}

describe('rescue operation', () => {
  it('streams Claude stdout and stderr chunks while still aggregating the final result', async () => {
    const { runClaudeJson } = await loadClaudeProcess();
    const fake = createFakeClaudeExecutable([
      'printf \'{"is_error":false,\'',
      'sleep 0.1',
      'printf \'"result":"streamed done","session_id":"session-stream"}\'',
      'printf \'progress line\\n\' >&2',
    ].join('\n'));
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const result = await runClaudeJson(
      'Reply with streamed output.',
      ['--model', 'sonnet'],
      fake.env,
      {
        onStdoutChunk: (chunk) => stdoutChunks.push(String(chunk)),
        onStderrChunk: (chunk) => stderrChunks.push(String(chunk)),
      },
    );

    expect(result.stdout).toContain('"session_id":"session-stream"');
    expect(result.stderr).toContain('progress line');
    expect(stdoutChunks.join('')).toBe(result.stdout);
    expect(stderrChunks.join('')).toBe(result.stderr);
  });

  it('spawns a background worker when --background is set and persists a durable logFilePath', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claude-companion-rescue-'));
    const { runRescue } = await loadRescue();
    const { createJob, readJob, listJobs, updateJob } = await loadStore();
    const spawnBackgroundWorker = vi.fn(async () => 4242);

    const result = await runRescue(
      {
        command: 'rescue',
        flags: {
          background: true,
          resume: false,
          fresh: false,
          model: undefined,
          effort: undefined,
        },
        trailingText: 'investigate retry flakiness',
      },
      {
        stateRoot: root,
        workspaceRoot: '/repo/example',
        config: { defaultModel: 'sonnet', defaultEffort: 'medium' },
        createJob,
        updateJob,
        listJobs,
        spawnBackgroundWorker,
      },
    );

    const [job] = await listJobs(root, '/repo/example');
    const stored = await readJob(root, '/repo/example', job.id);

    expect(spawnBackgroundWorker).toHaveBeenCalledWith(
      job.id,
      expect.objectContaining({ trailingText: 'investigate retry flakiness' }),
      stored.logFilePath,
    );
    expect(stored.logFilePath).toMatch(new RegExp(`${job.id}.*\\.log$`));
    expect(result.output).toContain(job.id);
  });

  it('reuses the latest rescue session when --resume is set', async () => {
    const { selectRescueSession } = await loadRescue();

    const session = selectRescueSession(
      [
        { id: 'job-1', kind: 'review', sessionId: 'review-1', createdAt: '2026-03-31T21:00:00.000Z' },
        { id: 'job-7', kind: 'rescue', sessionId: 'session-7', createdAt: '2026-03-31T23:00:00.000Z' },
        { id: 'job-3', kind: 'rescue', sessionId: 'session-3', createdAt: '2026-03-31T22:00:00.000Z' },
      ],
      { resume: true, fresh: false },
    );

    expect(session).toBe('session-7');
  });

  it('surfaces a concise resume hint when a prior rescue session exists and no routing flag is passed', async () => {
    const { runRescue } = await loadRescue();
    const runRescueCore = vi.fn(async () => ({
      sessionId: 'session-new',
      rawOutput: 'Done',
      parsedPayload: { summary: 'Done' },
      renderedOutput: 'Done',
    }));

    const result = await runRescue(
      {
        command: 'rescue',
        flags: {
          background: false,
          resume: false,
          fresh: false,
          model: undefined,
          effort: undefined,
        },
        trailingText: 'investigate flaky retries',
      },
      {
        stateRoot: '/state',
        workspaceRoot: '/repo/example',
        config: { defaultModel: 'sonnet', defaultEffort: 'medium' },
        createJob: vi.fn(async (_root, _workspaceRoot, job) => ({ id: 'job-1', ...job })),
        updateJob: vi.fn(async (_root, _workspaceRoot, _jobId, patch) => ({ id: 'job-1', ...patch })),
        listJobs: vi.fn(async () => [
          {
            id: 'job-9',
            kind: 'rescue',
            summary: 'Previous rescue',
            sessionId: 'session-9',
            createdAt: '2026-03-31T23:00:00.000Z',
          },
        ]),
        runRescueCore,
      },
    );

    expect(runRescueCore).toHaveBeenCalledWith(expect.anything(), null);
    expect(result.output).toContain('Done');
    expect(result.output).toContain('--resume');
    expect(result.output).toContain('--fresh');
  });

  it('completes a persisted rescue job from the background worker entrypoint', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claude-companion-rescue-'));
    const { createJob, readJob } = await loadStore();
    const { runBackgroundJob } = await loadWorker();
    const runRescueCore = vi.fn(async () => ({
      sessionId: 'session-42',
      rawOutput: 'Background rescue finished',
      parsedPayload: { summary: 'Background rescue finished' },
      renderedOutput: 'Background rescue finished',
    }));

    const job = await createJob(root, '/repo/example', {
      kind: 'rescue',
      title: 'Claude rescue',
      summary: 'Investigate flaky retries',
      status: 'running',
      phase: 'running',
      logFilePath: join(root, 'logs', 'job-1.log'),
      sessionId: 'session-prior',
    });

    await runBackgroundJob({
      jobId: job.id,
      workspaceRoot: '/repo/example',
      stateRoot: root,
      config: { defaultModel: 'sonnet', defaultEffort: 'medium' },
      log: vi.fn(),
      runRescueCore,
    });

    const stored = await readJob(root, '/repo/example', job.id);
    expect(runRescueCore).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: expect.objectContaining({ model: 'sonnet', effort: 'medium' }),
        trailingText: 'Investigate flaky retries',
      }),
      'session-prior',
      expect.objectContaining({
        onStdoutChunk: expect.any(Function),
        onStderrChunk: expect.any(Function),
      }),
    );
    expect(stored.status).toBe('completed');
    expect(stored.phase).toBe('completed');
    expect(stored.sessionId).toBe('session-42');
    expect(stored.renderedOutput).toBe('Background rescue finished');
  });

  it('passes streaming sinks into rescue core and persists a running snapshot before completion', async () => {
    const { runBackgroundJob } = await loadWorker();
    const log = vi.fn();
    const updateJob = vi.fn(async (_stateRoot, _workspaceRoot, _jobId, patch) => ({ id: 'job-1', ...patch }));
    const readJob = vi.fn(async () => ({
      id: 'job-1',
      kind: 'rescue',
      title: 'Claude rescue',
      summary: 'Investigate flaky retries',
      status: 'running',
      phase: 'running',
      sessionId: 'session-prior',
    }));
    const runRescueCore = vi.fn(async (_parsed, _sessionId, runtime) => {
      runtime?.onStdoutChunk?.('step 1\n');
      runtime?.onStderrChunk?.('step 2\n');
      return {
        sessionId: 'session-next',
        rawOutput: 'Background rescue finished',
        parsedPayload: { summary: 'Background rescue finished' },
        renderedOutput: 'Background rescue finished',
      };
    });

    await runBackgroundJob({
      jobId: 'job-1',
      workspaceRoot: '/repo/example',
      stateRoot: '/state',
      config: { defaultModel: 'sonnet', defaultEffort: 'medium' },
      log,
      readJob,
      updateJob,
      runRescueCore,
    });

    expect(runRescueCore).toHaveBeenCalledWith(
      expect.anything(),
      'session-prior',
      expect.objectContaining({
        onStdoutChunk: expect.any(Function),
        onStderrChunk: expect.any(Function),
      }),
    );
    expect(log).toHaveBeenCalledWith('step 1\n');
    expect(log).toHaveBeenCalledWith('step 2\n');
    expect(updateJob).toHaveBeenNthCalledWith(
      1,
      '/state',
      '/repo/example',
      'job-1',
      expect.objectContaining({
        status: 'running',
        phase: 'running',
      }),
    );
    expect(updateJob).toHaveBeenLastCalledWith(
      '/state',
      '/repo/example',
      'job-1',
      expect.objectContaining({
        status: 'completed',
        phase: 'completed',
      }),
    );
  });

  it('does not let a later background completion overwrite a cancelled rescue job', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claude-companion-rescue-'));
    const { createJob, readJob, updateJob } = await loadStore();
    const { runBackgroundJob } = await loadWorker();

    const job = await createJob(root, '/repo/example', {
      kind: 'rescue',
      title: 'Claude rescue',
      summary: 'Investigate flaky retries',
      status: 'running',
      phase: 'running',
      pid: 22222,
      processGroupId: 22222,
      sessionId: 'session-prior',
    });

    await runBackgroundJob({
      jobId: job.id,
      workspaceRoot: '/repo/example',
      stateRoot: root,
      config: { defaultModel: 'sonnet', defaultEffort: 'medium' },
      log: vi.fn(),
      updateJob,
      runRescueCore: async (_parsed, _sessionId, runtime) => {
        runtime?.onStdoutChunk?.('step 1\n');
        await updateJob(root, '/repo/example', job.id, {
          status: 'cancelled',
          phase: 'cancelled',
          pid: null,
          processGroupId: null,
        });

        return {
          sessionId: 'session-next',
          rawOutput: 'Background rescue finished',
          parsedPayload: { summary: 'Background rescue finished' },
          renderedOutput: 'Background rescue finished',
        };
      },
    });

    const stored = await readJob(root, '/repo/example', job.id);
    expect(stored.status).toBe('cancelled');
    expect(stored.phase).toBe('cancelled');
    expect(stored.pid).toBeNull();
    expect(stored.renderedOutput).not.toBe('Background rescue finished');
    expect(stored.sessionId).toBe('session-prior');
  });

  it('keeps the final terminal write reachable when a background progress write fails', async () => {
    const { runBackgroundJob } = await loadWorker();
    const log = vi.fn();
    const updateJob = vi.fn(async (_stateRoot, _workspaceRoot, _jobId, patch) => {
      if (patch.renderedOutput === 'step 1\n') {
        throw new Error('transient write failure');
      }

      return { id: 'job-1', ...patch };
    });
    const readJob = vi.fn(async () => ({
      id: 'job-1',
      kind: 'rescue',
      title: 'Claude rescue',
      summary: 'Investigate flaky retries',
      status: 'running',
      phase: 'running',
      sessionId: 'session-prior',
    }));
    const runRescueCore = vi.fn(async (_parsed, _sessionId, runtime) => {
      runtime?.onStdoutChunk?.('step 1\n');
      return {
        sessionId: 'session-next',
        rawOutput: 'Background rescue finished',
        parsedPayload: { summary: 'Background rescue finished' },
        renderedOutput: 'Background rescue finished',
      };
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => {
      unhandled.push(error);
    };

    process.on('unhandledRejection', onUnhandled);
    try {
      const result = await runBackgroundJob({
        jobId: 'job-1',
        workspaceRoot: '/repo/example',
        stateRoot: '/state',
        config: { defaultModel: 'sonnet', defaultEffort: 'medium' },
        log,
        readJob,
        updateJob,
        runRescueCore,
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(result.status).toBe('completed');
      expect(updateJob).toHaveBeenLastCalledWith(
        '/state',
        '/repo/example',
        'job-1',
        expect.objectContaining({
          status: 'completed',
          phase: 'completed',
          sessionId: 'session-next',
        }),
      );
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
