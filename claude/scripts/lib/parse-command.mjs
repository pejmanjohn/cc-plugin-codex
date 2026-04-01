const STRING_FLAGS = new Set(['--base', '--model', '--effort', '--job']);
const BOOLEAN_FLAGS = new Map([
  ['--background', 'background'],
  ['--resume', 'resume'],
  ['--fresh', 'fresh'],
  ['--json', 'json'],
  ['--enable-review-gate', 'enableReviewGate'],
  ['--disable-review-gate', 'disableReviewGate'],
]);

export function parseCommand(argv) {
  const [command, ...rest] = argv;

  if (!command) {
    throw new Error(
      'Missing command. Expected one of: setup, review, adversarial-review, rescue, status, result, cancel.',
    );
  }

  const flags = {
    background: false,
    base: undefined,
    model: undefined,
    effort: undefined,
    resume: false,
    fresh: false,
    job: undefined,
    json: false,
    enableReviewGate: false,
    disableReviewGate: false,
  };

  const trailing = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (STRING_FLAGS.has(token)) {
      const value = rest[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${token}.`);
      }
      flags[token.slice(2)] = value;
      index += 1;
      continue;
    }

    if (BOOLEAN_FLAGS.has(token)) {
      flags[BOOLEAN_FLAGS.get(token)] = true;
      continue;
    }

    trailing.push(token);
  }

  return {
    command,
    flags,
    trailingText: trailing.join(' ').trim(),
  };
}
