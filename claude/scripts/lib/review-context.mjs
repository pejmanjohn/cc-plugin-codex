const MAX_INLINE_DIFF_BYTES = 256 * 1024;

function changedFilesFromDiff(diffText) {
  const fromDiff = [...diffText.matchAll(/^diff --git a\/.*? b\/(.+)$/gm)].map((match) => match[1]);
  const fromUntracked = [...diffText.matchAll(/^--- untracked(?: \([^)]+\))?: (.+?)(?: \(\d+ bytes\))? ---$/gm)].map(
    (match) => match[1],
  );
  return [...new Set([...fromDiff, ...fromUntracked])];
}

function buildDiffSection(diffText) {
  const diffBytes = Buffer.byteLength(diffText, 'utf8');

  if (diffBytes <= MAX_INLINE_DIFF_BYTES) {
    return `Diff:\n${diffText}`;
  }

  const files = changedFilesFromDiff(diffText);
  return [
    `Diff: omitted (${Math.round(diffBytes / 1024)} KB exceeds the ${Math.round(MAX_INLINE_DIFF_BYTES / 1024)} KB inline limit).`,
    'Changed files:',
    files.length > 0 ? files.map((file) => `- ${file}`).join('\n') : '(file list could not be derived from the diff)',
    'Read these files directly from the workspace to review their current contents.',
  ].join('\n');
}

export async function buildReviewContext(input) {
  return [
    `Mode: ${input.mode}`,
    `Workspace: ${input.workspaceRoot}`,
    `Branch: ${input.target.branch}`,
    input.target.base ? `Base: ${input.target.base}` : null,
    'Status:',
    input.target.statusText || '(clean)',
    buildDiffSection(input.target.diffText ?? ''),
    input.trailingText ? `Focus: ${input.trailingText}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}
