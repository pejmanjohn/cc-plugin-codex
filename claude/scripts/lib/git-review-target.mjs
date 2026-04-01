import { spawn } from 'node:child_process';

function runGit(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trimEnd());
        return;
      }

      reject(new Error(stderr.trim() || `git ${args.join(' ')} failed`));
    });
  });
}

async function detectBaseBranch(cwd) {
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
    try {
      await runGit(cwd, ['rev-parse', '--verify', candidate]);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error('Unable to detect a base branch. Pass --base <ref>.');
}

export async function resolveReviewTarget(cwd, flags) {
  const statusText = await runGit(cwd, ['status', '--short']);
  const branch = await runGit(cwd, ['branch', '--show-current']);

  if (statusText.trim() !== '') {
    const diffText = await runGit(cwd, ['diff', '--no-ext-diff', 'HEAD', '--']);
    return {
      kind: 'worktree',
      branch,
      statusText,
      diffText,
    };
  }

  const base = flags.base ?? (await detectBaseBranch(cwd));
  const mergeBase = await runGit(cwd, ['merge-base', 'HEAD', base]);
  const diffText = await runGit(cwd, ['diff', '--no-ext-diff', `${mergeBase}...HEAD`]);

  return {
    kind: 'branch',
    branch,
    base,
    statusText,
    diffText,
  };
}
