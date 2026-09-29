#!/usr/bin/env python3
"""H2 and H3 · Git and GitHub walls for entry agents.

H2 (OPS-F0-36, OPS-A4-11): a push from a branch whose name carries no umbrella
key (END-123) is refused, so nothing reaches GitHub outside a tree. A push to
main is refused the same way. Git is found however it is called: after NAME=value
or env, by its full path, or with global options such as `git -C <dir> push`
(WALL W-23).

H3 (OPS-F2-33, OPS-F2-10): people decide. An agent never approves a PR, never
posts "go" or "no" on a discussion, and merges only a PR that Henry or 서준 have
approved (branch protection refuses the rest on GitHub too). The API forms count
the same (WALL W-24): `gh api .../pulls/<n>/reviews` with APPROVE,
`gh api .../pulls/<n>/merge`, and GraphQL addPullRequestReview or
submitPullRequestReview with APPROVE, and mergePullRequest.

The hooks read the outer command line only (WALL §1): they don't unpack sh -c,
bash -c, eval or a script the agent runs.

Claude Code runs this before every Bash call; exit 2 refuses it.
"""
from __future__ import annotations
import json, os, re, shlex, subprocess, sys

KEY = re.compile(r"(?i)\bend-\d+")
ASSIGN = re.compile(r"^\w+=")

# git global options whose value is the next token (unless joined with "=")
GIT_VALUE_OPTS = ("-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env")
# gh api flags whose value is the next token
GH_API_VALUE_FLAGS = ("-X", "--method", "-H", "--header", "-f", "-F", "--field", "--raw-field",
                      "--input", "-q", "--jq", "-t", "--template", "--hostname", "-p",
                      "--preview", "--cache")
GH_API_FIELD_FLAGS = ("-f", "-F", "--field", "--raw-field", "--input")

REVIEWS = re.compile(r"^repos/[^/]+/[^/]+/pulls/\d+/reviews(/.*)?$")
MERGE = re.compile(r"^repos/([^/]+)/([^/]+)/pulls/(\d+)/merge/?$")
APPROVE = re.compile(r"(?i)\bAPPROVE\b")
NODE_ID = re.compile(r"pullRequestId\s*:\s*\\?\"([^\"\\]+)")

NO_APPROVAL = ("Refused by the harness (H3, OPS-F2-10, OPS-F2-33): this PR has no approval "
               "from Henry or 서준. Post the PR link in the umbrella's thread and wait.")
NO_SELF_APPROVE = ("Refused by the harness (H3, OPS-F2-33): agents never approve a PR. "
                   "Ask for a review in the umbrella's thread.")
NO_GO = ("Refused by the harness (H3, OPS-F2-33): only Henry or 서준 post "
         "\"go\" or \"no\" on a discussion.")


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


def review_decision(pr: str | None, cwd: str | None, repo: str | None = None) -> str:
    """GitHub's review decision for a PR ('APPROVED', ...), or '' when it can't be read."""
    gh = os.environ.get("ENDIX_GH", "gh")
    cmd = ([gh, "pr", "view"] + ([pr] if pr else []) + (["--repo", repo] if repo else [])
           + ["--json", "reviewDecision", "-q", ".reviewDecision"])
    try:
        return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=15).stdout.strip()
    except Exception:
        return ""


def review_decision_by_node(node_id: str, cwd: str | None) -> str:
    """The review decision of the PR with this GraphQL node ID, or '' when it can't be read."""
    gh = os.environ.get("ENDIX_GH", "gh")
    cmd = [gh, "api", "graphql",
           "-f", "query=query($id: ID!) { node(id: $id) { ... on PullRequest { reviewDecision } } }",
           "-f", f"id={node_id}", "--jq", ".data.node.reviewDecision"]
    try:
        return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=15).stdout.strip()
    except Exception:
        return ""


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


def program(toks: list[str]) -> tuple[str, list[str]]:
    """The program a command runs (basename) and its arguments.

    Drops leading NAME=value tokens, then one leading `env` or `command`, then the
    NAME=value tokens after it: `env GIT_TRACE=1 /usr/bin/git push` is ("git", ["push"]).
    """
    i = 0
    while i < len(toks) and ASSIGN.match(toks[i]):
        i += 1
    if i < len(toks) and toks[i] in ("env", "command"):
        i += 1
        while i < len(toks) and ASSIGN.match(toks[i]):
            i += 1
    if i >= len(toks):
        return "", []
    return os.path.basename(toks[i]), toks[i + 1:]


def git_subcommand(args: list[str]) -> tuple[str, list[str]] | None:
    """For the tokens after `git`: the subcommand and the tokens after it, past git's global options."""
    i = 0
    while i < len(args):
        tok = args[i]
        if tok in GIT_VALUE_OPTS:
            i += 2
        elif tok.startswith("-"):
            i += 1
        else:
            return tok, args[i + 1:]
    return None


def gh_api(args: list[str]) -> tuple[str, str] | None:
    """For the tokens after `gh`: (method, endpoint) of a `gh api` call, else None.

    The method is -X/--method's value, else POST when a field or --input is given
    (gh's default), else GET. The endpoint drops https://api.github.com/, a leading
    "/" and any query string; a GraphQL call's endpoint is "graphql".
    """
    if not args or args[0] != "api":
        return None
    method = None
    fields = False
    endpoint = ""
    i = 1
    while i < len(args):
        tok = args[i]
        if tok in ("-X", "--method"):
            if i + 1 < len(args):
                method = args[i + 1]
            i += 2
            continue
        if tok in GH_API_FIELD_FLAGS:
            fields = True
        if tok in GH_API_VALUE_FLAGS:
            i += 2
            continue
        if tok.startswith("-X") and len(tok) > 2:
            method = tok[2:]
        elif tok.startswith("--method="):
            method = tok.split("=", 1)[1]
        elif (tok.startswith(("-f", "-F")) and len(tok) > 2) or \
                tok.startswith(("--field=", "--raw-field=", "--input=")):
            fields = True
        elif not tok.startswith("-") and not endpoint:
            endpoint = tok
        i += 1
    if method is None:
        method = "POST" if fields else "GET"
    if endpoint.startswith("https://api.github.com/"):
        endpoint = endpoint[len("https://api.github.com/"):]
    endpoint = endpoint.lstrip("/").split("?", 1)[0]
    return method.upper(), endpoint


def is_write(method: str) -> bool:
    return method not in ("GET", "HEAD")


def decide_h3_api(method: str, endpoint: str, args: list[str], command: str,
                  cwd: str | None) -> str | None:
    """H3's API forms of approving and merging (WALL W-24)."""
    if endpoint == "graphql":
        if "mutation" not in command:
            return None
        if ("addPullRequestReview" in command or "submitPullRequestReview" in command) \
                and APPROVE.search(command):
            return NO_SELF_APPROVE
        if "mergePullRequest" in command:
            m = NODE_ID.search(command)
            if not m or review_decision_by_node(m.group(1), cwd) != "APPROVED":
                return NO_APPROVAL
        return None
    if not is_write(method):
        return None
    if REVIEWS.match(endpoint):
        with_input = any(t == "--input" or t.startswith("--input=") for t in args)
        if APPROVE.search(command) or with_input:
            return NO_SELF_APPROVE
    m = MERGE.match(endpoint)
    if m:
        owner, repo, number = m.groups()
        placeholder = "{owner}" in endpoint or "{repo}" in endpoint
        target = None if placeholder else f"{owner}/{repo}"
        if review_decision(number, cwd, repo=target) != "APPROVED":
            return NO_APPROVAL
    return None


def decide(command: str, cwd: str | None = None) -> str | None:
    for toks in split_commands(command):
        prog, args = program(toks)
        sub = git_subcommand(args) if prog == "git" else None
        if sub and sub[0] == "push":
            branch = pushed_branch(sub[1], cwd)
            if branch in ("main", "master"):
                return ("Refused by the harness (H2, OPS-F2-25): nothing is pushed to main. "
                        "Work on a branch named from its Linear step and open a PR.")
            if not KEY.search(branch or ""):
                return (f"Refused by the harness (H2, OPS-F0-36): branch '{branch}' carries no "
                        "umbrella key. Name it from its Linear step, like "
                        "henrychoi/end-123-short-title. No key: post the ask in #lighthouse.")
        if prog != "gh":
            continue
        if args[:2] == ["pr", "merge"]:
            pr = next((t for t in args[2:] if not t.startswith("-")), None)
            if review_decision(pr, cwd) != "APPROVED":
                return NO_APPROVAL
        if args[:2] == ["pr", "review"] and any(t in ("--approve", "-a") for t in args):
            return NO_SELF_APPROVE
        if args[:1] == ["api"] and "addDiscussionComment" in " ".join(toks):
            body = " ".join(toks)
            if re.search(r"body[\"']?\s*[:=]\s*[\"']?\s*(go|no)\b", body, re.I):
                return NO_GO
        api = gh_api(args)
        if api:
            msg = decide_h3_api(api[0], api[1], args, command, cwd)
            if msg:
                return msg
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
