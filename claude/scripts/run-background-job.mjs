#!/usr/bin/env node
import { cwd } from 'node:process';
import { pathToFileURL } from 'node:url';
import { getStateRoot, loadRuntimeConfig } from './lib/runtime-config.mjs';
import { runBackgroundJob as runBackgroundRescueJob } from './lib/operations/rescue.mjs';

function parseWorkerArgs(argv) {
  const [jobId, ...rest] = argv;
  const flags = {
    model: undefined,
    effort: undefined,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === '--model' || token === '--effort') {
      const value = rest[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${token}.`);
      }
      flags[token.slice(2)] = value;
      index += 1;
    }
  }

  return { jobId, flags };
}

export async function runBackgroundJob(options) {
  return await runBackgroundRescueJob(options);
}

export async function main(argv = process.argv.slice(2)) {
  const { jobId, flags } = parseWorkerArgs(argv);
  if (!jobId) {
    throw new Error('Missing job id for background worker.');
  }

  const config = await loadRuntimeConfig();
  await runBackgroundRescueJob({
    jobId,
    workspaceRoot: cwd(),
    stateRoot: getStateRoot(),
    config: {
      ...config,
      defaultModel: flags.model ?? config.defaultModel,
      defaultEffort: flags.effort ?? config.defaultEffort,
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
