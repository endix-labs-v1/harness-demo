#!/usr/bin/env python3
"""CI wall · harness changes cite their rule (OPS-F2-28, OPS-A4-40).

A PR that touches a harness path (AGENTS.md, CLAUDE.md, .claude/, .github/,
scripts/) fails unless its description cites the rule ID it puts in force,
like OPS-F0-36. A PR that touches a skill must also link its eval ("Eval: <link>").
Usage: check_rule_id.py <base-sha> <head-sha>
"""
from __future__ import annotations
import json, os, re, subprocess, sys

HARNESS = ("AGENTS.md", "CLAUDE.md", ".claude/", ".github/", "scripts/")
RULE = re.compile(r"\b(OPS|CODE|PROD|BD|GTM|RES|CO)-[A-Z0-9]+-\d+\b")
EVAL = re.compile(r"(?im)^\s*eval:\s*\S+")


def check(changed: list[str], body: str) -> list[str]:
    harness = [f for f in changed if f.startswith(HARNESS)]
    if not harness:
        return []
    problems = []
    if not RULE.search(body or ""):
        problems.append(f"Harness change with no rule ID ({', '.join(harness[:5])}). Cite the rule "
                        "this change puts in force, like OPS-F0-36; with no rule, F9 runs first (OPS-F2-28).")
    if any(f.startswith(".claude/skills/") for f in harness) and not EVAL.search(body or ""):
        problems.append("Skill change with no eval. Add a line 'Eval: <link to the run>' (OPS-A4-48).")
    return problems


def main(argv: list[str]) -> int:
    base, head = argv[0], argv[1]
    changed = subprocess.run(["git", "diff", "--name-only", f"{base}...{head}"],
                             capture_output=True, text=True, check=True).stdout.split()
    with open(os.environ["GITHUB_EVENT_PATH"]) as f:
        body = json.load(f).get("pull_request", {}).get("body") or ""
    problems = check(changed, body)
    for p in problems:
        print(f"::error title=Wall: rule ID::{p}")
    if not problems:
        print("No harness change, or the rule ID is cited.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
