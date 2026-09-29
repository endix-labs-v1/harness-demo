"""The eval runner (T11, SYS §1 C8, TEST §2.2 T-EV). Run: python3 -m pytest scripts/tests

Every test works in a temporary git repo with a copy of the real evals/natspec/ and a
temporary config; claude is the fake (test_eval_fake_claude.py), never the real one.
"""
from __future__ import annotations
import json, os, pathlib, re, shlex, shutil, subprocess, sys

HERE = pathlib.Path(__file__).resolve().parent
SCRIPTS = HERE.parent
REPO = SCRIPTS.parent
RUN_EVAL = SCRIPTS / "run_eval.py"
FAKE_CLAUDE = HERE / "test_eval_fake_claude.py"
sys.path.insert(0, str(SCRIPTS))
import run_eval  # noqa: E402

MODELS = ["opus", "sonnet"]
OTHER = {"opus": "sonnet", "sonnet": "opus"}
KEYS = ["skill", "skill_sha", "models", "cases", "scores", "threshold", "pass", "started_at", "finished_at"]
CASE_KEYS = ["score", "criteria", "reasons", "skill_loaded", "answer", "error"]
CASE_LINES = ["c1 · src/Portion.sol · portionOf", "c2 · src/Splitter.sol · split", "c3 · src/Vault.sol · convert",
              "c4 · src/Accrual.sol · accrued", "c5 · src/Pricer.sol · quote", "c6 · src/Cut.sol · afterCut"]
CASE_FILES = {"c1": "src/Portion.sol", "c2": "src/Splitter.sol", "c3": "src/Vault.sol",
              "c4": "src/Accrual.sol", "c5": "src/Pricer.sol", "c6": "src/Cut.sol"}
MODEL_ARGV = ["-p", "--model", "<m>", "--output-format", "stream-json", "--verbose", "--setting-sources", "project",
              "--strict-mcp-config", "--mcp-config", '{"mcpServers": {}}', "--allowedTools", "Read,Glob,Grep,Skill",
              "--disallowedTools", "Bash,Write,Edit,MultiEdit,NotebookEdit,WebFetch,WebSearch,Task,TodoWrite",
              "--max-turns", "8"]
JUDGE_ARGV = ["-p", "--model", "<m>", "--output-format", "stream-json", "--verbose", "--setting-sources", "project",
              "--strict-mcp-config", "--mcp-config", '{"mcpServers": {}}', "--disallowedTools",
              "Bash,Read,Glob,Grep,Skill,Write,Edit,MultiEdit,NotebookEdit,WebFetch,WebSearch,Task,TodoWrite",
              "--max-turns", "2"]
NO_SKILL = "No skill folder .claude/skills/natspec/ yet: nothing to evaluate.\n"
DIRTY = ".claude/skills/natspec/ has uncommitted changes. Commit it first: the run is tied to its git tree hash.\n"
NEEDS_CROSS = 'Config needs model.eval_runner with two different models and model.eval_judge "cross" (SYS §3).\n'
W21 = "Refused to start (W-21, SEC §4): ANTHROPIC_API_KEY is set. The demo runs on the Claude plan login only.\n"
SKILL_MD = "---\nname: natspec\ndescription: Test skill for the eval runner.\n---\n\n# natspec\n"


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), "-c", "user.name=test", "-c", "user.email=test@example.invalid",
                           *args], check=True, capture_output=True, text=True).stdout.strip()


def make_repo(tmp_path, skill=True, model=None):
    """A temp repo with the real evals/natspec/, the harness files a model must never see, and a config."""
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-q", "-b", "main")
    shutil.copytree(REPO / "evals" / "natspec", repo / "evals" / "natspec", ignore=shutil.ignore_patterns("runs"))
    (repo / "AGENTS.md").write_text("# Agents\n")
    (repo / "CLAUDE.md").write_text("@AGENTS.md\n")
    (repo / ".mcp.json").write_text('{"mcpServers": {}}\n')
    (repo / ".claude").mkdir()
    (repo / ".claude" / "settings.json").write_text("{}\n")
    if skill:
        (repo / ".claude" / "skills" / "natspec").mkdir(parents=True)
        (repo / ".claude" / "skills" / "natspec" / "SKILL.md").write_text(SKILL_MD)
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "base")
    config = tmp_path / "demo.config.json"
    config.write_text(json.dumps({"model": model or {"bots": "sonnet", "entry_agent": "opus",
                                                     "eval_runner": ["opus", "sonnet"], "eval_judge": "cross"}}))
    return repo


def run(tmp_path, repo, *args, judge="good", env=None):
    e = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY", "FAKE_JUDGE")}
    e.update(DEMO_CONFIG=str(tmp_path / "demo.config.json"), FAKE_JUDGE=judge, CLAUDECODE="1",
             ENDIX_CLAUDE=f"{shlex.quote(sys.executable)} {shlex.quote(str(FAKE_CLAUDE))}",
             FAKE_CLAUDE_LOG=str(tmp_path / "claude.log"))
    e.update(env or {})
    return subprocess.run([sys.executable, str(RUN_EVAL), *args, "--repo", str(repo),
                           "--runs-dir", str(tmp_path / "runs")], capture_output=True, text=True, env=e)


def calls(tmp_path):
    log = tmp_path / "claude.log"
    return [json.loads(x) for x in log.read_text().splitlines()] if log.exists() else []


def run_files(repo, skill="natspec"):
    d = repo / "evals" / skill / "runs"
    return sorted(d.iterdir()) if d.exists() else []


def is_judge(call):
    return call["stdin"].startswith("You are the judge in the eval of the skill")


def argv_for(template, model):
    return [model if x == "<m>" else x for x in template]


def test_t_ev_1_dry_lists_cases_and_rubric(tmp_path):
    """T-EV-1 · --dry on the real evals/natspec/ with no skill folder: the rubric, 6 cases, nothing written."""
    repo = make_repo(tmp_path, skill=False)
    p = run(tmp_path, repo, "natspec", "--dry")
    assert p.returncode == 0, p.stderr
    rubric = (REPO / "evals" / "natspec" / "rubric.md").read_text()
    assert p.stdout == ("Eval natspec (dry run) · models opus, sonnet · threshold 0.80\n"
                        "Judged by the other model: opus by sonnet, sonnet by opus.\n"
                        "Rubric: evals/natspec/rubric.md\n" + rubric + "Cases (6):\n"
                        + "".join(x + "\n" for x in CASE_LINES) + "Nothing run, nothing written.\n")
    assert "Threshold: 0.8" in p.stdout
    assert not (repo / "evals" / "natspec" / "runs").exists()
    assert calls(tmp_path) == [] and not (tmp_path / "runs").exists()


def test_t_ev_2_run_writes_the_run_file(tmp_path):
    """T-EV-2 · a committed skill, FAKE_JUDGE=good: one run file, keys in order, both models, pass, no run folder left."""
    repo = make_repo(tmp_path)
    p = run(tmp_path, repo, "natspec")
    assert p.returncode == 0, p.stderr
    files = run_files(repo)
    assert len(files) == 1 and re.match(r"^\d{8}T\d{6}Z\.json$", files[0].name)
    text = files[0].read_text()
    assert text.endswith("}\n") and text.startswith('{\n  "skill": "natspec",\n')
    data = json.loads(text)
    assert list(data) == KEYS
    assert data["models"] == {"runner": ["opus", "sonnet"], "judged_by": {"opus": "sonnet", "sonnet": "opus"}}
    assert data["cases"][0] == {"id": "c1", "function": "portionOf", "files": ["src/Portion.sol"]}
    assert [c["id"] for c in data["cases"]] == ["c1", "c2", "c3", "c4", "c5", "c6"]
    assert list(data["scores"]) == MODELS
    for m in MODELS:
        assert list(data["scores"][m]) == ["mean", "cases"] and data["scores"][m]["mean"] == 1.0
        assert len(data["scores"][m]["cases"]) == 6
        for cid, r in data["scores"][m]["cases"].items():
            assert list(r) == CASE_KEYS
            assert r["score"] == 1.0 and r["error"] is None and r["skill_loaded"] is True
            assert r["answer"] == f"Fake answer from {m} for {cid}."
    assert data["threshold"] == 0.8 and data["pass"] is True
    assert re.match(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$", data["started_at"])
    assert files[0].name == data["started_at"].replace("-", "").replace(":", "") + ".json"
    assert [d for d in (tmp_path / "runs").iterdir() if d.name.startswith("eval-")] == []
    out = p.stdout.splitlines()
    assert out[0] == f"Eval natspec · skill_sha {data['skill_sha'][:7]} · models opus, sonnet · threshold 0.80"
    assert out[1] == "Judged by the other model: opus by sonnet, sonnet by opus."
    assert out[2] == "c1 portionOf   opus 1.00   sonnet 1.00"
    assert out[3] == "c2 split       opus 1.00   sonnet 1.00"
    assert out[8] == "mean           opus 1.00   sonnet 1.00"
    assert out[9:] == ["skill loaded in 12 of 12 runs", f"PASS · evals/natspec/runs/{files[0].name}"]


def test_t_ev_3_skill_sha_is_the_tree_hash(tmp_path):
    """T-EV-3 · skill_sha is git rev-parse HEAD:.claude/skills/natspec, the committed tree hash."""
    repo = make_repo(tmp_path)
    assert run(tmp_path, repo, "natspec").returncode == 0
    data = json.loads(run_files(repo)[0].read_text())
    assert data["skill_sha"] == git(repo, "rev-parse", "HEAD:.claude/skills/natspec")
    assert len(data["skill_sha"]) == 40


def test_t_ev_4_malformed_judge_reply_fails_the_case(tmp_path):
    """T-EV-4 · a malformed judge reply scores the case 0; the run can still pass; all malformed fails."""
    repo = make_repo(tmp_path)
    p = run(tmp_path, repo, "natspec", judge="bad:c3")
    assert p.returncode == 0, p.stderr
    data = json.loads(run_files(repo)[-1].read_text())
    for m in MODELS:
        s = data["scores"][m]
        assert s["cases"]["c3"]["score"] == 0.0 and s["cases"]["c3"]["criteria"] is None
        assert s["cases"]["c3"]["error"].startswith("judge reply malformed")
        assert all(s["cases"][c]["score"] == 1.0 for c in ["c1", "c2", "c4", "c5", "c6"])
        assert s["mean"] == 0.8333
    assert data["pass"] is True
    assert "c3 convert     opus 0.00!   sonnet 0.00!" in p.stdout.splitlines()
    assert "! c3 opus: judge reply malformed: not JSON" in p.stdout.splitlines()

    p = run(tmp_path, repo, "natspec", judge="bad")
    assert p.returncode == 1, p.stderr
    files = run_files(repo)
    assert len(files) == 2
    data = json.loads(files[-1].read_text())
    assert all(r["score"] == 0.0 for m in MODELS for r in data["scores"][m]["cases"].values())
    assert data["pass"] is False and data["scores"]["opus"]["mean"] == 0.0
    assert p.stdout.splitlines()[-1] == f"FAIL · evals/natspec/runs/{files[-1].name}"


def test_t_ev_6_no_skill_folder(tmp_path):
    """T-EV-6 · no .claude/skills/natspec/ yet: says so, exits 2, writes nothing, never starts claude."""
    repo = make_repo(tmp_path, skill=False)
    p = run(tmp_path, repo, "natspec")
    assert p.returncode == 2 and p.stderr == NO_SKILL and p.stdout == ""
    assert run_files(repo) == [] and calls(tmp_path) == [] and not (tmp_path / "runs").exists()


def test_api_key_refused(tmp_path):
    """No ID · ANTHROPIC_API_KEY set: exit 2 with the W-21 text; claude never started (SEC §4)."""
    repo = make_repo(tmp_path)
    p = run(tmp_path, repo, "natspec", env={"ANTHROPIC_API_KEY": "x"})
    assert p.returncode == 2 and p.stderr == W21
    assert calls(tmp_path) == [] and run_files(repo) == []


def test_dirty_skill_refused(tmp_path):
    """No ID · an uncommitted edit in the skill folder: exit 2, the run must be tied to a committed tree."""
    repo = make_repo(tmp_path)
    (repo / ".claude" / "skills" / "natspec" / "SKILL.md").write_text(SKILL_MD + "\nAn edit.\n")
    p = run(tmp_path, repo, "natspec")
    assert p.returncode == 2 and p.stderr == DIRTY
    git(repo, "checkout", "--", ".claude/skills/natspec")
    (repo / ".claude" / "skills" / "natspec" / "notes.md").write_text("untracked\n")
    p = run(tmp_path, repo, "natspec")
    assert p.returncode == 2 and p.stderr == DIRTY
    assert calls(tmp_path) == [] and run_files(repo) == []


def test_config_needs_cross(tmp_path):
    """No ID · eval_judge not "cross", or one model only: exit 2 with the config message; claude never started."""
    for model in ({"eval_runner": ["opus", "sonnet"], "eval_judge": "opus"},
                  {"eval_runner": ["opus"], "eval_judge": "cross"},
                  {"eval_runner": ["opus", "opus"], "eval_judge": "cross"}):
        repo_tmp = tmp_path / str(len(list(tmp_path.iterdir())))
        repo_tmp.mkdir()
        repo = make_repo(repo_tmp, model=model)
        for extra in ([], ["--dry"]):
            p = run(repo_tmp, repo, "natspec", *extra)
            assert p.returncode == 2 and p.stderr == NEEDS_CROSS
        assert calls(repo_tmp) == []
    p = run(tmp_path, repo, "natspec", env={"DEMO_CONFIG": str(tmp_path / "none.json")})
    assert p.returncode == 2 and p.stderr == f"No config at {tmp_path / 'none.json'} (DEMO_CONFIG).\n"


def test_skill_reaches_model_only_by_folder(tmp_path):
    """No ID · each model call sees only the committed skill and its case file; judges see nothing; no key, no CLAUDECODE."""
    repo = make_repo(tmp_path)
    assert run(tmp_path, repo, "natspec").returncode == 0
    log = calls(tmp_path)
    assert len(log) == 24
    for call in log:
        assert call["api_key"] is False and call["claudecode"] is False
        m = call["argv"][2]
        if is_judge(call):
            assert call["argv"] == argv_for(JUDGE_ARGV, m) and call["files"] == []
        else:
            cid = pathlib.Path(call["cwd"]).name
            assert call["argv"] == argv_for(MODEL_ARGV, m)
            assert call["files"] == sorted([".claude/skills/natspec/SKILL.md", CASE_FILES[cid]])
            case = pathlib.Path(call["cwd"]) / CASE_FILES[cid]
            assert pathlib.Path(call["cwd"]).parent.name == m and not case.exists()  # the folder is gone after the run
            assert call["stdin"] == next(c["prompt"] for c in json.loads(
                (repo / "evals" / "natspec" / "cases.json").read_text())["cases"] if c["id"] == cid)


def test_cross_judge(tmp_path):
    """No ID · 12 model calls and 12 judge calls; each answer is judged by the other model, in judge-<model>/."""
    repo = make_repo(tmp_path)
    assert run(tmp_path, repo, "natspec", "--jobs", "3").returncode == 0
    log = calls(tmp_path)
    answers = [c for c in log if not is_judge(c)]
    judges = [c for c in log if is_judge(c)]
    assert len(answers) == 12 and len(judges) == 12
    assert sorted(c["argv"][2] for c in answers) == ["opus"] * 6 + ["sonnet"] * 6
    seen = set()
    for j in judges:
        found = re.findall(r"Fake answer from (\w+) for (\w+)\.", j["stdin"])
        assert len(found) == 1
        m, cid = found[0]
        assert j["argv"][2] == OTHER[m] and pathlib.Path(j["cwd"]).name == f"judge-{m}"
        assert f"----- case {cid}: the prompt the model was given -----" in j["stdin"]
        assert f"----- file {CASE_FILES[cid]}, as the model was given it -----" in j["stdin"]
        assert (REPO / "evals" / "natspec" / "rubric.md").read_text().rstrip("\n") in j["stdin"]
        seen.add((m, cid))
    assert len(seen) == 12


def test_eval_set_is_neutral():
    """No ID · the real rubric gives five criteria and 0.8; c1 to c6 exist, hold their function, and are neutral (Req 5)."""
    set_dir = REPO / "evals" / "natspec"
    criteria, threshold = run_eval.parse_rubric((set_dir / "rubric.md").read_text())
    assert criteria == ["tags", "units", "rounding", "true_to_code", "code_unchanged"] and threshold == 0.8
    cases = json.loads((set_dir / "cases.json").read_text())["cases"]
    assert [c["id"] for c in cases] == ["c1", "c2", "c3", "c4", "c5", "c6"]
    banned = ("bps", "fee", "round", "percent", "share", "unit", "decimal", "up", "down")
    for c in cases:
        (path, source), = c["files"].items()
        assert path.startswith("src/") and source == f"cases/{c['id']}.sol"
        code = (set_dir / source).read_text()
        assert "FeeModel" not in code and "FeeModel" not in c["prompt"]
        sig = re.search(r"function\s+(\w+)\s*\(([^)]*)\)", code)
        assert sig and sig.group(1) == c["function"]
        names = [sig.group(1)] + [p.split()[-1] for p in sig.group(2).split(",")]
        assert not [n for n in names for b in banned if b in n.lower()], names
        before = code[:sig.start()].rstrip().splitlines()[-1].strip()
        assert not before.startswith(("///", "*", "/**")), f"{c['id']} has NatSpec above {c['function']}"


def test_generic_case_files(tmp_path):
    """No ID · a T10-shaped set: a label with a space, a .md case file and a case with no file run unchanged."""
    repo = make_repo(tmp_path, skill=False)
    (repo / ".claude" / "skills" / "x").mkdir(parents=True)
    (repo / ".claude" / "skills" / "x" / "SKILL.md").write_text("---\nname: x\ndescription: Test.\n---\n")
    xs = repo / "evals" / "x"
    (xs / "cases").mkdir(parents=True)
    (xs / "rubric.md").write_text("# Eval rubric · x\n\n| Criterion | 2 points |\n| -- | -- |\n"
                                  "| `asks` | Asks |\n| `no_write` | Writes nothing |\n| `quotes` | Quotes |\n\n"
                                  "Threshold: 0.75\n")
    (xs / "cases" / "a.md").write_text("# A saved thread\n\nFee launch sync: move it to Friday.\n")
    (xs / "cases.json").write_text(json.dumps({"skill": "x", "cases": [
        {"id": "k1", "files": {"notes/a.md": "cases/a.md"}, "function": "item list",
         "prompt": "Read notes/a.md and write out the call you would make.", "expect": "One post_ask."},
        {"id": "k2", "files": {}, "function": "no key",
         "prompt": "Change the doc. There is no key; write out the call you would make.", "expect": "One post_ask."}]}))
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "skill x")
    p = run(tmp_path, repo, "x", "--dry")
    assert p.returncode == 0, p.stderr
    assert "k1 · notes/a.md · item list\nk2 · no file · no key\n" in p.stdout
    assert "Cases (2):" in p.stdout and "threshold 0.75" in p.stdout
    p = run(tmp_path, repo, "x")
    assert p.returncode == 0, p.stderr
    data = json.loads(run_files(repo, "x")[0].read_text())
    assert data["pass"] is True and data["cases"][1] == {"id": "k2", "function": "no key", "files": []}
    assert data["scores"]["opus"]["cases"]["k1"]["criteria"] == {"asks": 2, "no_write": 2, "quotes": 2}
    judges = {re.search(r"----- case (\w+):", c["stdin"]).group(1): c["stdin"] for c in calls(tmp_path) if is_judge(c)}
    assert "----- file notes/a.md, as the model was given it -----\n# A saved thread\n" in judges["k1"]
    assert "Read notes/a.md and write out the call you would make." in judges["k1"]
    assert "----- file" not in judges["k2"]
    assert "k1 item list   opus 1.00   sonnet 1.00" in p.stdout.splitlines()
