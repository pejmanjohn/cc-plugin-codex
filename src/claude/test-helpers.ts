import { mkdirSync, mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export const run = (command: string, args: string[], cwd?: string): CommandResult => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
  });

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
};

export const makeTempHome = () => {
  const root = mkdtempSync(join(tmpdir(), 'claude-companion-home-'));
  mkdirSync(join(root, '.codex'), { recursive: true });
  return root;
};

export const writeFile = (
  root: string,
  relativePath: string,
  contents: string,
  executable = false,
) => {
  const fullPath = join(root, relativePath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, contents, 'utf8');
  if (executable) chmodSync(fullPath, 0o755);
  return fullPath;
};
