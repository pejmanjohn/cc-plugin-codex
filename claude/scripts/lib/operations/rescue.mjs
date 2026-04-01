import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { parseClaudeEnvelope, runClaudeJson } from '../claude-process.mjs';
import { getJobLogFilePath, readJob, updateJob } from '../jobs-store.mjs';

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

function latestRescueJob(jobs) {
  return [...jobs]
    .filter((job) => job.kind === 'rescue' && typeof job.sessionId === 'string' && job.sessionId.length > 0)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export function selectRescueSession(jobs, flags) {
  if (flags.fresh || !flags.resume) {
    return null;
  }

  return latestRescueJob(jobs)?.sessionId ?? null;
}

export function buildResumeHint(jobs, flags) {
  if (flags.resume || flags.fresh) {
    return null;
  }

  if (!latestRescueJob(jobs)) {
    return null;
  }

  return 'Hint: rerun with --resume to continue the latest rescue thread, or --fresh to start a new one.';
}

function normalizeRescueRuntime(runtimeOrEnv = process.env) {
  if (
    runtimeOrEnv &&
    typeof runtimeOrEnv === 'object' &&
    ('env' in runtimeOrEnv || 'onStdoutChunk' in runtimeOrEnv || 'onStderrChunk' in runtimeOrEnv)
  ) {
    return {
      env: runtimeOrEnv.env ?? process.env,
      onStdoutChunk: runtimeOrEnv.onStdoutChunk,
      onStderrChunk: runtimeOrEnv.onStderrChunk,
    };
  }

  return {
    env: runtimeOrEnv,
    onStdoutChunk: undefined,
    onStderrChunk: undefined,
  };
}

export async function runRescueCore(parsed, sessionId, runtimeOrEnv = process.env) {
  const runtime = normalizeRescueRuntime(runtimeOrEnv);
  const prompt = await readFile('claude/prompts/rescue-system.md', 'utf8');
  const args = [
    '--model',
    parsed.flags.model ?? 'sonnet',
    '--effort',
    parsed.flags.effort ?? 'medium',
  ];

  if (sessionId) {
    args.push('--resume', sessionId);
  }

  const commandResult = await runClaudeJson(
    `${prompt}\n\nTask:\n${parsed.trailingText || 'Investigate the current workspace and report back.'}`,
    args,
    runtime.env,
    {
      onStdoutChunk: runtime.onStdoutChunk,
      onStderrChunk: runtime.onStderrChunk,
    },
  );

  if (commandResult.error) {
    throw new Error(`Claude rescue could not be started: ${commandResult.error.message}`);
  }

  if (commandResult.stdout.trim() === '') {
    throw new Error(commandResult.stderr.trim() || 'Claude rescue returned no JSON output.');
  }

  const envelope = parseClaudeEnvelope(commandResult.stdout);
  if (envelope.isError) {
    throw new Error(envelope.result);
  }

  return {
    sessionId: envelope.sessionId ?? sessionId ?? null,
    rawOutput: envelope.result,
    parsedPayload: { summary: envelope.result },
    renderedOutput: envelope.result,
  };
}

export async function runRescue(parsed, deps) {
  const jobs = await deps.listJobs(deps.stateRoot, deps.workspaceRoot);
  const sessionId = selectRescueSession(jobs, parsed.flags);
  const resumeHint = buildResumeHint(jobs, parsed.flags);
  const job = await deps.createJob(deps.stateRoot, deps.workspaceRoot, {
    kind: 'rescue',
    title: 'Claude rescue',
    summary: parsed.trailingText || 'Delegated rescue task',
    status: parsed.flags.background ? 'queued' : 'running',
    phase: parsed.flags.background ? 'queued' : 'running',
    sessionId,
  });

  if (parsed.flags.background) {
    const logFilePath = getJobLogFilePath(deps.stateRoot, deps.workspaceRoot, job.id);

    try {
      const worker = await deps.spawnBackgroundWorker(job.id, parsed, logFilePath);
      const pid = typeof worker === 'object' && worker !== null ? worker.pid ?? null : worker;
      const processGroupId = typeof worker === 'object' && worker !== null ? worker.processGroupId ?? null : null;
      const updated = await deps.updateJob(deps.stateRoot, deps.workspaceRoot, job.id, {
        logFilePath,
        pid,
        processGroupId,
        status: 'running',
        phase: 'running',
      });

      return {
        job: updated,
        output: resumeHint
          ? `Started background rescue job ${updated.id}. Use $claude-status or $claude-result --job ${updated.id}.\n\n${resumeHint}`
          : `Started background rescue job ${updated.id}. Use $claude-status or $claude-result --job ${updated.id}.`,
      };
    } catch (error) {
      await deps.updateJob(deps.stateRoot, deps.workspaceRoot, job.id, {
        logFilePath,
        status: 'failed',
        phase: 'failed',
        error: serializeError(error),
      });
      throw error;
    }
  }

  try {
    const result = await deps.runRescueCore(parsed, sessionId);
    const updated = await deps.updateJob(deps.stateRoot, deps.workspaceRoot, job.id, {
      status: 'completed',
      phase: 'completed',
      sessionId: result.sessionId,
      rawOutput: result.rawOutput,
      renderedOutput: result.renderedOutput,
      parsedPayload: result.parsedPayload,
    });

    return {
      job: updated,
      output: resumeHint ? `${updated.renderedOutput}\n\n${resumeHint}` : updated.renderedOutput,
    };
  } catch (error) {
    await deps.updateJob(deps.stateRoot, deps.workspaceRoot, job.id, {
      status: 'failed',
      phase: 'failed',
      error: serializeError(error),
    });
    throw error;
  }
}

export async function runBackgroundJob(options) {
  const log = options.log ?? ((chunk) => process.stdout.write(String(chunk)));
  const logLine = (line) => log(line.endsWith('\n') ? line : `${line}\n`);
  const storedJob = await (options.readJob ?? readJob)(options.stateRoot, options.workspaceRoot, options.jobId);
  const writeJobUpdate = options.updateJob ?? updateJob;
  let streamedOutput = '';
  let updateQueue = Promise.resolve();

  const queueUpdate = (patch, { tolerateFailure = false } = {}) => {
    const queued = updateQueue.then(
      () => writeJobUpdate(options.stateRoot, options.workspaceRoot, options.jobId, patch),
      () => writeJobUpdate(options.stateRoot, options.workspaceRoot, options.jobId, patch),
    );

    updateQueue = tolerateFailure ? queued.catch(() => undefined) : queued;
    return queued;
  };
  const recordProgress = (chunk) => {
    log(chunk);
    streamedOutput += chunk;
    void queueUpdate(
      {
        status: 'running',
        phase: 'running',
        rawOutput: streamedOutput,
        renderedOutput: streamedOutput,
      },
      { tolerateFailure: true },
    );
  };

  logLine(`Starting background rescue job ${storedJob.id}.`);
  await queueUpdate({
    status: 'running',
    phase: 'running',
  });

  try {
    const rescueArgs = {
      command: 'rescue',
      flags: {
        background: false,
        resume: Boolean(storedJob.sessionId),
        fresh: false,
        model: options.config.defaultModel,
        effort: options.config.defaultEffort,
      },
      trailingText: storedJob.summary ?? 'Delegated rescue task',
    };
    const runCore = options.runRescueCore ?? runRescueCore;
    const result = await runCore(rescueArgs, storedJob.sessionId ?? null, {
      env: options.env,
      onStdoutChunk: recordProgress,
      onStderrChunk: recordProgress,
    });

    const updated = await queueUpdate({
      status: 'completed',
      phase: 'completed',
      pid: null,
      sessionId: result.sessionId,
      rawOutput: result.rawOutput,
      renderedOutput: result.renderedOutput,
      parsedPayload: result.parsedPayload,
    });

    logLine(result.renderedOutput);
    return updated;
  } catch (error) {
    await queueUpdate({
      status: 'failed',
      phase: 'failed',
      pid: null,
      error: serializeError(error),
    });
    logLine(`Background rescue failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}
