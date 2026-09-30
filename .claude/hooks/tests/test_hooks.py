"""Each wall refuses what it should, and lets the rest through. Run: python3 -m pytest .claude/hooks/tests"""
import json, os, re, subprocess, sys, pathlib

HOOKS = pathlib.Path(__file__).resolve().parents[1]
RULE_ID = re.compile(r"(OPS|CODE|PROD|BD|GTM|RES|CO)-[A-Z0-9]+-\d+")

H1_SLACK = ("Refused by the harness (H1, OPS-F0-38): entry agents post in Slack only through "
            "endix-entry-slack, as the Entry agent. Use post_in_thread or hand_off.")
H3_APPROVE = ("Refused by the harness (H3, OPS-F2-33): agents never approve a PR. "
              "Ask for a review in the umbrella's thread.")
H3_GO = "Refused by the harness (H3, OPS-F2-33): only Henry or 서준 post \"go\" or \"no\" on a discussion."
H4 = ("Refused by the harness (H4, OPS-A4-11, OPS-F2-25): entry agents work on GitHub through "
      "branches and PRs only. Settings, branch protection, collaborators, secrets and force "
      "pushes are Henry's.")


def run(hook, payload, env=None):
    p = subprocess.run([sys.executable, str(HOOKS / hook)], input=json.dumps(payload),
                       capture_output=True, text=True, env={**os.environ, **(env or {})})
    return p.returncode, p.stderr


def assert_refused(err, hook):
    """WALL §1: a layer C refusal starts with the hook ID and holds a rule ID."""
    assert err.startswith(f"Refused by the harness ({hook}, "), err
    assert RULE_ID.search(err), err


# H1: Notion and Linear writes
def test_h1_refuses_notion_write():
    """T-H-1 · A Notion write is refused, naming the doc manager."""
    code, err = run("h1_records.py", {"tool_name": "mcp__notion__notion-update-page"})
    assert code == 2 and "doc manager" in err
    assert_refused(err, "H1")

def test_h1_refuses_linear_write():
    """T-H-2 · A Linear write is refused, naming the task manager."""
    code, err = run("h1_records.py", {"tool_name": "mcp__linear__save_issue"})
    assert code == 2 and "task manager" in err
    assert_refused(err, "H1")

def test_h1_allows_reads():
    """T-H-3 · Notion and Linear reads pass."""
    for t in ("mcp__notion__notion-fetch", "mcp__notion__notion-search", "mcp__linear__get_issue", "mcp__linear__list_issues"):
        assert run("h1_records.py", {"tool_name": t})[0] == 0, t

def test_h1_allows_other_tools():
    """T-H-4 · Tools of other servers pass H1."""
    assert run("h1_records.py", {"tool_name": "mcp__figma__get_screenshot"})[0] == 0

def test_h1_interim_switch():
    """T-H-5 · ENDIX_INTERIM=1 lets a Linear write through."""
    assert run("h1_records.py", {"tool_name": "mcp__linear__save_issue"}, {"ENDIX_INTERIM": "1"})[0] == 0


# H1: Slack writes (W-22)
SLACK_REFUSED = ("slack_send_message", "slack_send_message_draft", "slack_schedule_message",
                 "slack_add_reaction", "slack_add_list_record", "slack_create_canvas",
                 "slack_create_conversation", "slack_create_list", "slack_update_canvas",
                 "slack_update_list", "slack_update_list_record", "slack_get_file_upload_url",
                 "slack_complete_file_upload")
SLACK_ALLOWED = ("slack_read_thread", "slack_read_channel", "slack_read_canvas", "slack_read_file",
                 "slack_read_list", "slack_read_user_profile", "slack_search_channels",
                 "slack_search_emojis", "slack_search_public", "slack_search_public_and_private",
                 "slack_search_users", "slack_list_channel_members", "slack_list_user_channels",
                 "slack_get_reactions")

def test_t_h_6_slack_connector_write_refused():
    """T-H-6 · A Slack connector write is refused with the H1 Slack text, naming endix-entry-slack."""
    code, err = run("h1_records.py", {"tool_name": "mcp__claude_ai_Slack__slack_send_message"})
    assert code == 2 and err.strip() == H1_SLACK and "endix-entry-slack" in err
    assert_refused(err, "H1")

def test_t_h_7_entry_slack_allowed():
    """T-H-7 · endix-entry-slack's tools pass: they run W-12 themselves."""
    assert run("h1_records.py", {"tool_name": "mcp__endix-entry-slack__post_in_thread"})[0] == 0

def test_t_h_8_slack_read_allowed():
    """T-H-8 · A Slack connector read passes."""
    assert run("h1_records.py", {"tool_name": "mcp__claude_ai_Slack__slack_read_thread"})[0] == 0

def test_h1_slack_connector_names():
    """No ID · Every claude.ai Slack connector tool gets the result of the T3 Spec's table."""
    for t in SLACK_REFUSED:
        code, err = run("h1_records.py", {"tool_name": f"mcp__claude_ai_Slack__{t}"})
        assert code == 2 and err.strip() == H1_SLACK, t
        assert_refused(err, "H1")
    for t in SLACK_ALLOWED:
        assert run("h1_records.py", {"tool_name": f"mcp__claude_ai_Slack__{t}"})[0] == 0, t

def test_h1_interim_does_not_open_slack():
    """No ID · ENDIX_INTERIM=1 doesn't open Slack writes: nobody posts as Henry."""
    code, err = run("h1_records.py", {"tool_name": "mcp__claude_ai_Slack__slack_send_message"},
                    {"ENDIX_INTERIM": "1"})
    assert code == 2
    assert_refused(err, "H1")


# H2: push needs an umbrella key
def bash(cmd):
    return {"tool_name": "Bash", "tool_input": {"command": cmd}}

def test_h2_refuses_keyless_branch():
    """T-H-9 · A push from a branch with no umbrella key is refused."""
    code, err = run("h2_h3_git.py", bash("git push origin fix-rounding"))
    assert code == 2 and "umbrella key" in err
    assert_refused(err, "H2")

def test_h2_refuses_main():
    """T-H-10 · A push to main is refused."""
    code, err = run("h2_h3_git.py", bash("git push origin main"))
    assert code == 2
    assert_refused(err, "H2")

def test_h2_allows_keyed_branch():
    """T-H-11 · A push from a branch named from its Linear step passes."""
    assert run("h2_h3_git.py", bash("git push -u origin henrychoi/end-123-fix-rounding"))[0] == 0

def test_h2_sees_chained_commands():
    """T-H-12 · A keyless push at the end of a chain is refused."""
    code, err = run("h2_h3_git.py", bash("git add . && git commit -m x && git push origin quick-fix"))
    assert code == 2
    assert_refused(err, "H2")

def test_t_h_13_env_prefix_push_refused():
    """T-H-13 · A keyless push after a NAME=value prefix is refused."""
    code, err = run("h2_h3_git.py", bash("GIT_TRACE=1 git push origin quick-fix"))
    assert code == 2 and "umbrella key" in err
    assert_refused(err, "H2")

def test_t_h_31_git_dash_c_push_refused():
    """T-H-31 · `git -C <dir> push` from a keyless branch is refused by H2."""
    code, err = run("h2_h3_git.py", bash("git -C . push origin quick-fix"))
    assert code == 2 and "umbrella key" in err
    assert_refused(err, "H2")

def test_t_h_32_full_path_git_push_refused():
    """T-H-32 · git by its full path, also after env, is refused by H2."""
    for cmd in ("/usr/bin/git push origin quick-fix", "env GIT_TRACE=1 /usr/bin/git push origin quick-fix"):
        code, err = run("h2_h3_git.py", bash(cmd))
        assert code == 2 and "umbrella key" in err, cmd
        assert_refused(err, "H2")

def git_repo(path, branch):
    """A throwaway repo on `branch`, for pushes the hook reads as the current branch."""
    subprocess.run(["git", "init", "-q", "-b", branch, str(path)], check=True)
    subprocess.run(["git", "-C", str(path), "-c", "user.name=t", "-c", "user.email=t@example.com",
                    "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "x"], check=True)
    return str(path)

def test_h2_current_branch_subshell_and_continuation_pass(tmp_path):
    """No ID · A keyed branch pushed as "$(git branch --show-current)", in backticks or across a backslash-newline passes (S3-11)."""
    repo = git_repo(tmp_path / "keyed", "henrychoi/end-123-fix-rounding")
    for cmd in ('git push -u origin "$(git branch --show-current)"',
                "git push -u origin $(git branch --show-current)",
                "git push -u origin `git rev-parse --abbrev-ref HEAD`",
                "git push -u origin \\\n  henrychoi/end-123-fix-rounding",
                "git push -u origin \\"):
        assert run("h2_h3_git.py", {**bash(cmd), "cwd": repo})[0] == 0, cmd

def test_h2_subshell_and_continuation_still_refused(tmp_path):
    """No ID · The same forms from main or a keyless branch, main across a continuation, and a subshell the hook can't read are refused."""
    main = git_repo(tmp_path / "main", "main")
    keyless = git_repo(tmp_path / "keyless", "quick-fix")
    keyed = git_repo(tmp_path / "keyed", "henrychoi/end-123-fix-rounding")
    for cmd, cwd in (('git push -u origin "$(git branch --show-current)"', main),
                     ('git push -u origin "$(git branch --show-current)"', keyless),
                     ("git push -u origin \\\n  quick-fix", keyed),
                     ("git push origin main \\", keyed),
                     ("git push origin $(echo main)", keyed)):
        code, err = run("h2_h3_git.py", {**bash(cmd), "cwd": cwd})
        assert code == 2, (cmd, cwd)
        assert_refused(err, "H2")


# H3: people decide
def fake_gh(tmp_path, decision):
    f = tmp_path / "gh"; f.write_text(f"#!/bin/sh\necho {decision}\n"); f.chmod(0o755)
    return {"ENDIX_GH": str(f)}

def test_h3_refuses_merge_without_approval(tmp_path):
    """T-H-14 · `gh pr merge` on a PR with no approval is refused."""
    code, err = run("h2_h3_git.py", bash("gh pr merge 12 --squash"), fake_gh(tmp_path, "REVIEW_REQUIRED"))
    assert code == 2 and "no approval" in err
    assert_refused(err, "H3")

def test_h3_refuses_merge_when_unknown():
    """T-H-15 · `gh pr merge` is refused when the review decision can't be read."""
    code, err = run("h2_h3_git.py", bash("gh pr merge 12"), {"ENDIX_GH": "/nonexistent/gh"})
    assert code == 2
    assert_refused(err, "H3")

def test_h3_allows_merge_after_approval(tmp_path):
    """T-H-16 · `gh pr merge` passes once a person approved."""
    assert run("h2_h3_git.py", bash("gh pr merge 12 --squash"), fake_gh(tmp_path, "APPROVED"))[0] == 0

def fake_gh_for(path, argv):
    """A gh that answers APPROVED only when it is called with exactly `argv`."""
    path.mkdir()
    f = path / "gh"
    f.write_text(f'#!/bin/sh\nif [ "$*" = "{argv}" ]; then echo APPROVED; else echo REVIEW_REQUIRED; fi\n')
    f.chmod(0o755)
    return {"ENDIX_GH": str(f)}

def test_h3_merge_reads_the_pr_past_flag_values(tmp_path):
    """No ID · An approved `gh pr merge` passes when flags with values come first; the -R/--repo repo is the one checked (S3-20)."""
    here = fake_gh_for(tmp_path / "here", "pr view 12 --json reviewDecision -q .reviewDecision")
    for cmd in ("gh pr merge 12 --squash", "gh pr merge --subject 'Add totalWithFee' 12 --squash",
                "gh pr merge -t x -b 'y z' --match-head-commit abc123 12"):
        assert run("h2_h3_git.py", bash(cmd), here)[0] == 0, cmd
    there = fake_gh_for(tmp_path / "there", "pr view 12 --repo o/r --json reviewDecision -q .reviewDecision")
    for cmd in ("gh pr merge -R o/r 12 --squash", "gh pr merge --repo=o/r 12", "gh pr merge 12 --squash --repo o/r"):
        assert run("h2_h3_git.py", bash(cmd), there)[0] == 0, cmd
    for cmd in ("gh pr merge -R o/r 13 --squash", "gh pr merge 12 --squash"):
        code, err = run("h2_h3_git.py", bash(cmd), there)
        assert code == 2 and "no approval" in err, cmd
        assert_refused(err, "H3")

def test_h3_refuses_approve():
    """T-H-17 · `gh pr review --approve` and `-a` are refused."""
    code, err = run("h2_h3_git.py", bash("gh pr review 12 --approve"))
    assert code == 2
    assert_refused(err, "H3")
    code, err = run("h2_h3_git.py", bash("gh pr review 12 -a"))
    assert code == 2
    assert_refused(err, "H3")

def test_h3_allows_comment_review():
    """T-H-18 · A comment review passes."""
    assert run("h2_h3_git.py", bash("gh pr review 12 --comment -b 'looks fine'"))[0] == 0

def test_h3_refuses_go_on_discussion():
    """T-H-19 · An agent posting "go" on a discussion is refused."""
    cmd = "gh api graphql -f query='mutation { addDiscussionComment(input: {discussionId: \"D1\", body: \"go\"}) { comment { id } } }'"
    code, err = run("h2_h3_git.py", bash(cmd))
    assert code == 2
    assert_refused(err, "H3")

def test_t_h_20_no_on_discussion_refused():
    """T-H-20 · An agent posting "no" on a discussion is refused."""
    cmd = "gh api graphql -f query='mutation { addDiscussionComment(input: {discussionId: \"D1\", body: \"no\"}) { comment { id } } }'"
    code, err = run("h2_h3_git.py", bash(cmd))
    assert code == 2
    assert_refused(err, "H3")

GQL_COMMENT_VAR = "mutation($t: String!) { addDiscussionComment(input: {discussionId: \"D1\", body: $t}) { comment { id } } }"

def test_h3_refuses_go_across_lines_and_in_a_field():
    """No ID · "go" or "no" is refused when the query spans lines, the line is continued, or the text comes in a field (S3-08)."""
    for cmd in ("gh api graphql -f query='\nmutation {\n  addDiscussionComment(input: {discussionId: \"D1\", body: \"go\"}) {\n"
                "    comment { id }\n  }\n}'",
                "gh api graphql \\\n  -f query='mutation { addDiscussionComment(input: {discussionId: \"D1\", body: \"no\"}) "
                "{ comment { id } } }'",
                f"gh api graphql -f query='{GQL_COMMENT_VAR}' -f t=go",
                f"gh api graphql -F 't=No' -f query='{GQL_COMMENT_VAR}'",
                'gh api graphql -f query="mutation { addDiscussionComment(input: {discussionId: \\"D1\\", '
                'body: \\"go\\"}) { comment { id } } }"'):
        code, err = run("h2_h3_git.py", bash(cmd))
        assert code == 2 and err.strip() == H3_GO, cmd
        assert_refused(err, "H3")

def test_h3_allows_proposed_conclusion_comment():
    """No ID · The agent's own discussion comment passes H3, in one line, across lines or in a field (S3-06)."""
    text = "Proposed conclusion: add totalWithFee(amount), rounded down as feeOf"
    for cmd in (f"gh api graphql -f query='mutation {{ addDiscussionComment(input: {{discussionId: \"D1\", body: \"{text}\"}}) "
                "{ comment { id } } }'",
                f"gh api graphql -f query='mutation {{\n  addDiscussionComment(input: {{discussionId: \"D1\", body: \"{text}\"}}) {{\n"
                "    comment { id }\n  }\n}'",
                f"gh api graphql -f query='{GQL_COMMENT_VAR}' -f t='{text}' -f id=D_kwDO1"):
        assert run("h2_h3_git.py", bash(cmd))[0] == 0, cmd

def test_t_h_33_api_approve_refused():
    """T-H-33 · Approving through the REST API is refused with the H3 approve text."""
    code, err = run("h2_h3_git.py", bash("gh api repos/o/r/pulls/12/reviews -f event=APPROVE"))
    assert code == 2 and err.strip() == H3_APPROVE
    assert_refused(err, "H3")

def test_t_h_34_api_merge_without_approval_refused(tmp_path):
    """T-H-34 · Merging through the REST API with no approval is refused."""
    code, err = run("h2_h3_git.py", bash("gh api -X PUT repos/o/r/pulls/12/merge"),
                    fake_gh(tmp_path, "REVIEW_REQUIRED"))
    assert code == 2 and "no approval" in err
    assert_refused(err, "H3")

GQL_MERGE = "gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: \"PR_1\"}) { clientMutationId } }'"
GQL_APPROVE = "gh api graphql -f query='mutation { addPullRequestReview(input: {pullRequestId: \"PR_1\", event: APPROVE}) { clientMutationId } }'"

def test_t_h_35_graphql_merge_and_approve_refused(tmp_path):
    """T-H-35 · GraphQL mergePullRequest with no approval, and addPullRequestReview with APPROVE, are refused."""
    env = fake_gh(tmp_path, "REVIEW_REQUIRED")
    code, err = run("h2_h3_git.py", bash(GQL_MERGE), env)
    assert code == 2 and "no approval" in err
    assert_refused(err, "H3")
    code, err = run("h2_h3_git.py", bash(GQL_APPROVE), env)
    assert code == 2 and err.strip() == H3_APPROVE
    assert_refused(err, "H3")

def test_h3_api_forms_with_approval_pass(tmp_path):
    """No ID · With a person's approval the REST and GraphQL merges pass; a COMMENT review passes."""
    env = fake_gh(tmp_path, "APPROVED")
    assert run("h2_h3_git.py", bash("gh api -X PUT repos/o/r/pulls/12/merge"), env)[0] == 0
    assert run("h2_h3_git.py", bash(GQL_MERGE), env)[0] == 0
    assert run("h2_h3_git.py", bash("gh api repos/o/r/pulls/12/reviews -f event=COMMENT -f body=x"), env)[0] == 0

def test_other_commands_pass():
    """No ID · A command that is neither git nor gh passes."""
    assert run("h2_h3_git.py", bash("forge test -vv"))[0] == 0


# H4: GitHub's walls and history are Henry's (W-25)
def h4_refuses(cmd):
    code, err = run("h4_github_settings.py", bash(cmd))
    assert code == 2, cmd
    assert_refused(err, "H4")
    return err

def test_t_h_21_protection_put_refused():
    """T-H-21 · Writing branch protection through the API is refused with the H4 text."""
    err = h4_refuses("gh api -X PUT repos/o/r/branches/main/protection --input protection.json")
    assert err.strip() == H4

def test_t_h_22_protection_delete_refused():
    """T-H-22 · Deleting branch protection through the API is refused."""
    h4_refuses("gh api -X DELETE repos/o/r/branches/main/protection")

def test_t_h_23_collaborator_fields_refused():
    """T-H-23 · Adding a collaborator (a field call, so a write) is refused."""
    h4_refuses("gh api repos/o/r/collaborators/x -f permission=admin")

def test_t_h_24_protection_get_allowed():
    """T-H-24 · Reading branch protection passes."""
    assert run("h4_github_settings.py", bash("gh api repos/o/r/branches/main/protection"))[0] == 0

def test_t_h_25_repo_edit_refused():
    """T-H-25 · `gh repo edit` is refused."""
    h4_refuses("gh repo edit --default-branch x")

def test_t_h_26_secrets_set_refused():
    """T-H-26 · `gh secret set` is refused. (Named "secrets_set" so the SEC §3 secret scan doesn't match the name.)"""
    h4_refuses("gh secret set X")

def test_t_h_27_graphql_protection_mutation_refused():
    """T-H-27 · A GraphQL mutation on a branch protection rule is refused."""
    h4_refuses("gh api graphql -f query='mutation { updateBranchProtectionRule(input: "
               "{branchProtectionRuleId: \"B1\", requiresApprovingReviews: false}) { clientMutationId } }'")

def test_t_h_28_force_push_refused():
    """T-H-28 · A force push is refused."""
    h4_refuses("git push --force origin henrychoi/end-1-x")

def test_t_h_29_plus_refspec_refused():
    """T-H-29 · A push with a "+" refspec is refused."""
    h4_refuses("git push origin +henrychoi/end-1-x")

def test_t_h_30_delete_refspec_refused():
    """T-H-30 · A push with a ":branch" refspec (a delete) is refused."""
    h4_refuses("git push origin :henrychoi/end-1-x")

def test_t_h_36_git_refs_patch_refused():
    """T-H-36 · Moving a ref through the API is refused with the H4 text."""
    err = h4_refuses("gh api -X PATCH repos/o/r/git/refs/heads/main -f force=true")
    assert err.strip() == H4

def test_t_h_37_graphql_ref_mutations_refused():
    """T-H-37 · GraphQL updateRef, deleteRef and updateRefs are refused."""
    for m in ("updateRef(input: {refId: \"R1\", oid: \"abc\", force: true})",
              "deleteRef(input: {refId: \"R1\"})",
              "updateRefs(input: {repositoryId: \"R0\", refUpdates: []})"):
        h4_refuses(f"gh api graphql -f query='mutation {{ {m} {{ clientMutationId }} }}'")

def test_t_h_38_variable_sync_unarchive_refused():
    """T-H-38 · `gh variable set`, `gh repo sync --force` and `gh repo unarchive` are refused."""
    for cmd in ("gh variable set X", "gh repo sync --force", "gh repo unarchive"):
        h4_refuses(cmd)

def test_t_h_39_push_prune_refused():
    """T-H-39 · `git push --prune` is refused."""
    h4_refuses("git push --prune origin")

def test_t_h_40_github_mcp_write_refused():
    """T-H-40 · A GitHub MCP connector write tool is refused with the H4 text."""
    code, err = run("h4_github_settings.py", {"tool_name": "mcp__github__merge_pull_request"})
    assert code == 2 and err.strip() == H4
    assert_refused(err, "H4")

def test_h4_allows_normal_work():
    """No ID · What the entry agent needs in S1, S3 and S6 passes H4, and so do reads."""
    for cmd in ("git push -u origin henrychoi/end-1-x",
                "gh pr create --title \"END-1 x\" --body y",
                "gh pr edit 1 --body y",
                "gh api graphql -f query='mutation { createDiscussion(input: {repositoryId: \"R1\", "
                "categoryId: \"C1\", title: \"x\", body: \"y\"}) { discussion { url } } }'",
                "gh api graphql -f query='mutation { addDiscussionComment(input: {discussionId: \"D1\", "
                "body: \"Proposed conclusion\"}) { comment { id } } }'",
                "gh api repos/o/r/issues -f title=x",
                "gh repo view",
                "gh repo sync"):
        assert run("h4_github_settings.py", bash(cmd))[0] == 0, cmd
    for t in ("mcp__github__get_file_contents", "mcp__notion__notion-fetch"):
        assert run("h4_github_settings.py", {"tool_name": t})[0] == 0, t


# Settings: which hooks run on which tools (SYS §7)
def test_settings_wire_the_hooks():
    """No ID · settings.json runs H1 then H4 on mcp__.*, and H2/H3 then H4 on Bash."""
    hooks = json.loads((HOOKS.parent / "settings.json").read_text())["hooks"]
    wired = {m["matcher"]: [h["command"].split("/")[-1] for h in m["hooks"]] for m in hooks["PreToolUse"]}
    assert wired == {"mcp__.*": ["h1_records.py", "h4_github_settings.py"],
                     "Bash": ["h2_h3_git.py", "h4_github_settings.py"]}
