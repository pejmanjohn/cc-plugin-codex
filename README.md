# CC Plugin Codex

<img width="2626" height="2212" alt="CleanShot 2026-04-01 at 12 20 56@2x" src="https://github.com/user-attachments/assets/f8b6eb0d-e54e-439f-9e30-6444daffdc69" />


Use Claude from inside Codex for code reviews or to delegate tasks to Claude Code.

This repository is the source for the Codex-native Claude Companion plugin bundle. It is meant to be a reverse port of [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc): the original brings Codex into Claude Code, while this project brings Claude-backed review and delegation workflows into Codex.

The installable plugin bundle lives under [`claude/README.md`](./claude/README.md).

## What You Get

- `$claude-review` for a normal read-only Claude review from Codex
- `$claude-adversarial-review` for a steerable challenge review
- `$claude-delegate`, `$claude-status`, `$claude-result`, and `$claude-cancel` to delegate and manage longer-running Claude tasks
- `$claude-rescue` as a backwards-compatible alias for `$claude-delegate`
- `$claude-setup` to verify Claude Code readiness and report the current review-gate limitation honestly

## Requirements

- Codex with plugin support
- Claude Code installed and available as `claude`
- Node.js 18.18 or later for install, development, and tests

## Install

```bash
mkdir -p ~/.codex/plugins
git clone https://github.com/pejmanjohn/cc-plugin-codex.git ~/.codex/plugins/cc-plugin-codex
cd ~/.codex/plugins/cc-plugin-codex
./scripts/install.sh
```

The installer follows Codex's personal marketplace convention used by `plugin-creator`:

- creates or updates `~/.agents/plugins/marketplace.json`
- exposes this repo's installable `claude/` bundle at `~/plugins/claude-companion`
- runs `codex plugin add claude-companion@<personal-marketplace-name>`

No machine-specific paths are committed to the repo. The `~/plugins/claude-companion` path is a local symlink to the checkout's `claude/` bundle, so updates still come from `git pull`.

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

Start a new Codex thread after reinstalling so the updated skills are loaded.

## Uninstall

```bash
cd ~/.codex/plugins/cc-plugin-codex
./scripts/uninstall.sh
```

Uninstall removes the installed plugin from Codex but leaves the personal marketplace entry in place so reinstalling stays one command.

## Usage

### `$claude-review`

Runs a normal read-only Claude review on your current work or against a base ref.

### `$claude-adversarial-review`

Runs a more skeptical review that questions implementation choices, tradeoffs, and failure modes.

### `$claude-delegate`

Delegates a foreground or background task to Claude and stores durable job state for follow-up.

By default, delegation uses Claude Code model `opus` with effort `high`.

```text
$claude-delegate investigate the flaky checkout test
```

Override the model or effort level per task:

```text
$claude-delegate --model sonnet --effort medium investigate the flaky checkout test
$claude-delegate --background --model opus --effort xhigh implement the retry fix
```

Persist new defaults with setup:

```text
$claude-setup --model opus --effort high
```

Claude Code currently accepts effort levels such as `low`, `medium`, `high`, `xhigh`, and `max`. Model values can be aliases such as `sonnet` or `opus`, or full Claude model names supported by your Claude Code installation.

`$claude-rescue` remains available as a backwards-compatible alias.

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
