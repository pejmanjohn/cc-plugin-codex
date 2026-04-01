# Claude Companion

Claude Companion is a Codex-native plugin bundle that routes review and delegated tasks to Claude Code.

This plugin is not fully functionally equivalent to `openai/codex-plugin-cc` today.

## Included skills

- `$claude-review`
- `$claude-adversarial-review`
- `$claude-rescue`
- `$claude-status`
- `$claude-result`
- `$claude-cancel`
- `$claude-setup`

## Install

From the repo root:

```bash
./scripts/install.sh
```

## Expected workflow

1. Install the plugin with `./scripts/install.sh`.
2. Run `$claude-setup` to verify Claude Code is present and usable.
3. Use `$claude-review` or `$claude-adversarial-review` for read-only code review.
4. Use `$claude-rescue` for foreground or background delegated tasks.
5. Use `$claude-status`, `$claude-result`, and `$claude-cancel` to manage long-running jobs.

## Current limitation

Review, adversarial review, rescue delegation, setup, status, result, and cancel are the currently ported and working workflows.

The automatic stop-time review gate is currently unavailable/blocked in the Codex plugin runtime. Codex now supports repo-level and user-level hooks, but validated installed-plugin runs through the official `plugin/install` path still did not execute bundled plugin `hooks.json` in `codex exec`, and earlier desktop validation showed the same missing hook side effects. Until installed plugin hooks actually run in those hosts, this plugin cannot enforce the stop-time gate and is not fully functionally equivalent today.
