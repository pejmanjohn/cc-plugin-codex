import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';

const RECENT_JOB_LIMIT = 20;
const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'failed']);
const STALE_LOCK_AGE_MS = 30_000;

function workspaceKey(workspaceRoot) {
  return createHash('sha1').update(workspaceRoot).digest('hex').slice(0, 12);
}

function workspaceDir(stateRoot, workspaceRoot) {
  return join(stateRoot, 'workspaces', workspaceKey(workspaceRoot));
}

function jobFile(stateRoot, workspaceRoot, jobId) {
  return join(workspaceDir(stateRoot, workspaceRoot), 'jobs', `${jobId}.json`);
}

function recentJobsFile(stateRoot, workspaceRoot) {
  return join(workspaceDir(stateRoot, workspaceRoot), 'recent-jobs.json');
}

function jobLockDir(stateRoot, workspaceRoot, jobId) {
  return join(workspaceDir(stateRoot, workspaceRoot), 'locks', `${jobId}.lock`);
}

export function getJobLogFilePath(stateRoot, workspaceRoot, jobId) {
  validateJobId(jobId);
  return join(workspaceDir(stateRoot, workspaceRoot), 'logs', `${jobId}.log`);
}

function validateJobId(jobId) {
  if (typeof jobId !== 'string' || jobId.length === 0) {
    throw new Error('Invalid job id: expected a workspace-local file name.');
  }

  if (isAbsolute(jobId) || jobId.includes('\\') || basename(jobId) !== jobId) {
    throw new Error('Invalid job id: expected a workspace-local file name.');
  }
}

async function readRecentJobIds(stateRoot, workspaceRoot) {
  try {
    const raw = await readFile(recentJobsFile(stateRoot, workspaceRoot), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

async function writeRecentJobIds(stateRoot, workspaceRoot, jobIds) {
  const path = recentJobsFile(stateRoot, workspaceRoot);
  await writeJsonFile(path, jobIds.slice(0, RECENT_JOB_LIMIT));
}

async function updateRecentJobsIndex(stateRoot, workspaceRoot, jobId) {
  const current = await readRecentJobIds(stateRoot, workspaceRoot);
  const next = [jobId, ...current.filter((entry) => entry !== jobId)];
  await writeRecentJobIds(stateRoot, workspaceRoot, next);
}

export async function createJob(stateRoot, workspaceRoot, partial) {
  const now = new Date().toISOString();
  const job = {
    id: randomUUID(),
    workspaceRoot,
    kind: partial.kind,
    title: partial.title,
    summary: partial.summary ?? null,
    status: partial.status,
    phase: partial.phase,
    createdAt: now,
    updatedAt: now,
    completedAt: partial.completedAt ?? null,
    pid: partial.pid ?? null,
    sessionId: partial.sessionId ?? null,
    threadId: partial.threadId ?? null,
    renderedOutput: partial.renderedOutput ?? null,
    parsedPayload: partial.parsedPayload ?? null,
    rawOutput: partial.rawOutput ?? null,
    error: partial.error ?? null,
    logFilePath: partial.logFilePath ?? null,
    ...partial,
  };

  const path = jobFile(stateRoot, workspaceRoot, job.id);
  await writeJsonFile(path, job);
  await updateRecentJobsIndex(stateRoot, workspaceRoot, job.id);
  return job;
}

export async function readJob(stateRoot, workspaceRoot, jobId) {
  validateJobId(jobId);
  const raw = await readFile(jobFile(stateRoot, workspaceRoot, jobId), 'utf8');
  return JSON.parse(raw);
}

export async function updateJob(stateRoot, workspaceRoot, jobId, patch) {
  validateJobId(jobId);
  return await withJobLock(stateRoot, workspaceRoot, jobId, async () => {
    const current = await readJob(stateRoot, workspaceRoot, jobId);
    if (TERMINAL_STATUSES.has(current.status)) {
      return current;
    }

    const next = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    if (TERMINAL_STATUSES.has(next.status) && !next.completedAt) {
      next.completedAt = next.updatedAt;
    }

    await writeJsonFile(jobFile(stateRoot, workspaceRoot, jobId), next);
    return next;
  });
}

export async function listJobs(stateRoot, workspaceRoot) {
  try {
    const jobIds = await readRecentJobIds(stateRoot, workspaceRoot);
    const jobs = await Promise.all(
      jobIds.map(async (jobId) => {
        try {
          return await readJob(stateRoot, workspaceRoot, jobId);
        } catch {
          return null;
        }
      }),
    );
    return jobs.filter(Boolean);
  } catch {
    return [];
  }
}

async function writeJsonFile(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
  await rename(tempPath, path);
}

async function withJobLock(stateRoot, workspaceRoot, jobId, work) {
  const lockDir = jobLockDir(stateRoot, workspaceRoot, jobId);
  await mkdir(dirname(lockDir), { recursive: true });

  for (;;) {
    try {
      await mkdir(lockDir);
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }

      if (await isStaleLock(lockDir)) {
        await rm(lockDir, { recursive: true, force: true });
        continue;
      }

      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  try {
    return await work();
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}

async function isStaleLock(lockDir) {
  try {
    const lockStats = await stat(lockDir);
    return Date.now() - lockStats.mtimeMs > STALE_LOCK_AGE_MS;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}
