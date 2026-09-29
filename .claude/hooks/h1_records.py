#!/usr/bin/env python3
"""H1 · Entry agents never write in Notion or Linear (OPS-F0-38, OPS-A4-11).

Claude Code runs this before every MCP tool call. A write to Notion or Linear is
refused (exit 2); reads pass. The managers (doc manager, task manager) run with
their own accounts outside this repo, so this hook never stops them.

While F0's interim exception lasts, the entry agent makes the managers' writes:
set ENDIX_INTERIM=1 to let them through. Leave it unset to show the wall.
"""
from __future__ import annotations
import json, os, re, sys

WRITE_WORDS = re.compile(
    r"(create|update|save|delete|move|duplicate|retire|restore|archive|comment|"
    r"insert|append|replace|write|upload|attach|set_|patch)", re.I)


def decide(tool_name: str) -> str | None:
    """Return a refusal message, or None to allow."""
    name = tool_name.lower()
    if not name.startswith("mcp__"):
        return None
    target = "notion" if "notion" in name else "linear" if "linear" in name else None
    if not target:
        return None
    if not WRITE_WORDS.search(name.split("__")[-1]):
        return None  # a read: fetch, search, get, list
    if os.environ.get("ENDIX_INTERIM") == "1":
        return None
    who = "the doc manager" if target == "notion" else "the task manager"
    return (f"Refused by the harness (H1, OPS-F0-38): entry agents never write in "
            f"{target.capitalize()}. Hand this write to {who} with the hand-off skill: "
            f"post it in the umbrella's thread with the step ID, what to write and where.")


def main() -> None:
    data = json.load(sys.stdin)
    msg = decide(data.get("tool_name", ""))
    if msg:
        print(msg, file=sys.stderr)
        sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
