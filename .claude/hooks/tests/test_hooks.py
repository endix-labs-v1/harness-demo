"""Each wall refuses what it should, and lets the rest through. Run: python3 -m pytest .claude/hooks/tests"""
import json, os, subprocess, sys, pathlib

HOOKS = pathlib.Path(__file__).resolve().parents[1]


def run(hook, payload, env=None):
    p = subprocess.run([sys.executable, str(HOOKS / hook)], input=json.dumps(payload),
                       capture_output=True, text=True, env={**os.environ, **(env or {})})
    return p.returncode, p.stderr


# H1: Notion and Linear writes
def test_h1_refuses_notion_write():
    code, err = run("h1_records.py", {"tool_name": "mcp__notion__notion-update-page"})
    assert code == 2 and "doc manager" in err

def test_h1_refuses_linear_write():
    code, err = run("h1_records.py", {"tool_name": "mcp__linear__save_issue"})
    assert code == 2 and "task manager" in err

def test_h1_allows_reads():
    for t in ("mcp__notion__notion-fetch", "mcp__notion__notion-search", "mcp__linear__get_issue", "mcp__linear__list_issues"):
        assert run("h1_records.py", {"tool_name": t})[0] == 0, t

def test_h1_allows_other_tools():
    assert run("h1_records.py", {"tool_name": "mcp__figma__get_screenshot"})[0] == 0

def test_h1_interim_switch():
    assert run("h1_records.py", {"tool_name": "mcp__linear__save_issue"}, {"ENDIX_INTERIM": "1"})[0] == 0


# H2: push needs an umbrella key
def bash(cmd):
    return {"tool_name": "Bash", "tool_input": {"command": cmd}}

def test_h2_refuses_keyless_branch():
    code, err = run("h2_h3_git.py", bash("git push origin fix-rounding"))
    assert code == 2 and "umbrella key" in err

def test_h2_refuses_main():
    assert run("h2_h3_git.py", bash("git push origin main"))[0] == 2

def test_h2_allows_keyed_branch():
    assert run("h2_h3_git.py", bash("git push -u origin henrychoi/end-123-fix-rounding"))[0] == 0

def test_h2_sees_chained_commands():
    assert run("h2_h3_git.py", bash("git add . && git commit -m x && git push origin quick-fix"))[0] == 2


# H3: people decide
def fake_gh(tmp_path, decision):
    f = tmp_path / "gh"; f.write_text(f"#!/bin/sh\necho {decision}\n"); f.chmod(0o755)
    return {"ENDIX_GH": str(f)}

def test_h3_refuses_merge_without_approval(tmp_path):
    code, err = run("h2_h3_git.py", bash("gh pr merge 12 --squash"), fake_gh(tmp_path, "REVIEW_REQUIRED"))
    assert code == 2 and "no approval" in err

def test_h3_refuses_merge_when_unknown():
    assert run("h2_h3_git.py", bash("gh pr merge 12"), {"ENDIX_GH": "/nonexistent/gh"})[0] == 2

def test_h3_allows_merge_after_approval(tmp_path):
    assert run("h2_h3_git.py", bash("gh pr merge 12 --squash"), fake_gh(tmp_path, "APPROVED"))[0] == 0

def test_h3_refuses_approve():
    assert run("h2_h3_git.py", bash("gh pr review 12 --approve"))[0] == 2

def test_h3_allows_comment_review():
    assert run("h2_h3_git.py", bash("gh pr review 12 --comment -b 'looks fine'"))[0] == 0

def test_h3_refuses_go_on_discussion():
    cmd = "gh api graphql -f query='mutation { addDiscussionComment(input: {discussionId: \"D1\", body: \"go\"}) { comment { id } } }'"
    assert run("h2_h3_git.py", bash(cmd))[0] == 2

def test_other_commands_pass():
    assert run("h2_h3_git.py", bash("forge test -vv"))[0] == 0
