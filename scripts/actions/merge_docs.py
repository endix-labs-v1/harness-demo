#!/usr/bin/env python3
"""merge Action (OPS-F2-11, SYS §6.3, §8).

When a PR is merged, files the Linear docs issue under the umbrella of the branch's
step: the key comes from the head branch (end-<number>); the umbrella is that issue's
parent, or the issue when it has none. Unmerged and `cleanup` PRs, and branches with
no key, file nothing. A key outside project "Harness demo" files nothing and fails
the job with the W-11 text (SEC §5).
"""
from __future__ import annotations
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from linear import LINEAR_CREDENTIAL, Linear, _fence, _key_in, _main, umbrella_of  # noqa: E402

ENV = ("GITHUB_EVENT_PATH", LINEAR_CREDENTIAL, "LINEAR_TEAM_ID", "LINEAR_PROJECT_ID")


def run(event: dict, env: dict, linear: Linear) -> int:
    pr = event.get("pull_request") or {}
    if pr.get("merged") is not True:
        print("Not merged: nothing filed.")
        return 0
    if any((label or {}).get("name") == "cleanup" for label in pr.get("labels") or []):
        print("Label cleanup: nothing filed.")
        return 0
    ref = (pr.get("head") or {}).get("ref", "")
    key = _key_in(ref)
    if not key:
        print(f"No umbrella key on branch '{ref}': nothing filed.")
        return 0

    url, title = pr.get("html_url", ""), pr.get("title", "")
    project, team = env["LINEAR_PROJECT_ID"], env["LINEAR_TEAM_ID"]
    marker = f"PR: {url}"
    done = linear.find_in_project(project, marker)
    if done:
        print(f"Already filed: {done['identifier']} for {url}")
        return 0

    issue = linear.issue(key)
    umbrella = umbrella_of(issue)
    refused = _fence(issue, umbrella, project)
    if refused:
        print(refused, file=sys.stderr)
        return 1
    name = f"F2-11 · Docs: {title}"
    description = f'{marker}\nBy: merge Action\nDone when: the Code doc link, or "no doc change" and why'
    made = linear.create_issue(team_id=team, project_id=project, state_id=linear.state_id(team, "Todo"),
                               title=name, description=description, parent_id=umbrella["id"])
    print(f"Filed {made['identifier']} under {umbrella['identifier']}: {name}")
    return 0


def main(send=None) -> int:
    return _main(ENV, run, send=send)


if __name__ == "__main__":
    sys.exit(main())
