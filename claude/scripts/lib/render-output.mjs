export function renderReviewOutput(parsedPayload) {
  const findings = parsedPayload?.findings ?? [];

  if (findings.length === 0) {
    return 'Claude review found no actionable issues.';
  }

  return [
    `Claude review found ${findings.length} issue${findings.length === 1 ? '' : 's'}.`,
    ...findings.map(
      (finding) =>
        `[${finding.severity}] ${finding.file}:${finding.line_start} ${finding.title}\n${finding.body}\nRecommendation: ${finding.recommendation}`,
    ),
  ].join('\n\n');
}
