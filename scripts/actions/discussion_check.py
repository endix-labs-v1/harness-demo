#!/usr/bin/env python3
"""Discussion Action (OPS-F2-02, SYS §6.3, §8).

When a Discussion is created, files the Linear check issue under the umbrella its
first line names. With no key, files the no-umbrella check issue and posts one line
to the Slack webhook (#demo-lighthouse). A key outside project "Harness demo" files
nothing and fails the job with the W-11 text (SEC §5).
"""
from __future__ import annotations
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from linear import (LINEAR_CREDENTIAL, Linear, _default_send, _fence, _key_in, _main,  # noqa: E402
                    umbrella_of)

ENV = ("GITHUB_EVENT_PATH", LINEAR_CREDENTIAL, "SLACK_ACTIONS_WEBHOOK_URL", "LINEAR_TEAM_ID", "LINEAR_PROJECT_ID")


def post_webhook(url: str, text: str, send=None) -> None:
    send = send or _default_send
    status, _ = send(url, {"Content-Type": "application/json"}, json.dumps({"text": text}).encode())
    if not 200 <= status < 300:
        raise RuntimeError(f"Slack webhook error: HTTP {status}")


def first_line(body: str) -> str:
    for line in (body or "").splitlines():
        if line.strip():
            return line.strip()
    return ""


def run(event: dict, env: dict, linear: Linear, post=post_webhook) -> int:
    d = event.get("discussion") or {}
    url, title = d.get("html_url", ""), d.get("title", "")
    login = (d.get("user") or {}).get("login", "")
    project, team = env["LINEAR_PROJECT_ID"], env["LINEAR_TEAM_ID"]

    marker = f"Discussion: {url}"
    done = linear.find_in_project(project, marker)
    if done:
        print(f"Already filed: {done['identifier']} for {url}")
        return 0

    description = f"{marker}\nBy: Discussion Action"
    key = _key_in(first_line(d.get("body") or ""))
    if key:
        issue = linear.issue(key)
        umbrella = umbrella_of(issue)
        refused = _fence(issue, umbrella, project)
        if refused:
            print(refused, file=sys.stderr)
            return 1
        name = f"F2-02 · Check: {title}"
        made = linear.create_issue(team_id=team, project_id=project, state_id=linear.state_id(team, "Todo"),
                                   title=name, description=description, parent_id=umbrella["id"])
        print(f"Filed {made['identifier']} under {umbrella['identifier']}: {name}")
        return 0

    made = linear.create_issue(team_id=team, project_id=project, state_id=linear.state_id(team, "Todo"),
                               title=f"F2-02 · Check (no umbrella): {title}", description=description)
    post(env["SLACK_ACTIONS_WEBHOOK_URL"], f"Discussion with no umbrella key: {url} · opened by {login}")
    print(f"Filed {made['identifier']} with no umbrella; posted to #demo-lighthouse")
    return 0


def main(send=None) -> int:
    return _main(ENV, lambda event, env, linear: run(
        event, env, linear, post=lambda url, text: post_webhook(url, text, send=send)), send=send)


if __name__ == "__main__":
    sys.exit(main())
