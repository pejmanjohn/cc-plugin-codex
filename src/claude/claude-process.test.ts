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
