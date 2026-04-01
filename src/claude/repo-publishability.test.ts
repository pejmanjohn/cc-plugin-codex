import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

describe('repository publishability', () => {
  it('ships the expected root OSS, legal, and CI surface', () => {
    const requiredFiles = [
      'README.md',
      'LICENSE',
      '.gitignore',
      'PRIVACY.md',
      'TERMS.md',
      'CONTRIBUTING.md',
      'SECURITY.md',
      'package-lock.json',
      '.agents/plugins/marketplace.json',
      '.github/workflows/pull-request-ci.yml',
      '.github/workflows/release.yml',
      'scripts/install.sh',
      'scripts/uninstall.sh',
      'scripts/lib/plugin-installer.mjs',
    ];

    for (const path of requiredFiles) {
      expect(existsSync(path), `${path} should exist`).toBe(true);
    }

    const rootReadme = readFileSync('README.md', 'utf8');
    expect(rootReadme).toContain('# CC Plugin Codex');
    expect(rootReadme).toContain('Claude Companion');
    expect(rootReadme).toContain('openai/codex-plugin-cc');
    expect(rootReadme).toContain('reverse port');
    expect(rootReadme).toContain('## What You Get');
    expect(rootReadme).toContain('## Requirements');
    expect(rootReadme).toContain('## Install');
    expect(rootReadme).toContain('## Usage');
    expect(rootReadme).toContain('Claude Code');
    expect(rootReadme).not.toContain('local Claude CLI');
    expect(rootReadme).not.toContain('delegate rescue work');
    expect(rootReadme).toContain('git clone https://github.com/pejmanjohn/cc-plugin-codex.git');
    expect(rootReadme).toContain('cd cc-plugin-codex');
    expect(rootReadme).toContain('./scripts/install.sh');
    expect(rootReadme).toContain('./scripts/uninstall.sh');
    expect(rootReadme).toContain('$claude-setup');
    expect(rootReadme).toContain('claude/README.md');

    const gitignore = readFileSync('.gitignore', 'utf8');
    expect(gitignore).toContain('node_modules/');

    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(packageJson.name).toBe('cc-plugin-codex');
    expect(packageJson.private).toBe(true);
    expect(packageJson.repository).toBe(
      'https://github.com/pejmanjohn/cc-plugin-codex',
    );

    const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
    expect(packageLock.packages['node_modules/@rolldown/binding-darwin-arm64']).toBeDefined();
    expect(packageLock.packages['node_modules/@rolldown/binding-linux-x64-gnu']).toBeDefined();

    const workflow = readFileSync('.github/workflows/pull-request-ci.yml', 'utf8');
    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain('npm ci');
    expect(workflow).toContain('npm install --global @openai/codex');
    expect(workflow).toContain('codex --version');
    expect(workflow).toContain('npm run test:claude');

    const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');
    expect(releaseWorkflow).toContain('tags:');
    expect(releaseWorkflow).toContain("'v*'");
    expect(releaseWorkflow).toContain('npm install --global @openai/codex');
    expect(releaseWorkflow).toContain('codex --version');
    expect(releaseWorkflow).toContain('gh release create');

    const marketplace = JSON.parse(
      readFileSync('.agents/plugins/marketplace.json', 'utf8'),
    );
    expect(marketplace.plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'claude-companion',
          source: expect.objectContaining({
            source: 'local',
            path: './claude',
          }),
        }),
      ]),
    );

    const pluginManifest = JSON.parse(
      readFileSync('claude/.codex-plugin/plugin.json', 'utf8'),
    );
    expect(pluginManifest.homepage).toBe(
      'https://github.com/pejmanjohn/cc-plugin-codex',
    );
    expect(pluginManifest.repository).toBe(
      'https://github.com/pejmanjohn/cc-plugin-codex',
    );
    expect(pluginManifest.version).toBe(packageJson.version);
    expect(pluginManifest.interface.websiteURL).toBe(
      'https://github.com/pejmanjohn/cc-plugin-codex',
    );
    expect(pluginManifest.interface.longDescription).toContain('Claude Code');
    expect(pluginManifest.interface.longDescription).not.toContain('local Claude CLI');
    expect(pluginManifest.interface.privacyPolicyURL).toBe(
      'https://github.com/pejmanjohn/cc-plugin-codex/blob/main/PRIVACY.md',
    );
    expect(pluginManifest.interface.termsOfServiceURL).toBe(
      'https://github.com/pejmanjohn/cc-plugin-codex/blob/main/TERMS.md',
    );
  });
});
