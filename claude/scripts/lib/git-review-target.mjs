import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_UNTRACKED_FILE_BYTES = 65_536;
const MAX_UNTRACKED_TOTAL_BYTES = 262_144;

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

    child.on('error', (error) => {
      reject(new Error(`git could not be started: ${error.message}`));
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

async function buildUntrackedSection(cwd) {
  const raw = await runGit(cwd, ['ls-files', '--others', '--exclude-standard']);
  const paths = raw.split('\n').filter(Boolean);
  if (paths.length === 0) {
    return '';
  }

  const sections = [];
  let totalBytes = 0;

  for (const relPath of paths) {
    try {
      const buffer = await readFile(join(cwd, relPath));

      if (buffer.subarray(0, 8192).includes(0)) {
        sections.push(`--- untracked (binary, omitted): ${relPath} (${buffer.length} bytes) ---`);
        continue;
      }

      if (totalBytes >= MAX_UNTRACKED_TOTAL_BYTES) {
        sections.push(`--- untracked (omitted, size budget reached): ${relPath} (${buffer.length} bytes) ---`);
        continue;
      }

      const truncated = buffer.length > MAX_UNTRACKED_FILE_BYTES;
      const text = buffer.subarray(0, MAX_UNTRACKED_FILE_BYTES).toString('utf8');
      totalBytes += Math.min(buffer.length, MAX_UNTRACKED_FILE_BYTES);
      sections.push(
        `--- untracked: ${relPath} ---\n${text}${truncated ? '\n[truncated]' : ''}`,
      );
    } catch {
      sections.push(`--- untracked (unreadable, omitted): ${relPath} ---`);
    }
  }

  return `Untracked files (full contents; git diff does not include these):\n${sections.join('\n')}`;
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
    if (flags.base) {
      throw new Error(
        'Uncommitted changes present: --base compares committed history, so the worktree changes would be ignored. Commit or stash them first, or rerun without --base to review the worktree.',
      );
    }

    const diffText = await runGit(cwd, ['diff', '--no-ext-diff', 'HEAD', '--']);
    const untrackedText = await buildUntrackedSection(cwd);
    return {
      kind: 'worktree',
      branch,
      statusText,
      diffText: untrackedText ? `${diffText}\n\n${untrackedText}` : diffText,
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
