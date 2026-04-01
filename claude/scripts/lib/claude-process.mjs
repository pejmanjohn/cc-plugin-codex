import { spawn } from 'node:child_process';

export async function runClaudeJson(prompt, extraArgs = [], env = process.env, hooks = {}) {
  return await new Promise((resolve) => {
    const child = spawn('claude', ['-p', '--output-format', 'json', ...extraArgs, prompt], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      stdout += text;
      hooks.onStdoutChunk?.(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      stderr += text;
      hooks.onStderrChunk?.(text);
    });

    child.on('close', (code) => {
      finish({ code, stdout, stderr });
    });

    child.on('error', (error) => {
      finish({ code: null, stdout, stderr, error });
    });
  });
}

export function parseClaudeEnvelope(stdout) {
  const parsed = JSON.parse(stdout);
  return {
    isError: Boolean(parsed.is_error),
    result: String(parsed.result ?? ''),
    sessionId: parsed.session_id,
  };
}

function isAuthPrompt(text) {
  return /(log\s*in|sign\s*in|authenticate|authentication|auth token|token expired|access denied)/i.test(text);
}

function unavailable(message, sessionId) {
  return {
    ok: false,
    availability: 'unavailable',
    message,
    sessionId,
  };
}

export async function probeClaude(defaultModel, env = process.env) {
  const commandResult = await runClaudeJson('Reply with READY.', ['--model', defaultModel], env);

  if (commandResult.error) {
    return unavailable(
      `Claude Code could not be started: ${commandResult.error.message}`,
      undefined,
    );
  }

  const stdout = commandResult.stdout.trim();
  const stderr = commandResult.stderr.trim();

  if (commandResult.code !== 0 && stdout === '') {
    return unavailable(stderr || 'Claude Code failed before returning JSON.', undefined);
  }

  if (stdout === '') {
    return unavailable(
      stderr || 'Claude Code returned no output. Verify the installation and try again.',
      undefined,
    );
  }

  let envelope;
  try {
    envelope = parseClaudeEnvelope(stdout);
  } catch {
    const combined = `${stdout}\n${stderr}`.trim();
    const guidance = isAuthPrompt(combined)
      ? 'Claude Code returned non-JSON output that looks like an authentication prompt. Sign in to Claude Code and retry.'
      : 'Claude Code returned non-JSON output. Verify the Claude Code installation and retry.';
    return unavailable(guidance, undefined);
  }

  if (envelope.isError) {
    return {
      ok: false,
      availability: 'unavailable',
      message: envelope.result,
      sessionId: envelope.sessionId,
    };
  }

  return {
    ok: true,
    availability: 'ready',
    message: envelope.result,
    sessionId: envelope.sessionId,
  };
}
