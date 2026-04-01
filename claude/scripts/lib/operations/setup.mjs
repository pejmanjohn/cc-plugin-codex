export async function runSetup(parsed, deps) {
  const nextConfig = structuredClone(deps.config);

  if (parsed.flags.model) {
    nextConfig.defaultModel = parsed.flags.model;
  }
  if (parsed.flags.enableReviewGate) {
    nextConfig.reviewGate.desiredState = 'enabled';
  }
  if (parsed.flags.disableReviewGate) {
    nextConfig.reviewGate.desiredState = 'disabled';
  }

  await deps.saveConfig(nextConfig);

  const readiness = await deps.probeClaude(nextConfig.defaultModel, deps.env);
  const fallbackModel = nextConfig.fallbackModel;
  const fallbackReadiness =
    fallbackModel && !readiness.ok
      ? await deps.probeClaude(fallbackModel, deps.env)
      : undefined;

  const outputLines = [
    `Claude readiness: ${readiness.status ?? readiness.availability}`,
    `Message: ${readiness.message}`,
  ];

  if (fallbackModel && fallbackReadiness) {
    if (fallbackReadiness.ok) {
      outputLines.push(`Fallback model ${fallbackModel} is usable.`);
    } else {
      outputLines.push(`Fallback model ${fallbackModel} is unavailable: ${fallbackReadiness.message}`);
    }
  }

  if (fallbackModel && !readiness.ok && fallbackReadiness && !fallbackReadiness.ok) {
    outputLines.push(`All configured Claude models are unavailable: ${nextConfig.defaultModel}, ${fallbackModel}.`);
  }

  if (
    nextConfig.reviewGate.desiredState === 'enabled' &&
    nextConfig.reviewGate.capability === 'blocked'
  ) {
    outputLines.push(
      'This plugin is not fully functionally equivalent to codex-plugin-cc until Codex executes installed plugin hooks for the requested review gate.',
    );
    outputLines.push(
      `Review gate requested but unavailable/blocked in Codex because validated installed-plugin runs did not execute bundled plugin hooks: ${nextConfig.reviewGate.reason}`,
    );
  } else {
    outputLines.push(`Review gate: ${nextConfig.reviewGate.capability}`);
  }

  return {
    readiness: {
      model: nextConfig.defaultModel,
      status: readiness.availability,
      message: readiness.message,
      sessionId: readiness.sessionId,
    },
    fallback: fallbackReadiness
      ? {
          model: fallbackModel,
          status: fallbackReadiness.availability,
          message: fallbackReadiness.message,
          sessionId: fallbackReadiness.sessionId,
        }
      : undefined,
    reviewGate: nextConfig.reviewGate,
    output: outputLines.join('\n'),
  };
}
