#!/usr/bin/env python3
"""H2 and H3 · Git and GitHub walls for entry agents.

H2 (OPS-F0-36, OPS-A4-11): a push from a branch whose name carries no umbrella
key (END-123) is refused, so nothing reaches GitHub outside a tree. A push to
main is refused the same way.

H3 (OPS-F2-33): people decide. An agent never merges a PR, never approves one,
and never posts "go" or "no" on a discussion.

Claude Code runs this before every Bash call; exit 2 refuses it.
"""
from __future__ import annotations
import json, re, shlex, subprocess, sys

KEY = re.compile(r"(?i)\bend-\d+")


def current_branch(cwd: str | None) -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=cwd,
                              capture_output=True, text=True, timeout=5).stdout.strip()
    except Exception:
        return ""


def pushed_branch(args: list[str], cwd: str | None) -> str:
    """The branch a `git push` sends: the last refspec's source, or the current branch."""
    rest = [a for a in args if not a.startswith("-")]
    # git push [remote] [refspec...]
    if len(rest) >= 2:
        ref = rest[-1].lstrip("+")
        src = ref.split(":")[-1] if ":" in ref else ref
        if src and src != "HEAD":
            return src.replace("refs/heads/", "")
    return current_branch(cwd)


def split_commands(command: str) -> list[list[str]]:
    parts = re.split(r"&&|\|\||;|\n|\|", command)
    out = []
    for p in parts:
        try:
            toks = shlex.split(p)
        except ValueError:
            toks = p.split()
        if toks:
            out.append(toks)
    return out


def decide(command: str, cwd: str | None = None) -> str | None:
    for toks in split_commands(command):
        # skip env assignments like FOO=1 git push
        while toks and re.match(r"^\w+=", toks[0]):
            toks = toks[1:]
        if len(toks) >= 2 and toks[0] == "git" and "push" in toks[1:3]:
            i = toks.index("push")
            branch = pushed_branch(toks[i + 1:], cwd)
            if branch in ("main", "master"):
                return ("Refused by the harness (H2, OPS-F2-25): nothing is pushed to main. "
                        "Work on a branch named from its Linear step and open a PR.")
            if not KEY.search(branch or ""):
                return (f"Refused by the harness (H2, OPS-F0-36): branch '{branch}' carries no "
                        "umbrella key. Name it from its Linear step, like "
                        "henrychoi/end-123-short-title. No key: post the ask in #lighthouse.")
        if toks[:3] == ["gh", "pr", "merge"]:
            return ("Refused by the harness (H3, OPS-F2-33): agents never merge. "
                    "Henry or 서준 merge after green CI and their approval.")
        if toks[:3] == ["gh", "pr", "review"] and any(t in ("--approve", "-a") for t in toks):
            return ("Refused by the harness (H3, OPS-F2-33): agents never approve a PR. "
                    "Ask for a review in the umbrella's thread.")
        if toks[:2] == ["gh", "api"] and "addDiscussionComment" in " ".join(toks):
            body = " ".join(toks)
            if re.search(r"body[\"']?\s*[:=]\s*[\"']?\s*(go|no)\b", body, re.I):
                return ("Refused by the harness (H3, OPS-F2-33): only Henry or 서준 post "
                        "\"go\" or \"no\" on a discussion.")
    return None


def main() -> None:
    data = json.load(sys.stdin)
    command = (data.get("tool_input") or {}).get("command", "")
    msg = decide(command, data.get("cwd"))
    if msg:
        print(msg, file=sys.stderr)
        sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
