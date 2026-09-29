#!/usr/bin/env python3
"""CI wall W-33 · a skill change carries its passing eval (OPS-A4-48, OPS-A4-07).

A PR that touches .claude/skills/<name>/ fails unless it commits a run file
evals/<name>/runs/<run>.json (written by scripts/run_eval.py) whose pass is true and
whose skill_sha is the skill folder's tree in the PR, and its description has the line
"Eval: evals/<name>/runs/<run>.json". A skill whose folder the PR deletes needs no eval.
Usage: check_eval_result.py <base-sha> <head-sha>  (the PR description from GITHUB_EVENT_PATH)
"""
from __future__ import annotations
import json, os, re, subprocess, sys
from typing import Callable

SKILL = re.compile(r"^\.claude/skills/([^/]+)/")
EVAL = re.compile(r"Eval:\s*(evals/([^/\s]+)/runs/[^\s)]+\.json)")
TEXT = ("Skill change with no passing eval for {name}. Run scripts/run_eval.py {name}, commit "
        'evals/{name}/runs/<run>.json, and add "Eval: <that path>" to the PR description (OPS-A4-48).')


def run_file_problem(name: str, path: str, tree: str, read_at_head: Callable[[str], str | None]) -> str | None:
    """Why the run file at path doesn't carry the skill's eval, or None when it does."""
    text = read_at_head(path)
    if text is None:
        return f"{path} is not committed on this branch"
    try:
        run = json.loads(text)
    except ValueError:
        run = None
    if not isinstance(run, dict) or not all(k in run for k in ("skill", "skill_sha", "pass")):
        return f"{path} is not a run file (not JSON, or no skill, skill_sha or pass)"
    if run["skill"] != name:
        return f"{path} is a run of the skill {run['skill']}"
    if run["pass"] is not True:
        return f"{path} has pass false"
    if run["skill_sha"] != tree:
        return (f"{path} was run on skill_sha {str(run['skill_sha'])[:7]}; "
                f".claude/skills/{name}/ in this PR is {tree[:7]}")
    return None


def check(changed: list[str], body: str,
          read_at_head: Callable[[str], str | None],
          tree_at_head: Callable[[str], str | None]) -> list[tuple[str, str]]:
    """One (W-33 text, reason) per changed skill with no passing eval."""
    skills: list[str] = []
    for path in changed:
        m = SKILL.match(path)
        if m and m.group(1) not in skills:
            skills.append(m.group(1))
    lines = EVAL.findall(body or "")
    problems = []
    for name in skills:
        tree = tree_at_head(f".claude/skills/{name}")
        if tree is None:
            continue
        paths = [path for path, skill in lines if skill == name]  # the template's evals/<skill>/… never matches
        if not paths:
            problems.append((TEXT.format(name=name),
                             f'no "Eval: evals/{name}/runs/<run>.json" line in the PR description'))
            continue
        reasons = [run_file_problem(name, path, tree, read_at_head) for path in paths]
        if all(reasons):
            problems.append((TEXT.format(name=name), reasons[0]))
    return problems


def main(argv: list[str]) -> int:
    base, head = argv[0], argv[1]
    changed = subprocess.run(["git", "-c", "core.quotePath=false", "diff", "--name-only", f"{base}...{head}"],
                             capture_output=True, text=True, check=True).stdout.splitlines()
    body = ""
    if os.environ.get("GITHUB_EVENT_PATH"):
        with open(os.environ["GITHUB_EVENT_PATH"]) as f:
            body = json.load(f).get("pull_request", {}).get("body") or ""

    def read_at_head(path: str) -> str | None:
        p = subprocess.run(["git", "show", f"{head}:{path}"], capture_output=True, text=True)
        return p.stdout if p.returncode == 0 else None

    def tree_at_head(path: str) -> str | None:
        p = subprocess.run(["git", "rev-parse", "--verify", "--quiet", f"{head}:{path}"], capture_output=True, text=True)
        return p.stdout.strip() if p.returncode == 0 else None

    problems = check(changed, body, read_at_head, tree_at_head)
    for text, reason in problems:
        print(text)
        print(f"::error title=Wall: eval result::{text}")
        print(f"Reason: {reason}")
    if not problems:
        print("No skill change, or each changed skill has its passing eval.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
