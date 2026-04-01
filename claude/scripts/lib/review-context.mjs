export async function buildReviewContext(input) {
  return [
    `Mode: ${input.mode}`,
    `Workspace: ${input.workspaceRoot}`,
    `Branch: ${input.target.branch}`,
    input.target.base ? `Base: ${input.target.base}` : null,
    'Status:',
    input.target.statusText || '(clean)',
    'Diff:',
    input.target.diffText,
    input.trailingText ? `Focus: ${input.trailingText}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}
