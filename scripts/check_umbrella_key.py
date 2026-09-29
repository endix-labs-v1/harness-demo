#!/usr/bin/env python3
"""CI wall · umbrella key (OPS-F0-36, OPS-A4-39).

A PR passes only if its branch name, title or description names a Linear
umbrella key (END-123). Reads the PR from the GitHub event file.
"""
from __future__ import annotations
import json, os, re, sys

KEY = re.compile(r"(?i)\bend-\d+")


def check(branch: str, title: str, body: str) -> str | None:
    if KEY.search(branch or "") or KEY.search(title or "") or KEY.search(body or ""):
        return None
    return (f"No umbrella key on this PR (branch '{branch}'). Name the branch from its Linear "
            "step, like henrychoi/end-123-short-title (OPS-F0-36). No umbrella yet: the ask "
            "goes to #lighthouse first (OPS-F0-01).")


def main() -> int:
    with open(os.environ["GITHUB_EVENT_PATH"]) as f:
        pr = json.load(f).get("pull_request", {})
    msg = check(pr.get("head", {}).get("ref", ""), pr.get("title", ""), pr.get("body") or "")
    if msg:
        print(f"::error title=Wall: umbrella key::{msg}")
        return 1
    print("Umbrella key found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
