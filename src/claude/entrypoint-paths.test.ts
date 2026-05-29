import { describe, expect, it } from 'vitest';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

function createFakeClaudeExecutable(result: string) {
  const root = mkdtempSync(join(tmpdir(), 'claude-entrypoint-fake-cli-'));
  const binDir = join(root, 'bin');
  const exePath = join(binDir, 'claude');

  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    exePath,
    [
      '#!/usr/bin/env node',
      'process.stdout.write(JSON.stringify({',
      '  is_error: false,',
      `  result: ${JSON.stringify(result)},`,
      '  session_id: "session-entrypoint"',
      '}));',
    ].join('\n'),
    'utf8',
  );
  chmodSync(exePath, 0o755);

  return {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
    },
  };
}

function createGitWorkspace() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'claude-entrypoint-workspace-'));

  execFileSync('git', ['init'], { cwd: workspaceRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: workspaceRoot });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: workspaceRoot });
  writeFileSync(join(workspaceRoot, 'example.txt'), 'before\n', 'utf8');
  execFileSync('git', ['add', 'example.txt'], { cwd: workspaceRoot });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: workspaceRoot, stdio: 'ignore' });
  writeFileSync(join(workspaceRoot, 'example.txt'), 'after\n', 'utf8');

  return workspaceRoot;
}

function createInstalledPluginBundle() {
  const root = mkdtempSync(join(tmpdir(), 'claude-entrypoint-plugin-'));
  const pluginRoot = join(root, 'claude-companion');
  cpSync('claude', pluginRoot, { recursive: true });
  return pluginRoot;
}

describe('entrypoint asset paths', () => {
  it('runs review from an arbitrary workspace while reading installed bundled prompts and schemas', () => {
    const workspaceRoot = createGitWorkspace();
    const stateRoot = mkdtempSync(join(tmpdir(), 'claude-entrypoint-state-'));
    const fake = createFakeClaudeExecutable(JSON.stringify({ findings: [] }));
    const entrypoint = join(createInstalledPluginBundle(), 'scripts/claude-companion.mjs');

    const stdout = execFileSync('node', [entrypoint, 'review'], {
      cwd: workspaceRoot,
      env: {
        ...fake.env,
        CLAUDE_COMPANION_STATE_ROOT: stateRoot,
      },
      encoding: 'utf8',
    });

    expect(stdout).toContain('Claude review found no actionable issues.');
  });

  it('runs rescue from an arbitrary workspace while reading the installed bundled rescue prompt', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'claude-entrypoint-workspace-'));
    const stateRoot = mkdtempSync(join(tmpdir(), 'claude-entrypoint-state-'));
    const fake = createFakeClaudeExecutable('rescue finished');
    const entrypoint = join(createInstalledPluginBundle(), 'scripts/claude-companion.mjs');

    const stdout = execFileSync('node', [entrypoint, 'rescue', 'investigate path handling'], {
      cwd: workspaceRoot,
      env: {
        ...fake.env,
        CLAUDE_COMPANION_STATE_ROOT: stateRoot,
      },
      encoding: 'utf8',
    });

    expect(stdout).toContain('rescue finished');
  });
});
