"""Linear GraphQL client for the Discussion and merge Actions (C7, SYS §6.3, §8).

Standard library only. Each run gets its own token with the client credentials
grant (SEC §3, C-25), or uses LINEAR_ACTIONS_TOKEN when Henry set it (the fallback).
No message here ever holds a credential value (SEC §3, WR BR-12).
"""
from __future__ import annotations
import json, os, re, sys, urllib.error, urllib.parse, urllib.request

KEY = re.compile(r"(?i)\bend-(\d+)\b")

GRAPHQL_URL = "https://api.linear.app/graphql"
TOKEN_URL = "https://api.linear.app/oauth/token"
SCOPE = "read,issues:create"  # the Endix Actions app's scopes, every grant (SEC §2, §3)

# The names whose values are never printed (SEC §3).
CREDENTIAL_NAMES = ("LINEAR_ACTIONS_CLIENT_ID", "LINEAR_ACTIONS_CLIENT_SECRET",
                    "LINEAR_ACTIONS_TOKEN", "SLACK_ACTIONS_WEBHOOK_URL")
LINEAR_CREDENTIAL = "<linear credential>"  # stands for the credential entry in a script's env list

Q_ISSUE = ("query Issue($id: String!) { issue(id: $id) { id identifier title project { id } "
           "parent { id identifier project { id } } } }")
Q_FIND = ("query Find($project: ID!, $text: String!) { issues(first: 50, filter: "
          "{project: {id: {eq: $project}}, description: {contains: $text}}) "
          "{ nodes { id identifier description } } }")
Q_STATE = ("query State($team: ID!, $name: String!) { workflowStates(first: 1, filter: "
           "{team: {id: {eq: $team}}, name: {eq: $name}}) { nodes { id } } }")
M_CREATE = ("mutation Create($input: IssueCreateInput!) { issueCreate(input: $input) "
            "{ success issue { id identifier url } } }")


class LinearError(Exception):
    pass


def _default_send(url: str, headers: dict, body: bytes) -> tuple[int, bytes]:
    """One HTTP POST. Returns the status and body for non-2xx answers too."""
    headers = dict(headers)
    headers.setdefault("User-Agent", "harness-demo-actions")
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except urllib.error.URLError as e:
        raise RuntimeError(f"Network error: {e.reason}") from None


def _json(body: bytes):
    try:
        return json.loads(body.decode("utf-8", "replace"))
    except ValueError:
        return None


def client_credentials_token(client_id: str, client_secret: str, *, scope: str = SCOPE,
                             url: str = TOKEN_URL, send=None) -> str:
    """A fresh token for this run (SEC §3, C-25). Callers never pass another scope."""
    send = send or _default_send
    form = urllib.parse.urlencode([("grant_type", "client_credentials"), ("scope", scope),
                                   ("client_id", client_id), ("client_secret", client_secret)])
    status, body = send(url, {"Content-Type": "application/x-www-form-urlencoded"}, form.encode())
    answer = _json(body)
    token = answer.get("access_token") if isinstance(answer, dict) else None
    if status != 200 or not token:
        msg = f"Linear error: client credentials grant failed: HTTP {status}"
        if isinstance(answer, dict) and answer.get("error"):
            msg += f": {answer['error']}"
        raise LinearError(msg)
    return token


class Linear:
    def __init__(self, token: str, *, url: str = GRAPHQL_URL, send=None) -> None:
        self._token = token
        self._url = url
        self._send = send or _default_send

    def gql(self, query: str, variables: dict | None = None) -> dict:
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {self._token}"}
        body = json.dumps({"query": query, "variables": variables or {}}).encode()
        status, raw = self._send(self._url, headers, body)
        answer = _json(raw)
        if status != 200:
            errors = answer.get("errors") if isinstance(answer, dict) else None
            if errors and isinstance(errors, list) and isinstance(errors[0], dict) and errors[0].get("message"):
                detail = errors[0]["message"]
            else:
                detail = raw.decode("utf-8", "replace")[:200]
            raise LinearError(f"Linear error: HTTP {status}: {detail}")
        if not isinstance(answer, dict):
            raise LinearError("Linear error: the answer is not JSON")
        if answer.get("errors"):
            raise LinearError("Linear error: " + "; ".join(
                str(e.get("message", e)) if isinstance(e, dict) else str(e) for e in answer["errors"]))
        return answer.get("data") or {}

    def issue(self, key: str) -> dict:
        found = self.gql(Q_ISSUE, {"id": key}).get("issue")
        if not found:
            raise LinearError(f"Linear error: no issue {key}")
        return found

    def find_in_project(self, project_id: str, marker: str) -> dict | None:
        """The first issue in the project whose description has a line equal to marker.

        Linear's `contains` is a substring match, so whole lines are compared here:
        .../discussions/1 never matches an issue filed for .../discussions/12.
        """
        data = self.gql(Q_FIND, {"project": project_id, "text": marker})
        for node in (data.get("issues") or {}).get("nodes") or []:
            lines = (node.get("description") or "").splitlines()
            if any(line.strip() == marker for line in lines):
                return node
        return None

    def state_id(self, team_id: str, name: str) -> str:
        nodes = (self.gql(Q_STATE, {"team": team_id, "name": name}).get("workflowStates") or {}).get("nodes") or []
        if not nodes:
            raise LinearError(f"Linear error: no state named {name} in the team")
        return nodes[0]["id"]

    def create_issue(self, *, team_id: str, project_id: str, state_id: str, title: str,
                     description: str, parent_id: str | None = None) -> dict:
        data = {"teamId": team_id, "projectId": project_id, "stateId": state_id,
                "title": title, "description": description}
        if parent_id:
            data["parentId"] = parent_id
        result = self.gql(M_CREATE, {"input": data}).get("issueCreate") or {}
        if not result.get("success"):
            raise LinearError("Linear error: issueCreate failed")
        return result["issue"]


def umbrella_of(issue: dict) -> dict:
    return issue.get("parent") or issue


def _key_in(text: str) -> str | None:
    m = KEY.search(text or "")
    return f"END-{m.group(1)}" if m else None


def _fence(issue: dict, umbrella: dict, project_id: str) -> str | None:
    """W-11, SEC §5: the refusal line when the key's issue, or else its umbrella, is outside the project."""
    for it in (issue, umbrella):
        if (it.get("project") or {}).get("id") != project_id:
            return f"Refused by the harness (W-11, SEC §5): {it.get('identifier')} is outside the project Harness demo."
    return None


# --- shared by the two scripts' main() -------------------------------------------------------

def _val(env, name: str) -> str:
    return (env.get(name) or "").strip()


def _missing_env(env, names) -> list[str]:
    missing = []
    for name in names:
        if name != LINEAR_CREDENTIAL:
            if not _val(env, name):
                missing.append(name)
            continue
        if _val(env, "LINEAR_ACTIONS_TOKEN"):
            continue
        empty = [n for n in ("LINEAR_ACTIONS_CLIENT_ID", "LINEAR_ACTIONS_CLIENT_SECRET") if not _val(env, n)]
        if empty:
            missing.append(" and ".join(empty) + " (or LINEAR_ACTIONS_TOKEN)")
    return missing


def _redact(text: str, values) -> str:
    for v in sorted({v for v in values if v}, key=len, reverse=True):
        text = text.replace(v, "[redacted]")
    return text


def _main(names, call, send=None) -> int:
    """Check the env, print the auth path, get the token, build Linear and call `call(event, env, linear)`."""
    env = dict(os.environ)
    missing = _missing_env(env, names)
    if missing:
        print("Missing env: " + ", ".join(missing), file=sys.stderr)
        return 1
    hidden = [env.get(n, "") for n in CREDENTIAL_NAMES] + [_val(env, n) for n in CREDENTIAL_NAMES]
    try:
        fallback = _val(env, "LINEAR_ACTIONS_TOKEN")
        print("Linear auth: LINEAR_ACTIONS_TOKEN (fallback)" if fallback else "Linear auth: client credentials")
        with open(env["GITHUB_EVENT_PATH"], encoding="utf-8") as f:
            event = json.load(f)
        token = fallback or client_credentials_token(_val(env, "LINEAR_ACTIONS_CLIENT_ID"),
                                                     _val(env, "LINEAR_ACTIONS_CLIENT_SECRET"), send=send)
        hidden.append(token)
        return call(event, env, Linear(token, send=send))
    except (LinearError, RuntimeError) as e:
        print(_redact(str(e), hidden).replace("\n", " "), file=sys.stderr)
        return 1
    except Exception as e:  # one line, never a traceback (SEC §3)
        print(_redact(f"Error: {type(e).__name__}: {e}", hidden).replace("\n", " "), file=sys.stderr)
        return 1
