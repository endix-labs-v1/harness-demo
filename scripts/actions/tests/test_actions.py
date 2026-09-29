"""The Discussion and merge Actions (T-GA-1 to T-GA-8, TEST §2.2). No network.

Run: python3 -m pytest -q scripts/actions/tests
"""
from __future__ import annotations
import json, pathlib, sys, urllib.parse

HERE = pathlib.Path(__file__).resolve()
ROOT = HERE.parents[3]
sys.path.insert(0, str(HERE.parents[1]))
import discussion_check, merge_docs  # noqa: E402
from linear import Linear  # noqa: E402

# Fixture values never match a SEC §3 pattern (T4 Spec 29).
TOKEN = "test-token-not-real"
CLIENT_ID = "test-id-not-real"
CLIENT_CS = "test-cs-not-real"
GRANT = "test-grant-not-real"
WEBHOOK = "https://webhook.invalid/actions"
TEAM, PROJECT, OTHER, STATE = "team-1", "proj-demo", "proj-other", "state-todo"
FIXTURE_VALUES = (TOKEN, CLIENT_ID, CLIENT_CS, GRANT, WEBHOOK)

GRAPHQL_URL = "https://api.linear.app/graphql"
TOKEN_URL = "https://api.linear.app/oauth/token"
REPO = "https://github.com/endix-labs-v1/harness-demo"
ENV = {"LINEAR_TEAM_ID": TEAM, "LINEAR_PROJECT_ID": PROJECT, "SLACK_ACTIONS_WEBHOOK_URL": WEBHOOK}
ENV_NAMES = ("GITHUB_EVENT_PATH", "LINEAR_ACTIONS_CLIENT_ID", "LINEAR_ACTIONS_CLIENT_SECRET",
             "LINEAR_ACTIONS_TOKEN", "SLACK_ACTIONS_WEBHOOK_URL", "LINEAR_TEAM_ID", "LINEAR_PROJECT_ID")

# The four documents of T4 Spec 9, exactly.
DOCUMENTS = {
    "issue": "query Issue($id: String!) { issue(id: $id) { id identifier title project { id } "
             "parent { id identifier project { id } } } }",
    "find": "query Find($project: ID!, $text: String!) { issues(first: 50, filter: {project: {id: {eq: $project}}, "
            "description: {contains: $text}}) { nodes { id identifier description } } }",
    "state": "query State($team: ID!, $name: String!) { workflowStates(first: 1, filter: {team: {id: {eq: $team}}, "
             "name: {eq: $name}}) { nodes { id } } }",
    "create": "mutation Create($input: IssueCreateInput!) { issueCreate(input: $input) "
              "{ success issue { id identifier url } } }",
}

UMBRELLA_12 = {"id": "id-12", "identifier": "END-12", "title": "Fee model", "project": PROJECT, "parent": None}
STEP_13 = {"id": "id-13", "identifier": "END-13", "title": "Fee helper", "project": PROJECT, "parent": "id-12"}
STEP_15 = {"id": "id-15", "identifier": "END-15", "title": "totalWithFee", "project": PROJECT, "parent": "id-12"}
OUTSIDE_9 = {"id": "id-9", "identifier": "END-9", "title": "Not the demo", "project": OTHER, "parent": None}
OUTSIDE_8 = {"id": "id-8", "identifier": "END-8", "title": "Not the demo", "project": OTHER, "parent": None}
STEP_14 = {"id": "id-14", "identifier": "END-14", "title": "Step under END-8", "project": PROJECT, "parent": "id-8"}
ISSUES = (UMBRELLA_12, STEP_13, STEP_15, OUTSIDE_9, OUTSIDE_8, STEP_14)


class FakeSend:
    """One fake `send` for Linear GraphQL, the token endpoint and the webhook; records every request."""

    def __init__(self, issues=ISSUES, graphql=None, grant=(200, {"access_token": GRANT})):
        self.issues = [dict(i) for i in issues]
        self.graphql = graphql  # (status, answer) to answer every GraphQL request with, or None
        self.grant = grant
        self.requests = []  # (url, headers, body)
        self.created = []  # each issueCreate input
        self.posts = []  # each webhook text

    def __call__(self, url, headers, body):
        self.requests.append((url, dict(headers), body))
        if url == TOKEN_URL:
            status, answer = self.grant
            return status, json.dumps(answer).encode()
        if url == WEBHOOK:
            assert headers["Content-Type"] == "application/json"
            self.posts.append(json.loads(body)["text"])
            return 200, b"ok"
        assert url == GRAPHQL_URL, url
        assert headers["Content-Type"] == "application/json"
        if self.graphql:
            status, answer = self.graphql
            return status, json.dumps(answer).encode()
        req = json.loads(body)
        return 200, json.dumps({"data": self.answer(req["query"], req["variables"])}).encode()

    def by(self, field, value):
        return next((i for i in self.issues if i[field] == value), None)

    def answer(self, query, v):
        if query == DOCUMENTS["issue"]:
            it = self.by("identifier", v["id"].upper())
            if it is None:
                return {"issue": None}
            parent = self.by("id", it["parent"]) if it["parent"] else None
            return {"issue": {
                "id": it["id"], "identifier": it["identifier"], "title": it["title"],
                "project": {"id": it["project"]} if it["project"] else None,
                "parent": parent and {"id": parent["id"], "identifier": parent["identifier"],
                                      "project": {"id": parent["project"]} if parent["project"] else None}}}
        if query == DOCUMENTS["find"]:
            # Linear's `contains` is a substring match; the client must compare whole lines.
            return {"issues": {"nodes": [
                {"id": i["id"], "identifier": i["identifier"], "description": i.get("description", "")}
                for i in self.issues if i["project"] == v["project"] and v["text"] in i.get("description", "")]}}
        if query == DOCUMENTS["state"]:
            return {"workflowStates": {"nodes": [{"id": STATE}] if (v["team"], v["name"]) == (TEAM, "Todo") else []}}
        if query == DOCUMENTS["create"]:
            data = v["input"]
            self.created.append(data)
            n = 100 + len(self.created) - 1
            self.issues.append({"id": f"id-{n}", "identifier": f"END-{n}", "title": data["title"],
                                "project": data["projectId"], "parent": data.get("parentId"),
                                "description": data["description"]})
            return {"issueCreate": {"success": True, "issue": {
                "id": f"id-{n}", "identifier": f"END-{n}", "url": f"https://linear.invalid/END-{n}"}}}
        raise AssertionError(f"unexpected document: {query}")

    def urls(self, url):
        return [r for r in self.requests if r[0] == url]


def discussion(n=7, title="Add totalWithFee", body="END-12\n\nWhy: the fee must be visible."):
    return {"action": "created", "discussion": {
        "number": n, "html_url": f"{REPO}/discussions/{n}", "title": title, "body": body,
        "user": {"login": "henrychoi"}}}


def pull_request(merged=True, labels=(), ref="henrychoi/end-15-x", n=3, title="Add totalWithFee"):
    return {"action": "closed", "pull_request": {
        "merged": merged, "labels": [{"name": name} for name in labels], "head": {"ref": ref},
        "html_url": f"{REPO}/pull/{n}", "title": title}}


def run_discussion(fake, event):
    posts = []
    rc = discussion_check.run(event, ENV, Linear(TOKEN, send=fake), post=lambda url, text: posts.append((url, text)))
    return rc, posts


def set_env(monkeypatch, tmp_path, event=None, **values):
    for name in ENV_NAMES:
        monkeypatch.delenv(name, raising=False)
    if event is not None:
        path = tmp_path / "event.json"
        path.write_text(json.dumps(event))
        values.setdefault("GITHUB_EVENT_PATH", str(path))
    for name, value in values.items():
        monkeypatch.setenv(name, value)


def assert_no_values(*texts):
    for text in texts:
        for value in FIXTURE_VALUES:
            assert value not in text


def test_t_ga_1_check_issue_under_umbrella(capsys):
    """T-GA-1 · A discussion whose first line has END-12, an umbrella: one check issue under END-12."""
    fake = FakeSend()
    event = discussion()
    rc, posts = run_discussion(fake, event)
    assert rc == 0
    assert fake.created == [{
        "teamId": TEAM, "projectId": PROJECT, "stateId": STATE, "parentId": "id-12",
        "title": "F2-02 · Check: Add totalWithFee",
        "description": f"Discussion: {REPO}/discussions/7\nBy: Discussion Action"}]
    assert posts == []
    assert capsys.readouterr().out == "Filed END-100 under END-12: F2-02 · Check: Add totalWithFee\n"
    for _, headers, _ in fake.urls(GRAPHQL_URL):
        assert headers["Authorization"] == f"Bearer {TOKEN}"


def test_t_ga_2_step_on_first_line_files_under_its_parent():
    """T-GA-2 · The first line names a step (END-13, parent END-12): the check issue goes under END-12."""
    fake = FakeSend()
    rc, _ = run_discussion(fake, discussion(body="END-13 · proposal\nMore text."))
    assert rc == 0
    assert len(fake.created) == 1
    assert fake.created[0]["parentId"] == "id-12"


def test_t_ga_3_no_key_files_without_parent_and_posts(capsys):
    """T-GA-3 · No key on the first line (a key on line 2 doesn't count): no parent, one webhook post."""
    fake = FakeSend()
    event = discussion(n=8, title="Rounding question", body="\n   \nShould fees round up?\nEND-12 is related.")
    rc, posts = run_discussion(fake, event)
    assert rc == 0
    assert fake.created == [{
        "teamId": TEAM, "projectId": PROJECT, "stateId": STATE,
        "title": "F2-02 · Check (no umbrella): Rounding question",
        "description": f"Discussion: {REPO}/discussions/8\nBy: Discussion Action"}]
    assert posts == [(WEBHOOK, f"Discussion with no umbrella key: {REPO}/discussions/8 · opened by henrychoi")]
    assert capsys.readouterr().out == "Filed END-100 with no umbrella; posted to #demo-lighthouse\n"


def test_t_ga_4_same_discussion_twice_files_once(capsys):
    """T-GA-4 · The same discussion event twice: one issue per discussion, idempotent by the URL."""
    fake = FakeSend()
    keyed = discussion()
    assert run_discussion(fake, keyed) == (0, [])
    capsys.readouterr()
    assert run_discussion(fake, keyed) == (0, [])
    assert capsys.readouterr().out == f"Already filed: END-100 for {REPO}/discussions/7\n"

    no_key = discussion(n=8, title="Rounding question", body="Should fees round up?")
    rc1, posts1 = run_discussion(fake, no_key)
    capsys.readouterr()
    rc2, posts2 = run_discussion(fake, no_key)
    assert (rc1, rc2) == (0, 0)
    assert capsys.readouterr().out.startswith("Already filed: END-101 for ")
    assert len(fake.created) == 2
    assert len(posts1) + len(posts2) == 1


def test_t_ga_5_docs_issue_under_the_steps_umbrella(capsys):
    """T-GA-5 · Merged PR from henrychoi/end-15-x, END-15's parent END-12: the docs issue goes under END-12."""
    fake = FakeSend()
    rc = merge_docs.run(pull_request(), ENV, Linear(TOKEN, send=fake))
    assert rc == 0
    assert fake.created == [{
        "teamId": TEAM, "projectId": PROJECT, "stateId": STATE, "parentId": "id-12",
        "title": "F2-11 · Docs: Add totalWithFee",
        "description": f'PR: {REPO}/pull/3\nBy: merge Action\n'
                       'Done when: the Code doc link, or "no doc change" and why'}]
    assert capsys.readouterr().out == "Filed END-100 under END-12: F2-11 · Docs: Add totalWithFee\n"


def test_t_ga_6_cleanup_label_files_nothing(capsys):
    """T-GA-6 · A merged PR labelled cleanup: no Linear request at all."""
    fake = FakeSend()
    assert merge_docs.run(pull_request(labels=("cleanup",)), ENV, Linear(TOKEN, send=fake)) == 0
    assert fake.requests == []
    assert capsys.readouterr().out == "Label cleanup: nothing filed.\n"


def test_t_ga_7_closed_not_merged_files_nothing(capsys):
    """T-GA-7 · Closed but not merged: no Linear request at all."""
    fake = FakeSend()
    assert merge_docs.run(pull_request(merged=False), ENV, Linear(TOKEN, send=fake)) == 0
    assert fake.requests == []
    assert capsys.readouterr().out == "Not merged: nothing filed.\n"


def test_t_ga_8_linear_error_fails_the_job(monkeypatch, tmp_path, capsys):
    """T-GA-8 · Linear returns an error: main exits 1 with the error printed, and no credential value."""
    errors = {"errors": [{"message": "Authentication required"}]}
    cases = ((merge_docs, pull_request()), (discussion_check, discussion()))
    for module, event in cases:
        set_env(monkeypatch, tmp_path, event, LINEAR_ACTIONS_CLIENT_ID=CLIENT_ID,
                LINEAR_ACTIONS_CLIENT_SECRET=CLIENT_CS, LINEAR_ACTIONS_TOKEN=TOKEN,
                SLACK_ACTIONS_WEBHOOK_URL=WEBHOOK, LINEAR_TEAM_ID=TEAM, LINEAR_PROJECT_ID=PROJECT)
        for answer, line in (((200, errors), "Linear error: Authentication required"),
                             ((401, errors), "Linear error: HTTP 401: Authentication required")):
            fake = FakeSend(graphql=answer)
            assert module.main(send=fake) == 1
            out, err = capsys.readouterr()
            assert line in err.splitlines()
            assert fake.created == [] and fake.posts == []
            assert_no_values(out, err)


def test_fence_outside_project(capsys):
    """No ID · A key outside project Harness demo files nothing, posts nothing and fails with the W-11 text."""
    fake = FakeSend()
    rc, posts = run_discussion(fake, discussion(body="END-9"))
    assert rc == 1
    assert fake.created == [] and posts == []
    assert capsys.readouterr().err == \
        "Refused by the harness (W-11, SEC §5): END-9 is outside the project Harness demo.\n"

    # A step inside the project whose umbrella is outside: refused with the umbrella's key.
    rc, posts = run_discussion(fake, discussion(n=9, body="END-14"))
    assert rc == 1 and fake.created == [] and posts == []
    assert "END-8 is outside the project Harness demo." in capsys.readouterr().err

    # The merge Action holds the same fence.
    assert merge_docs.run(pull_request(ref="henrychoi/end-9-x"), ENV, Linear(TOKEN, send=fake)) == 1
    assert fake.created == []
    assert capsys.readouterr().err == \
        "Refused by the harness (W-11, SEC §5): END-9 is outside the project Harness demo.\n"


def test_merge_no_key_on_branch(capsys):
    """No ID · A merged PR from a branch with no key: no Linear request, and the reason printed."""
    fake = FakeSend()
    assert merge_docs.run(pull_request(ref="quick-fix"), ENV, Linear(TOKEN, send=fake)) == 0
    assert fake.requests == []
    assert capsys.readouterr().out == "No umbrella key on branch 'quick-fix': nothing filed.\n"


def test_merge_same_pr_twice(capsys):
    """No ID · The T-GA-5 event twice: one issueCreate."""
    fake = FakeSend()
    linear = Linear(TOKEN, send=fake)
    assert merge_docs.run(pull_request(), ENV, linear) == 0
    capsys.readouterr()
    assert merge_docs.run(pull_request(), ENV, linear) == 0
    assert len(fake.created) == 1
    assert capsys.readouterr().out == f"Already filed: END-100 for {REPO}/pull/3\n"


def test_url_prefix_is_not_a_match():
    """No ID · Discussion 12 filed, then discussion 1: a URL that is a prefix never counts as filed."""
    fake = FakeSend()
    assert run_discussion(fake, discussion(n=12))[0] == 0
    assert run_discussion(fake, discussion(n=1))[0] == 0
    assert [c["description"].splitlines()[0] for c in fake.created] == [
        f"Discussion: {REPO}/discussions/12", f"Discussion: {REPO}/discussions/1"]

    assert merge_docs.run(pull_request(n=30), ENV, Linear(TOKEN, send=fake)) == 0
    assert merge_docs.run(pull_request(n=3), ENV, Linear(TOKEN, send=fake)) == 0
    assert len(fake.created) == 4


def test_missing_env_names_only(monkeypatch, tmp_path, capsys):
    """No ID · Missing env names the empty entries only, never a value; exit 1."""
    set_env(monkeypatch, tmp_path)
    assert discussion_check.main(send=FakeSend()) == 1
    assert capsys.readouterr().err == (
        "Missing env: GITHUB_EVENT_PATH, LINEAR_ACTIONS_CLIENT_ID and LINEAR_ACTIONS_CLIENT_SECRET "
        "(or LINEAR_ACTIONS_TOKEN), SLACK_ACTIONS_WEBHOOK_URL, LINEAR_TEAM_ID, LINEAR_PROJECT_ID\n")
    assert merge_docs.main(send=FakeSend()) == 1
    assert capsys.readouterr().err == (
        "Missing env: GITHUB_EVENT_PATH, LINEAR_ACTIONS_CLIENT_ID and LINEAR_ACTIONS_CLIENT_SECRET "
        "(or LINEAR_ACTIONS_TOKEN), LINEAR_TEAM_ID, LINEAR_PROJECT_ID\n")

    fake = FakeSend()
    set_env(monkeypatch, tmp_path, GITHUB_EVENT_PATH="event.json",
            LINEAR_ACTIONS_CLIENT_ID=CLIENT_ID, LINEAR_ACTIONS_CLIENT_SECRET=CLIENT_CS)
    assert discussion_check.main(send=fake) == 1
    out, err = capsys.readouterr()
    assert err == "Missing env: SLACK_ACTIONS_WEBHOOK_URL, LINEAR_TEAM_ID, LINEAR_PROJECT_ID\n"
    assert_no_values(out, err)

    set_env(monkeypatch, tmp_path, GITHUB_EVENT_PATH="event.json", LINEAR_ACTIONS_CLIENT_ID=CLIENT_ID)
    assert discussion_check.main(send=fake) == 1
    out, err = capsys.readouterr()
    assert "LINEAR_ACTIONS_CLIENT_SECRET (or LINEAR_ACTIONS_TOKEN)" in err
    assert "LINEAR_ACTIONS_CLIENT_ID and" not in err
    assert_no_values(out, err)
    assert fake.requests == []


def test_auth_client_credentials(monkeypatch, tmp_path, capsys):
    """No ID · With no fallback token, each run gets its own token with the grant, scope read,issues:create."""
    set_env(monkeypatch, tmp_path, discussion(), LINEAR_ACTIONS_CLIENT_ID=CLIENT_ID,
            LINEAR_ACTIONS_CLIENT_SECRET=CLIENT_CS, SLACK_ACTIONS_WEBHOOK_URL=WEBHOOK,
            LINEAR_TEAM_ID=TEAM, LINEAR_PROJECT_ID=PROJECT)
    fake = FakeSend()
    assert discussion_check.main(send=fake) == 0
    out, err = capsys.readouterr()
    grants = fake.urls(TOKEN_URL)
    assert len(grants) == 1
    _, headers, body = grants[0]
    assert headers["Content-Type"] == "application/x-www-form-urlencoded"
    assert urllib.parse.parse_qs(body.decode()) == {
        "grant_type": ["client_credentials"], "scope": ["read,issues:create"],
        "client_id": [CLIENT_ID], "client_secret": [CLIENT_CS]}
    graphql = fake.urls(GRAPHQL_URL)
    assert graphql and all(h["Authorization"] == f"Bearer {GRANT}" for _, h, _ in graphql)
    assert fake.requests[0][0] == TOKEN_URL
    assert "Linear auth: client credentials" in out.splitlines()
    assert len(fake.created) == 1
    assert_no_values(out, err)

    fake = FakeSend(grant=(401, {"error": "invalid_client"}))
    assert discussion_check.main(send=fake) == 1
    out, err = capsys.readouterr()
    assert err == "Linear error: client credentials grant failed: HTTP 401: invalid_client\n"
    assert fake.created == [] and fake.urls(GRAPHQL_URL) == []
    assert_no_values(out, err)


def test_auth_fallback_token(monkeypatch, tmp_path, capsys):
    """No ID · With LINEAR_ACTIONS_TOKEN set, no grant is asked for and GraphQL carries that token."""
    set_env(monkeypatch, tmp_path, pull_request(), LINEAR_ACTIONS_CLIENT_ID=CLIENT_ID,
            LINEAR_ACTIONS_CLIENT_SECRET=CLIENT_CS, LINEAR_ACTIONS_TOKEN=TOKEN,
            LINEAR_TEAM_ID=TEAM, LINEAR_PROJECT_ID=PROJECT)
    fake = FakeSend()
    assert merge_docs.main(send=fake) == 0
    out, err = capsys.readouterr()
    assert fake.urls(TOKEN_URL) == []
    graphql = fake.urls(GRAPHQL_URL)
    assert graphql and all(h["Authorization"] == f"Bearer {TOKEN}" for _, h, _ in graphql)
    assert "Linear auth: LINEAR_ACTIONS_TOKEN (fallback)" in out.splitlines()
    assert len(fake.created) == 1
    assert_no_values(out, err)


DISCUSSION_YML = """\
# Discussion Action (OPS-F2-02): files the Linear check issue under the umbrella on the discussion's first line.
name: discussion

on:
  discussion:
    types: [created]

permissions:
  contents: read

concurrency:
  group: discussion-${{ github.event.discussion.html_url }}
  cancel-in-progress: false

jobs:
  check-issue:
    name: "Discussion Action: check issue"
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - run: python3 scripts/actions/discussion_check.py
        env:
          LINEAR_ACTIONS_CLIENT_ID: ${{ secrets.LINEAR_ACTIONS_CLIENT_ID }}
          LINEAR_ACTIONS_CLIENT_SECRET: ${{ secrets.LINEAR_ACTIONS_CLIENT_SECRET }}
          LINEAR_ACTIONS_TOKEN: ${{ secrets.LINEAR_ACTIONS_TOKEN }}
          SLACK_ACTIONS_WEBHOOK_URL: ${{ secrets.SLACK_ACTIONS_WEBHOOK_URL }}
          LINEAR_TEAM_ID: ${{ vars.LINEAR_TEAM_ID }}
          LINEAR_PROJECT_ID: ${{ vars.LINEAR_PROJECT_ID }}
"""

MERGE_DOCS_YML = """\
# merge Action (OPS-F2-11): files the Linear docs issue under the umbrella of the merged branch's step.
name: merge-docs

on:
  pull_request:
    types: [closed]

permissions:
  contents: read

concurrency:
  group: merge-docs-${{ github.event.pull_request.html_url }}
  cancel-in-progress: false

jobs:
  docs-issue:
    name: "merge Action: docs issue"
    if: github.event.pull_request.merged == true && !contains(github.event.pull_request.labels.*.name, 'cleanup')
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - run: python3 scripts/actions/merge_docs.py
        env:
          LINEAR_ACTIONS_CLIENT_ID: ${{ secrets.LINEAR_ACTIONS_CLIENT_ID }}
          LINEAR_ACTIONS_CLIENT_SECRET: ${{ secrets.LINEAR_ACTIONS_CLIENT_SECRET }}
          LINEAR_ACTIONS_TOKEN: ${{ secrets.LINEAR_ACTIONS_TOKEN }}
          LINEAR_TEAM_ID: ${{ vars.LINEAR_TEAM_ID }}
          LINEAR_PROJECT_ID: ${{ vars.LINEAR_PROJECT_ID }}
"""


def test_workflows_text():
    """No ID · Each line of the two workflow blocks (T4 Spec 26, 27) is in its file."""
    for name, block in (("discussion.yml", DISCUSSION_YML), ("merge-docs.yml", MERGE_DOCS_YML)):
        lines = (ROOT / ".github" / "workflows" / name).read_text().splitlines()
        for line in block.splitlines():
            assert line in lines, f"{name}: {line!r}"
