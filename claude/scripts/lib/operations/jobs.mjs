import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { listJobs, readJob, updateJob } from '../jobs-store.mjs';

function isMissingProcess(error) {
  return error?.code === 'ESRCH';
}

function terminateJob(job) {
  if (process.platform === 'win32') {
    if (job.pid) {
      // process.kill on Windows cannot signal a process group, which would
      // orphan the claude child; taskkill /t terminates the whole tree.
      // A non-zero exit means the process is already gone, which is fine.
      spawnSync('taskkill', ['/pid', String(job.pid), '/t', '/f'], { stdio: 'ignore' });
    }
    return;
  }

  if (job.processGroupId) {
    try {
      process.kill(-job.processGroupId, 'SIGTERM');
      return;
    } catch (error) {
      if (!isMissingProcess(error)) {
        throw error;
      }
    }
  }

  if (job.pid) {
    try {
      process.kill(job.pid, 'SIGTERM');
    } catch (error) {
      if (!isMissingProcess(error)) {
        throw error;
      }
    }
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function reconcileDeadWorker(deps, job) {
  if (job.status !== 'running' || !job.pid || isProcessAlive(job.pid)) {
    return job;
  }

  return await updateJob(deps.stateRoot, deps.workspaceRoot, job.id, {
    status: 'failed',
    phase: 'failed',
    pid: null,
    processGroupId: null,
    error: {
      message: 'Background worker process is no longer running; the job was marked failed during status reconciliation.',
    },
  });
}

export async function runStatus(parsed, deps) {
  const storedJobs = await listJobs(deps.stateRoot, deps.workspaceRoot);
  const jobs = await Promise.all(storedJobs.map((job) => reconcileDeadWorker(deps, job)));
  const output =
    jobs.length === 0
      ? 'No Claude Companion jobs recorded for this workspace.'
      : jobs.map((job) => `${job.id}  ${job.status}  ${job.kind}  ${job.summary ?? job.title}`).join('\n');

  return { jobs, output };
}

export async function runResult(parsed, deps) {
  if (!parsed.flags.job) {
    throw new Error('result requires --job <id>.');
  }

  const stored = await readJob(deps.stateRoot, deps.workspaceRoot, parsed.flags.job);
  const job = await reconcileDeadWorker(deps, stored);

  if (job.status === 'running' || job.status === 'queued') {
    return {
      job,
      output: `Job ${job.id} is still ${job.status}. Check again shortly, or cancel it with $claude-cancel --job ${job.id}.`,
    };
  }

  if (job.status === 'failed') {
    return {
      job,
      output: `Job ${job.id} failed: ${job.error?.message ?? 'unknown error'}`,
    };
  }

  return {
    job,
    output: job.renderedOutput || job.rawOutput || 'Job completed without captured output.',
  };
}

export async function runCancel(parsed, deps) {
  if (!parsed.flags.job) {
    throw new Error('cancel requires --job <id>.');
  }

  const job = await readJob(deps.stateRoot, deps.workspaceRoot, parsed.flags.job);

  if (job.status !== 'running' && job.phase !== 'running') {
    throw new Error(`Cannot cancel job ${job.id} because it is ${job.status ?? job.phase ?? 'not running'}.`);
  }

  terminateJob(job);

  const updated = await updateJob(deps.stateRoot, deps.workspaceRoot, parsed.flags.job, {
    status: 'cancelled',
    phase: 'cancelled',
    pid: null,
    processGroupId: null,
  });

  return {
    job: updated,
    output: `Cancelled job ${updated.id}.`,
  };
}
