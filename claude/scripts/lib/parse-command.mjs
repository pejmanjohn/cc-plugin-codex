const STRING_FLAGS = new Set(['--base', '--model', '--effort', '--job']);
const BOOLEAN_FLAGS = new Map([
  ['--background', 'background'],
  ['--resume', 'resume'],
  ['--fresh', 'fresh'],
  ['--json', 'json'],
  ['--enable-review-gate', 'enableReviewGate'],
  ['--disable-review-gate', 'disableReviewGate'],
]);

const SUPPORTED_FLAGS = [...STRING_FLAGS, ...BOOLEAN_FLAGS.keys()].join(', ');

export function parseCommand(argv) {
  const [command, ...rest] = argv;

  if (!command) {
    throw new Error(
      'Missing command. Expected one of: setup, review, adversarial-review, delegate, rescue, status, result, cancel.',
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
  let inTrailingText = false;

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (!inTrailingText) {
      if (token === '--') {
        inTrailingText = true;
        continue;
      }

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

      if (token.startsWith('--')) {
        throw new Error(
          `Unknown flag ${token}. Supported flags: ${SUPPORTED_FLAGS}. ` +
            'Claude Code CLI flags such as --dangerously-skip-permissions are not accepted; ' +
            'this script manages the Claude Code invocation itself. ' +
            'Use a bare -- separator before task text that starts with --.',
        );
      }

      inTrailingText = true;
    }

    trailing.push(token);
  }

  return {
    command,
    flags,
    trailingText: trailing.join(' ').trim(),
  };
}
