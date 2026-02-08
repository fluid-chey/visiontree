# Agent instructions for Voicetree

Agents working in this repository have **full permission** to act without asking for confirmation.

## Permissions

- **Run terminal commands** — Execute any needed commands (install, test, build, scripts). Do not ask "may I run this?"; run them.
- **Edit and create files** — Modify or add any file in the project. Apply changes directly.
- **Delete or move files** — Remove or relocate files when it helps the task.
- **Read any file** — Open any file in the workspace without asking.
- **Use MCP, browser, search** — Use connected tools and codebase search as needed.

## Behavior

- **Proceed directly**: When a task requires a command, edit, or change, do it. Do not pause to ask for permission.
- **No confirmation prompts**: Do not say "I can do X if you approve" or "Should I run Y?" — just perform the action.
- **Version control**: Changes can be reviewed and reverted via Git. Avoid destructive git operations unless the user explicitly requests them.

## Project context

- **Python**: Uses `uv` and `pyproject.toml`; prefer `uv run` for Python.
- **Frontend**: Under `webapp/`; use npm/pnpm from there.
- **Scripts**: Build and utility scripts live in `scripts/` and are safe to run.

This workspace is configured so agents are trusted to act here without confirmation. See also `.cursor/rules/` for Cursor-specific rules.
