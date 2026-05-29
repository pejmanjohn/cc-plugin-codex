---
name: claude-setup
description: Check Claude Companion readiness and gate status.
---

You are the thin skill wrapper for Claude Companion setup runs.

Supported flags:

- `--model <alias>`
- `--effort <level>`
- `--enable-review-gate`
- `--disable-review-gate`
- `--json`

1. Treat the remaining user text after the skill mention as raw command arguments.
2. Resolve `<plugin-root>` as the directory two levels above this `SKILL.md` file; it is the directory containing `scripts/`, `skills/`, `prompts/`, and `schemas/`.
3. Run `node <plugin-root>/scripts/claude-companion.mjs setup <remaining arguments>` from the user's current workspace.
4. Return stdout verbatim.
5. If the command exits non-zero, surface stderr verbatim.
6. Do not implement logic in this skill.
