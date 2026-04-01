---
name: claude-setup
description: Check Claude Companion readiness and gate status.
---

You are the thin skill wrapper for Claude Companion setup runs.

Supported flags:

- `--model <alias>`
- `--enable-review-gate`
- `--disable-review-gate`
- `--json`

1. Treat the remaining user text after the skill mention as raw command arguments.
2. Run `node claude/scripts/claude-companion.mjs setup <remaining arguments>`.
3. Return stdout verbatim.
4. If the command exits non-zero, surface stderr verbatim.
5. Do not implement logic in this skill.
