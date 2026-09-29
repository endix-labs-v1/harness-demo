#!/usr/bin/env python3
"""H4 · Entry agents work on GitHub through branches and PRs only (OPS-A4-11,
OPS-F2-25; WALL W-25).

GitHub's walls and history are Henry's. Refused:
- `gh api` writes to branch protection, rulesets, collaborators, secrets,
  variables, Actions permissions, hooks, keys, environments, git/refs, transfer,
  or the repo itself;
- GraphQL mutations on branch protection rules, rulesets, the repository or refs
  (updateRef, updateRefs, deleteRef);
- `gh repo edit/delete/rename/archive/unarchive`, `gh repo sync --force`, and
  `gh secret`, `gh variable`, `gh ruleset` with any subcommand;
- `git push` that forces, mirrors, prunes or deletes (--force, -f,
  --force-with-lease, --mirror, --delete, -d, --prune, a "+" or ":" refspec);
- any write tool of a GitHub MCP connector: the entry agent uses `gh`, so the
  hooks can read what it does. Only get_, list_, search_ and read_ tools pass.

Everything else passes, reads included. The hooks read the outer command line
only (WALL §1): they don't unpack sh -c, bash -c, eval or a script the agent runs.

Claude Code runs this before every Bash call and every MCP tool call; exit 2
refuses it.
"""
from __future__ import annotations
import json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from h2_h3_git import split_commands, program, git_subcommand, gh_api  # noqa: E402

REFUSAL = ("Refused by the harness (H4, OPS-A4-11, OPS-F2-25): entry agents work on GitHub "
           "through branches and PRs only. Settings, branch protection, collaborators, "
           "secrets and force pushes are Henry's.")

PROTECTED = re.compile(
    r"^repos/[^/]+/[^/]+"
    r"(/(branches/.+/protection|rulesets|collaborators|hooks|keys|environments|git/refs"
    r"|transfer|actions/permissions)(/.*)?"
    r"|/(.*/)?(secrets|variables)(/.*)?)?/?$")

GRAPHQL_PROTECTED = re.compile(
    r"\b(create|update|delete)(BranchProtectionRule|RepositoryRuleset)\b"
    r"|\b(update|archive|unarchive)Repository\b"
    r"|\b(updateRef|updateRefs|deleteRef)\b")

REPO_SUBCOMMANDS = ("edit", "delete", "rename", "archive", "unarchive")
READ_TOOL_PREFIXES = ("get_", "list_", "search_", "read_")


def rewrites_history(push_args: list[str]) -> bool:
    """A `git push` that forces, mirrors, prunes or deletes."""
    for tok in push_args:
        if tok in ("--force", "-f", "--mirror", "--delete", "-d", "--prune"):
            return True
        if tok == "--force-with-lease" or tok.startswith("--force-with-lease="):
            return True
        if tok.startswith("-") and not tok.startswith("--") and ("f" in tok[1:] or "d" in tok[1:]):
            return True
        if not tok.startswith("-") and tok.startswith(("+", ":")):
            return True
    return False


def decide(command: str, cwd: str | None = None) -> str | None:
    """Return the refusal for a shell command, or None to allow."""
    for toks in split_commands(command):
        prog, args = program(toks)
        if prog == "git":
            sub = git_subcommand(args)
            if sub and sub[0] == "push" and rewrites_history(sub[1]):
                return REFUSAL
            continue
        if prog != "gh" or not args:
            continue
        api = gh_api(args)
        if api:
            method, endpoint = api
            if endpoint == "graphql":
                if "mutation" in command and GRAPHQL_PROTECTED.search(command):
                    return REFUSAL
            elif method not in ("GET", "HEAD") and PROTECTED.match(endpoint):
                return REFUSAL
            continue
        if args[0] == "repo" and len(args) > 1:
            if args[1] in REPO_SUBCOMMANDS:
                return REFUSAL
            if args[1] == "sync" and "--force" in args:
                return REFUSAL
        if args[0] in ("secret", "variable", "ruleset"):
            return REFUSAL
    return None


def decide_tool(tool_name: str) -> str | None:
    """Return the refusal for an MCP tool, or None to allow: GitHub connector tools pass only when they read."""
    parts = tool_name.split("__")
    if len(parts) < 2:
        return None
    server, tool = parts[1], parts[-1]
    if "github" not in server.lower():
        return None
    if tool.startswith(READ_TOOL_PREFIXES):
        return None
    return REFUSAL


def main() -> None:
    data = json.load(sys.stdin)
    tool_name = data.get("tool_name", "")
    if tool_name.startswith("mcp__"):
        msg = decide_tool(tool_name)
    else:
        msg = decide((data.get("tool_input") or {}).get("command", ""), data.get("cwd"))
    if msg:
        print(msg, file=sys.stderr)
        sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
