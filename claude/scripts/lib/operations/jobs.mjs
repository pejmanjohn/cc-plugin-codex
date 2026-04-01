import process from 'node:process';
import { listJobs, readJob, updateJob } from '../jobs-store.mjs';

function isMissingProcess(error) {
  return error?.code === 'ESRCH';
}

function terminateJob(job) {
  if (job.processGroupId && process.platform !== 'win32') {
    try {
      process.kill(-job.processGroupId, 'SIGTERM');
      return;
    } catch (error) {
      if (!job.pid || !isMissingProcess(error)) {
        throw error;
      }
    }
  }

  if (job.pid) {
    process.kill(job.pid, 'SIGTERM');
  }
}

export async function runStatus(parsed, deps) {
  const jobs = await listJobs(deps.stateRoot, deps.workspaceRoot);
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

  const job = await readJob(deps.stateRoot, deps.workspaceRoot, parsed.flags.job);

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
