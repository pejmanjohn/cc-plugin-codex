import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const skills = new Map([
  ['claude-review', 'review'],
  ['claude-adversarial-review', 'adversarial-review'],
  ['claude-delegate', 'delegate'],
  ['claude-rescue', 'rescue'],
  ['claude-status', 'status'],
  ['claude-result', 'result'],
  ['claude-cancel', 'cancel'],
  ['claude-setup', 'setup'],
]);

describe('claude skill surface', () => {
  it('ships thin bundled skills that shell into the shared runtime', () => {
    for (const [skill, command] of skills) {
      const path = `claude/skills/${skill}/SKILL.md`;
      expect(existsSync(path)).toBe(true);
      const contents = readFileSync(path, 'utf8');
      expect(contents).toContain('directory two levels above this `SKILL.md` file');
      expect(contents).toContain(`node <plugin-root>/scripts/claude-companion.mjs ${command}`);
      expect(contents).not.toContain('node claude/scripts/claude-companion.mjs');
      expect(contents).toContain('Do not implement logic in this skill');
    }
  });

  it('documents the blocked automatic review gate honestly', () => {
    const readme = readFileSync('claude/README.md', 'utf8');
    expect(readme).toContain('automatic stop-time review gate is currently unavailable/blocked in the Codex plugin runtime');
  });
});
