import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const skills = [
  'claude-review',
  'claude-adversarial-review',
  'claude-rescue',
  'claude-status',
  'claude-result',
  'claude-cancel',
  'claude-setup',
];

describe('claude skill surface', () => {
  it('ships thin bundled skills that shell into the shared runtime', () => {
    for (const skill of skills) {
      const path = `claude/skills/${skill}/SKILL.md`;
      expect(existsSync(path)).toBe(true);
      const contents = readFileSync(path, 'utf8');
      expect(contents).toContain('node claude/scripts/claude-companion.mjs');
      expect(contents).toContain('Do not implement logic in this skill');
    }
  });

  it('documents the blocked automatic review gate honestly', () => {
    const readme = readFileSync('claude/README.md', 'utf8');
    expect(readme).toContain('automatic stop-time review gate is currently unavailable/blocked in the Codex plugin runtime');
  });
});
