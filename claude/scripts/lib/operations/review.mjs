import { readFile } from 'node:fs/promises';

export function pickReviewPrompt(command) {
  return command === 'adversarial-review'
    ? 'claude/prompts/adversarial-system.md'
    : 'claude/prompts/review-system.md';
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

export async function runReview(parsed, deps) {
  const target = await deps.resolveReviewTarget(deps.workspaceRoot, parsed.flags);
  const context = await deps.buildReviewContext({
    workspaceRoot: deps.workspaceRoot,
    mode: parsed.command,
    target,
    trailingText: parsed.trailingText,
  });

  const promptPath = pickReviewPrompt(parsed.command);
  const prompt = await readFile(promptPath, 'utf8');
  const job = await deps.createJob(deps.stateRoot, deps.workspaceRoot, {
    kind: parsed.command,
    title: parsed.command === 'adversarial-review' ? 'Claude adversarial review' : 'Claude review',
    summary: parsed.trailingText || 'Review current repository state',
    status: 'running',
    phase: 'running',
  });

  try {
    const reviewResult = await deps.runClaudeReview({
      prompt,
      context,
      model: parsed.flags.model ?? deps.config.defaultModel,
    });

    const renderedOutput = deps.renderReviewOutput(reviewResult.parsedPayload);
    const completedJob = await deps.updateJob(deps.stateRoot, deps.workspaceRoot, job.id, {
      kind: job.kind,
      title: job.title,
      summary: `${reviewResult.parsedPayload.findings?.length ?? 0} findings`,
      status: 'completed',
      phase: 'completed',
      rawOutput: reviewResult.rawOutput,
      parsedPayload: reviewResult.parsedPayload,
      renderedOutput,
    });

    return {
      job: completedJob,
      output: renderedOutput,
    };
  } catch (error) {
    await deps.updateJob(deps.stateRoot, deps.workspaceRoot, job.id, {
      kind: job.kind,
      title: job.title,
      summary: job.summary,
      status: 'failed',
      phase: 'failed',
      error: serializeError(error),
    });

    throw error;
  }
}
