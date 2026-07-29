import { describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const load = () => import('../../claude/scripts/lib/claude-process.mjs');

describe('claude process invocation', () => {
  it.skipIf(process.platform === 'win32')(
    'sends the prompt over stdin so large review diffs do not hit argv limits',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'claude-process-'));
      const promptCapture = join(dir, 'prompt.txt');
      const fakeClaude = join(dir, 'claude');
      writeFileSync(
        fakeClaude,
        `#!/bin/sh\ncat > "${promptCapture}"\nprintf '%s' '{"is_error":false,"result":"ok","session_id":"abc"}'\n`,
        'utf8',
      );
      chmodSync(fakeClaude, 0o755);

      const { runClaudeJson, parseClaudeEnvelope } = await load();
      const env = { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` };
      const bigPrompt = `review this\n${'x'.repeat(300_000)}`;
      const result = await runClaudeJson(bigPrompt, ['--model', 'opus'], env);

      expect(result.code).toBe(0);
      expect(readFileSync(promptCapture, 'utf8')).toBe(bigPrompt);
      expect(parseClaudeEnvelope(result.stdout).result).toBe('ok');
    },
  );

  it.skipIf(process.platform === 'win32')(
    'terminates runs that exceed the timeout and reports the timeout as the error',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'claude-process-slow-'));
      const fakeClaude = join(dir, 'claude');
      writeFileSync(fakeClaude, '#!/bin/sh\nsleep 30\n', 'utf8');
      chmodSync(fakeClaude, 0o755);

      const { runClaudeJson } = await load();
      const env = { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` };

      const result = await runClaudeJson('hello', [], env, { timeoutMs: 300 });

      expect(result.error?.message).toMatch(/timed out/);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'reports readiness from local auth status without spending an API call',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'claude-process-auth-'));
      const fakeClaude = join(dir, 'claude');
      writeFileSync(
        fakeClaude,
        [
          '#!/bin/sh',
          'if [ "$1" = "auth" ]; then',
          '  printf \'%s\' \'{"loggedIn":true,"authMethod":"claude.ai","email":"dev@example.com"}\'',
          '  exit 0',
          'fi',
          'echo "prompt probe should not run" >&2',
          'exit 1',
        ].join('\n'),
        'utf8',
      );
      chmodSync(fakeClaude, 0o755);

      const { probeClaude } = await load();
      const env = { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` };
      const readiness = await probeClaude('opus', env);

      expect(readiness.ok).toBe(true);
      expect(readiness.availability).toBe('ready');
      expect(readiness.message).toContain('claude.ai');
    },
  );

  it.skipIf(process.platform === 'win32')(
    'reports signed-out installations with sign-in guidance',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'claude-process-auth-out-'));
      const fakeClaude = join(dir, 'claude');
      writeFileSync(
        fakeClaude,
        '#!/bin/sh\nprintf \'%s\' \'{"loggedIn":false}\'\n',
        'utf8',
      );
      chmodSync(fakeClaude, 0o755);

      const { probeClaude } = await load();
      const env = { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` };
      const readiness = await probeClaude('opus', env);

      expect(readiness.ok).toBe(false);
      expect(readiness.message).toMatch(/not signed in/);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'falls back to the live prompt probe when auth status is unsupported',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'claude-process-auth-old-'));
      const fakeClaude = join(dir, 'claude');
      writeFileSync(
        fakeClaude,
        [
          '#!/bin/sh',
          'if [ "$1" = "auth" ]; then',
          '  echo "error: unknown command auth" >&2',
          '  exit 1',
          'fi',
          'cat > /dev/null',
          'printf \'%s\' \'{"is_error":false,"result":"READY","session_id":"abc"}\'',
        ].join('\n'),
        'utf8',
      );
      chmodSync(fakeClaude, 0o755);

      const { probeClaude } = await load();
      const env = { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` };
      const readiness = await probeClaude('opus', env);

      expect(readiness.ok).toBe(true);
      expect(readiness.message).toBe('READY');
    },
  );

  it('appends an update hint when Claude Code rejects a flag it does not know', async () => {
    const { withClaudeVersionHint } = await load();

    expect(withClaudeVersionHint("error: unknown option '--effort'")).toMatch(/Update Claude Code/);
    expect(withClaudeVersionHint('API rate limit reached')).toBe('API rate limit reached');
  });

  it.skipIf(process.platform === 'win32')(
    'resolves with an error instead of hanging when claude cannot be spawned',
    async () => {
      const emptyDir = mkdtempSync(join(tmpdir(), 'claude-process-empty-'));
      const { runClaudeJson } = await load();
      const env = { ...process.env, PATH: emptyDir };

      const result = await runClaudeJson('hello', [], env);

      expect(result.error).toBeTruthy();
    },
  );
});
