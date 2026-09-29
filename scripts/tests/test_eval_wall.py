"""The eval wall W-33 fails what it should (T11, TEST §2.2 T-CI-11 to 14, T-EV-5). Run: python3 -m pytest scripts/tests"""
from __future__ import annotations
import json, pathlib, sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
import check_eval_result  # noqa: E402
from test_eval_runner import SKILL_MD, git, make_repo, run, run_files  # noqa: E402

W33 = ("Skill change with no passing eval for natspec. Run scripts/run_eval.py natspec, commit "
       'evals/natspec/runs/<run>.json, and add "Eval: <that path>" to the PR description (OPS-A4-48).')
TREE = "abc1234def5678abc1234def5678abc1234def56"
RUN = "evals/natspec/runs/20261002T050311Z.json"
SKILL_CHANGE = [".claude/skills/natspec/SKILL.md"]
TEMPLATE = ("Umbrella: END-\n\nWhat this PR does (one thing):\n\nHarness change? Rule ID it puts in force:\n"
            "Skill change? Eval: evals/<skill>/runs/<run>.json\n")


def run_file(**over):
    return json.dumps({"skill": "natspec", "skill_sha": TREE, "pass": True, **over})


def at(files):
    return lambda path: files.get(path)


def tree(path):
    return TREE if path == ".claude/skills/natspec" else None


def test_t_ci_11_skill_change_with_no_run_file():
    """T-CI-11 · a skill change with no Eval: line and no run file fails with the W-33 text, character for character."""
    problems = check_eval_result.check(SKILL_CHANGE, "CODE-NAT-02", at({}), tree)
    assert problems == [(W33, 'no "Eval: evals/natspec/runs/<run>.json" line in the PR description')]
    assert check_eval_result.check(SKILL_CHANGE, TEMPLATE + "CODE-NAT-02", at({}), tree) == problems  # placeholder never counts
    assert check_eval_result.check(["src/FeeModel.sol", "evals/natspec/rubric.md"], "", at({}), tree) == []
    assert check_eval_result.check([".claude/skills/gone/SKILL.md"], "", at({}), tree) == []  # folder deleted at head
    assert check_eval_result.check(SKILL_CHANGE, f"Eval: {RUN}", at({}), tree) == [
        (W33, f"{RUN} is not committed on this branch")]
    assert check_eval_result.check(SKILL_CHANGE, f"Eval: {RUN}", at({RUN: "Score: great"}), tree) == [
        (W33, f"{RUN} is not a run file (not JSON, or no skill, skill_sha or pass)")]
    assert check_eval_result.check(SKILL_CHANGE, f"Eval: {RUN}", at({RUN: run_file(skill="entry")}), tree) == [
        (W33, f"{RUN} is a run of the skill entry")]


def test_t_ci_12_run_file_with_pass_false():
    """T-CI-12 · the Eval: line names a run file with pass false and the matching skill_sha: fail."""
    problems = check_eval_result.check(SKILL_CHANGE, f"CODE-NAT-02\nEval: {RUN}", at({RUN: run_file(**{"pass": False})}), tree)
    assert problems == [(W33, f"{RUN} has pass false")]


def test_t_ci_13_run_file_on_another_skill_sha():
    """T-CI-13 · a passing run file whose skill_sha isn't the skill folder in the PR: fail."""
    problems = check_eval_result.check(SKILL_CHANGE, f"Eval: {RUN}", at({RUN: run_file(skill_sha="0ld5678" + "0" * 33)}), tree)
    assert problems == [(W33, f"{RUN} was run on skill_sha 0ld5678; .claude/skills/natspec/ in this PR is abc1234")]


def test_t_ci_14_matching_passing_run_file():
    """T-CI-14 · pass true, the matching skill_sha, skill natspec and the Eval: line: no problem."""
    body = f"Umbrella: END-12\n\nSkill change? Eval: {RUN}\nCODE-NAT-02"
    assert check_eval_result.check(SKILL_CHANGE, body, at({RUN: run_file()}), tree) == []
    stale = "evals/natspec/runs/20261001T000000Z.json"
    body = f"Eval: {stale}\nEval: {RUN}"  # a later line may carry the passing run
    assert check_eval_result.check(SKILL_CHANGE, body, at({RUN: run_file(), stale: run_file(**{"pass": False})}), tree) == []


def test_t_ev_5_wall_reads_a_real_run_file(tmp_path, monkeypatch, capsys):
    """T-EV-5 · in a git repo: the skill and run_eval.py's run file committed on a branch; main passes with the Eval: line, fails without."""
    repo = make_repo(tmp_path, skill=False)
    base = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-qb", "henrychoi/end-12-natspec-skill")
    (repo / ".claude" / "skills" / "natspec").mkdir(parents=True)
    (repo / ".claude" / "skills" / "natspec" / "SKILL.md").write_text(SKILL_MD)
    git(repo, "add", ".claude/skills/natspec")
    git(repo, "commit", "-qm", "natspec skill")
    assert run(tmp_path, repo, "natspec").returncode == 0
    rel = run_files(repo)[0].relative_to(repo).as_posix()
    git(repo, "add", rel)
    git(repo, "commit", "-qm", "natspec eval run")
    head = git(repo, "rev-parse", "HEAD")
    event = tmp_path / "event.json"
    monkeypatch.chdir(repo)
    monkeypatch.setenv("GITHUB_EVENT_PATH", str(event))

    event.write_text(json.dumps({"pull_request": {"body": f"Umbrella: END-12\n\nCODE-NAT-02\nSkill change? Eval: {rel}\n"}}))
    assert check_eval_result.main([base, head]) == 0
    assert capsys.readouterr().out == "No skill change, or each changed skill has its passing eval.\n"

    event.write_text(json.dumps({"pull_request": {"body": "Umbrella: END-12\n\nCODE-NAT-02\n" + TEMPLATE}}))
    assert check_eval_result.main([base, head]) == 1
    assert capsys.readouterr().out.splitlines() == [
        W33, f"::error title=Wall: eval result::{W33}",
        'Reason: no "Eval: evals/natspec/runs/<run>.json" line in the PR description']
