#!/usr/bin/env node
import { cwd } from 'node:process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { parseCommand } from './lib/parse-command.mjs';
import { loadRuntimeConfig, saveRuntimeConfig, getStateRoot } from './lib/runtime-config.mjs';
import { probeClaude, runClaudeJson, parseClaudeEnvelope } from './lib/claude-process.mjs';
import { runSetup } from './lib/operations/setup.mjs';
import { runStatus, runResult, runCancel } from './lib/operations/jobs.mjs';
import { runReview } from './lib/operations/review.mjs';
import { runRescue, runRescueCore } from './lib/operations/rescue.mjs';
import { createJob, listJobs, updateJob } from './lib/jobs-store.mjs';
import { resolveReviewTarget } from './lib/git-review-target.mjs';
import { buildReviewContext } from './lib/review-context.mjs';
import { renderReviewOutput } from './lib/render-output.mjs';

function printLine(value) {
  process.stdout.write(value.endsWith('\n') ? value : `${value}\n`);
}

async function runClaudeReview({ prompt, context, model }) {
  const schema = await readFile('claude/schemas/review-findings.schema.json', 'utf8');
  const commandResult = await runClaudeJson(`${prompt}\n\n${context}`, ['--model', model, '--json-schema', schema], process.env);
  const envelope = parseClaudeEnvelope(commandResult.stdout);
  if (envelope.isError) {
    throw new Error(envelope.result);
  }
  return {
    rawOutput: envelope.result,
    parsedPayload: JSON.parse(envelope.result),
  };
}

async function spawnBackgroundWorker(jobId, parsed, logFilePath) {
  await mkdir(dirname(logFilePath), { recursive: true });
  const logFile = openSync(logFilePath, 'a');
  try {
    const args = ['claude/scripts/run-background-job.mjs', jobId];

    if (parsed.flags.model) {
      args.push('--model', parsed.flags.model);
    }

    if (parsed.flags.effort) {
      args.push('--effort', parsed.flags.effort);
    }

    const child = spawn('node', args, {
      cwd: cwd(),
      detached: true,
      env: process.env,
      stdio: ['ignore', logFile, logFile],
    });
    child.unref();
    return {
      pid: child.pid,
      processGroupId: child.pid,
    };
  } finally {
    closeSync(logFile);
  }
}

async function main(argv = process.argv.slice(2)) {
  const parsed = parseCommand(argv);
  const config = await loadRuntimeConfig();
  const stateRoot = getStateRoot();
  const deps = {
    config,
    stateRoot,
    workspaceRoot: cwd(),
    probeClaude,
    saveConfig: (nextConfig) => saveRuntimeConfig(nextConfig),
    env: process.env,
    resolveReviewTarget,
    buildReviewContext,
    runClaudeReview,
    runRescueCore: (nextParsed, sessionId) =>
      runRescueCore(
        {
          ...nextParsed,
          flags: {
            ...nextParsed.flags,
            model: nextParsed.flags.model ?? config.defaultModel,
            effort: nextParsed.flags.effort ?? config.defaultEffort,
          },
        },
        sessionId,
        process.env,
      ),
    createJob,
    listJobs,
    updateJob,
    spawnBackgroundWorker,
    renderReviewOutput,
  };

  let result;
  switch (parsed.command) {
    case 'setup':
      result = await runSetup(parsed, deps);
      break;
    case 'status':
      result = await runStatus(parsed, deps);
      break;
    case 'result':
      result = await runResult(parsed, deps);
      break;
    case 'cancel':
      result = await runCancel(parsed, deps);
      break;
    case 'review':
    case 'adversarial-review':
      result = await runReview(parsed, deps);
      break;
    case 'rescue':
      result = await runRescue(parsed, deps);
      break;
    default:
      throw new Error(`Command not wired yet: ${parsed.command}`);
  }

  printLine(parsed.flags.json ? JSON.stringify(result, null, 2) : result.output);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
