# CC Plugin Codex

Use Claude from inside Codex for code reviews or to delegate tasks to Claude Code.

This repository is the source for the Codex-native Claude Companion plugin bundle. It is meant to be a reverse port of [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc): the original brings Codex into Claude Code, while this project brings Claude-backed review and delegation workflows into Codex.

The installable plugin bundle lives under [`claude/README.md`](./claude/README.md).

## What You Get

- `$claude-review` for a normal read-only Claude review from Codex
- `$claude-adversarial-review` for a steerable challenge review
- `$claude-rescue`, `$claude-status`, `$claude-result`, and `$claude-cancel` to delegate and manage longer-running Claude tasks
- `$claude-setup` to verify Claude Code readiness and report the current review-gate limitation honestly

## Requirements

- Codex with plugin support
- Claude Code installed and available as `claude`
- Node.js 18.18 or later for development and tests

## Install

```bash
mkdir -p ~/.codex/plugins
git clone https://github.com/pejmanjohn/cc-plugin-codex.git ~/.codex/plugins/cc-plugin-codex
cd ~/.codex/plugins/cc-plugin-codex
./scripts/install.sh
```

This keeps the source checkout under Codex's documented personal plugin directory convention while still using Codex's official `plugin/install` backend for the actual install.

## Verify

Open Codex:

```bash
codex
```

If you normally use the Codex Mac app and it is already open, restart it instead.

Then start a new thread and run:

```text
$claude-setup
```

After install, you should see the bundled Claude Companion skills in Codex. The full bundle-level usage guide lives in [`claude/README.md`](./claude/README.md).

## Update

```bash
cd ~/.codex/plugins/cc-plugin-codex
git pull
./scripts/install.sh
```

## Uninstall

```bash
cd ~/.codex/plugins/cc-plugin-codex
./scripts/uninstall.sh
```

## Usage

### `$claude-review`

Runs a normal read-only Claude review on your current work or against a base ref.

### `$claude-adversarial-review`

Runs a more skeptical review that questions implementation choices, tradeoffs, and failure modes.

### `$claude-rescue`

Delegates a foreground or background task to Claude and stores durable job state for follow-up.

### `$claude-status`, `$claude-result`, `$claude-cancel`

Shows running and recent jobs, returns the stored final output, or cancels an active background task.

### `$claude-setup`

Checks whether Claude Code is installed and usable, and reports the current stop-time review-gate limitation.

## Current Limitation

The plugin is usable today, but it is not fully functionally equivalent to `openai/codex-plugin-cc`.

The missing piece is the automatic stop-time review gate. Codex supports repo-level and user-level hooks, but validated installed-plugin runs still did not execute bundled plugin hooks after official install, so this plugin reports that limitation honestly instead of pretending the gate works.

## Releases

This repo uses simple tag-based releases.

- Keep [`package.json`](./package.json) and [`claude/.codex-plugin/plugin.json`](./claude/.codex-plugin/plugin.json) on the same semantic version.
- Create a tag like `v0.1.0`.
- Push the tag to GitHub.

The release workflow will verify the tag matches both version files, run the Claude plugin test suite, and publish a GitHub release with generated notes.

## Development

```bash
npm ci
npm run test:claude
```

Helpful files:

- [`claude/README.md`](./claude/README.md)
- [`claude/.codex-plugin/plugin.json`](./claude/.codex-plugin/plugin.json)
