import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('claude plugin bundle scaffold', () => {
  it('keeps the publishable bundle rooted under claude/', () => {
    expect(existsSync('claude/.codex-plugin/plugin.json')).toBe(true);
    expect(existsSync('claude/assets/claude-small.svg')).toBe(true);
    expect(existsSync('claude/assets/claude-logo.svg')).toBe(true);
    expect(existsSync('claude/skills')).toBe(true);
    expect(existsSync('claude/scripts/lib')).toBe(true);
    expect(existsSync('claude/prompts')).toBe(true);
    expect(existsSync('claude/schemas')).toBe(true);

    const manifest = JSON.parse(
      readFileSync('claude/.codex-plugin/plugin.json', 'utf8'),
    );

    expect(manifest.name).toBe('claude-companion');
    expect(manifest.skills).toBe('./skills/');
    expect(manifest.interface.displayName).toBe('Claude Companion');
    expect(existsSync(resolve('claude', manifest.skills))).toBe(true);
    expect(existsSync(resolve('claude', manifest.interface.composerIcon))).toBe(
      true,
    );
    expect(existsSync(resolve('claude', manifest.interface.logo))).toBe(true);
  });
});
