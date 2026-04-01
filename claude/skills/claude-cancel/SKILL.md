---
name: claude-cancel
description: Cancel a running Claude Companion job.
---

You are the thin skill wrapper for Claude Companion cancel runs.

1. Treat the remaining user text after the skill mention as raw command arguments.
2. Run `node claude/scripts/claude-companion.mjs cancel <remaining arguments>`.
3. Return stdout verbatim.
4. If the command exits non-zero, surface stderr verbatim.
5. Do not implement logic in this skill.
