import { spawn, spawnSync } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

function formatDuration(ms) {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} minutes` : `${Math.round(ms / 1000)} seconds`;
}

function killClaude(child) {
  if (process.platform === 'win32') {
    if (child.pid) {
      // Kill the whole tree: with shell:true, child.kill would only
      // terminate the wrapping shell and leave claude running.
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    }
    return;
  }

  child.kill('SIGTERM');
  const forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
  forceKillTimer.unref?.();
}

function quoteWindowsArg(arg) {
  if (/^[\w@%+=:,./-]+$/.test(arg)) {
    return arg;
  }

  return `"${arg.replace(/"/g, '\\"')}"`;
}

function spawnClaude(args, env) {
  // npm installs Claude Code on Windows as a claude.cmd shim, which Node
  // refuses to spawn directly (EINVAL) unless a shell is used. With a shell,
  // Node joins the arguments verbatim, so each one must be quoted here.
  if (process.platform === 'win32') {
    return spawn('claude', args.map(quoteWindowsArg), {
      env,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  return spawn('claude', args, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export async function runClaudeJson(prompt, extraArgs = [], env = process.env, hooks = {}) {
  const timeoutMs = hooks.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return await new Promise((resolve) => {
    const child = spawnClaude(['-p', '--output-format', 'json', ...extraArgs], env);

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timeoutError;

    const timeoutTimer = setTimeout(() => {
      timeoutError = new Error(
        `Claude Code run timed out after ${formatDuration(timeoutMs)} and was terminated.`,
      );
      killClaude(child);
    }, timeoutMs);
    timeoutTimer.unref?.();

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutTimer);
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
      finish({ code, stdout, stderr, error: timeoutError });
    });

    child.on('error', (error) => {
      finish({ code: null, stdout, stderr, error: timeoutError ?? error });
    });

    // The prompt goes over stdin rather than argv: argv has hard per-argument
    // size limits (~128 KB on Linux) that full review diffs exceed, and stdin
    // keeps the prompt out of process listings. Ignore stdin errors — if the
    // child fails to start, the 'error' handler above reports it.
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}

export function withClaudeVersionHint(message) {
  if (/unknown or unexpected option|unknown option|unrecognized option/i.test(message)) {
    return `${message}\nYour installed Claude Code likely predates a flag this plugin relies on (such as --effort or --json-schema). Update Claude Code and retry.`;
  }
  return message;
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
  const commandResult = await runClaudeJson('Reply with READY.', ['--model', defaultModel], env, {
    timeoutMs: 2 * 60 * 1000,
  });

  if (commandResult.error) {
    return unavailable(
      `Claude Code could not be started: ${commandResult.error.message}`,
      undefined,
    );
  }

  const stdout = commandResult.stdout.trim();
  const stderr = commandResult.stderr.trim();

  if (commandResult.code !== 0 && stdout === '') {
    return unavailable(withClaudeVersionHint(stderr) || 'Claude Code failed before returning JSON.', undefined);
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
