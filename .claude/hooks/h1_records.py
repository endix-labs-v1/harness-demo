#!/usr/bin/env python3
"""H1 · Entry agents never write in Notion or Linear, and post in Slack only
through endix-entry-slack (OPS-F0-38, OPS-A4-11; WALL W-22).

Claude Code runs this before every MCP tool call. A write to Notion or Linear is
refused (exit 2); reads pass. The managers (doc manager, task manager) run with
their own accounts outside this repo, so this hook never stops them.

Slack (W-22): a tool is read as mcp__<server>__<tool>, and a Slack tool is one
whose server name contains "slack". The server endix-entry-slack is always let
through: its tools post as the Entry agent and run W-12 themselves. Any other
Slack tool passes only when it is a read (read, search, list, get) with no write
word in it; everything else, an unknown Slack tool included, is refused.

While F0's interim exception lasts, the entry agent makes the managers' writes:
set ENDIX_INTERIM=1 to let them through. Leave it unset to show the wall.
ENDIX_INTERIM never opens Slack writes: nobody posts as Henry.
"""
from __future__ import annotations
import json, os, re, sys

WRITE_WORDS = re.compile(
    r"(create|update|save|delete|move|duplicate|retire|restore|archive|comment|"
    r"insert|append|replace|write|upload|attach|set_|patch)", re.I)

ENTRY_SLACK = "endix-entry-slack"
SLACK_READ = re.compile(r"(read|search|list|get)", re.I)
SLACK_WRITE_WORDS = re.compile(
    r"(send|post|schedule|add_|draft|complete|upload|invite|kick|rename|join|leave)", re.I)
SLACK_REFUSAL = ("Refused by the harness (H1, OPS-F0-38): entry agents post in Slack only "
                 "through endix-entry-slack, as the Entry agent. Use post_in_thread or hand_off.")


def decide_slack(server: str, tool: str) -> str | None:
    """For a Slack tool: None to allow, else the Slack refusal."""
    if server == ENTRY_SLACK:
        return None
    if SLACK_READ.search(tool) and not WRITE_WORDS.search(tool) and not SLACK_WRITE_WORDS.search(tool):
        return None
    return SLACK_REFUSAL


def decide(tool_name: str) -> str | None:
    """Return a refusal message, or None to allow."""
    name = tool_name.lower()
    if not name.startswith("mcp__"):
        return None
    parts = tool_name.split("__")
    server, tool = parts[1], parts[-1]
    if "slack" in server.lower():
        return decide_slack(server, tool)
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
