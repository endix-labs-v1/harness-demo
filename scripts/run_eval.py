#!/usr/bin/env python3
"""C8 · the eval runner: a skill's eval on two models, each judged by the other (OPS-A4-48, OPS-A4-07).

An eval set is evals/<skill>/rubric.md (a criteria table and a Threshold line) and
evals/<skill>/cases.json (the cases). Each case runs on both models of model.eval_runner,
in a folder holding only the committed skill and the case's files; each answer is judged
by the other model (model.eval_judge "cross", SYS §3). The run is written to
evals/<skill>/runs/<UTC time>.json, which W-33 (scripts/check_eval_result.py) reads.
Claude plan login only (SEC §4): refuses ANTHROPIC_API_KEY and passes none to claude.
Usage: run_eval.py <skill> [--dry] [--jobs N] [--keep] [--repo PATH] [--runs-dir PATH]
Exit: 0 the run passed, 1 it finished and didn't pass, 2 it couldn't run.
"""
from __future__ import annotations
import argparse, concurrent.futures, datetime, io, json, os, re, shlex, shutil, subprocess, sys, tarfile, time
from pathlib import Path

CRITERION = re.compile(r"^\|\s*`([a-z_]+)`\s*\|", re.M)
THRESHOLD = re.compile(r"^Threshold:\s*([0-9]*\.?[0-9]+)\s*$", re.M)
FENCED = re.compile(r"^```[^\n]*\n(.*?)\n?```$", re.S)
CASE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
DEFAULT_CONFIG = "~/github/endix-demo-kit/config/demo.config.json"
DEFAULT_RUNS = "~/.endix-demo/runs"
TIMEOUT = 300
DROP_ENV = ("ANTHROPIC_API_KEY", "CLAUDECODE")
NO_MCP = '{"mcpServers": {}}'

W21 = "Refused to start (W-21, SEC §4): ANTHROPIC_API_KEY is set. The demo runs on the Claude plan login only."


class CannotRun(Exception):
    """One stderr line, exit 2."""


def model_argv(claude: list[str], model: str) -> list[str]:
    return [*claude, "-p", "--model", model,
            "--output-format", "stream-json", "--verbose",
            "--setting-sources", "project",
            "--strict-mcp-config", "--mcp-config", NO_MCP,
            "--allowedTools", "Read,Glob,Grep,Skill",
            "--disallowedTools", "Bash,Write,Edit,MultiEdit,NotebookEdit,WebFetch,WebSearch,Task,TodoWrite",
            "--max-turns", "8"]


def judge_argv(claude: list[str], judge: str) -> list[str]:
    return [*claude, "-p", "--model", judge,
            "--output-format", "stream-json", "--verbose",
            "--setting-sources", "project",
            "--strict-mcp-config", "--mcp-config", NO_MCP,
            "--disallowedTools", "Bash,Read,Glob,Grep,Skill,Write,Edit,MultiEdit,NotebookEdit,WebFetch,WebSearch,Task,TodoWrite",
            "--max-turns", "2"]


def one_line_less(text: str) -> str:
    """A file's text as it sits inside a block: word for word, without its final newline."""
    return text[:-1] if text.endswith("\n") else text


def parse_rubric(text: str) -> tuple[list[str], float] | None:
    criteria = CRITERION.findall(text)
    threshold = THRESHOLD.search(text)
    if not criteria or not threshold:
        return None
    return criteria, float(threshold.group(1))


def case_list_problem(data: object, skill: str, set_dir: Path) -> str | None:
    """What is wrong with cases.json, or None (T11 Spec Req 10)."""
    if not isinstance(data, dict):
        return "not a JSON object"
    if data.get("skill") != skill:
        return f'skill is not "{skill}"'
    cases = data.get("cases")
    if not isinstance(cases, list) or not cases:
        return "cases is not a non-empty list"
    seen = set()
    root = set_dir.resolve()
    for n, case in enumerate(cases, 1):
        if not isinstance(case, dict):
            return f"case {n} is not an object"
        cid = case.get("id")
        if not isinstance(cid, str) or not CASE_ID.match(cid):
            return f"case {n} has no id made of letters, digits, '.', '_' or '-'"
        if cid in seen:
            return f"case id {cid} is not unique"
        seen.add(cid)
        files = case.get("files")
        if not isinstance(files, dict):
            return f"case {cid}: files is not an object"
        for target, source in files.items():
            parts = Path(target).parts
            if not target or Path(target).is_absolute() or ".." in parts:
                return f"case {cid}: file path {target} is not a plain relative path"
            if not isinstance(source, str):
                return f"case {cid}: the source of {target} is not a string"
            src = (set_dir / source).resolve()
            if root not in src.parents or not src.is_file():
                return f"case {cid}: no file evals/{skill}/{source}"
        for key in ("function", "prompt", "expect"):
            if not isinstance(case.get(key), str):
                return f"case {cid}: {key} is not a string"
    return None


def load_config(path: Path) -> tuple[list[str], dict[str, str]]:
    if not path.is_file():
        raise CannotRun(f"No config at {path} (DEMO_CONFIG).")
    needs = 'Config needs model.eval_runner with two different models and model.eval_judge "cross" (SYS §3).'
    try:
        model = json.loads(path.read_text()).get("model") or {}
    except (ValueError, AttributeError):
        raise CannotRun(needs)
    runner = model.get("eval_runner") if isinstance(model, dict) else None
    judge = model.get("eval_judge") if isinstance(model, dict) else None
    if (not isinstance(runner, list) or len(runner) != 2 or not all(isinstance(m, str) and m for m in runner)
            or runner[0] == runner[1] or judge != "cross"):
        raise CannotRun(needs)
    return runner, {runner[0]: runner[1], runner[1]: runner[0]}


def load_set(repo: Path, skill: str) -> tuple[str, list[str], float, list[dict]]:
    set_dir = repo / "evals" / skill
    rubric_path, cases_path = set_dir / "rubric.md", set_dir / "cases.json"
    if not CASE_ID.match(skill) or not rubric_path.is_file() or not cases_path.is_file():
        raise CannotRun(f"No eval set at evals/{skill}/ (rubric.md and cases.json).")
    rubric = rubric_path.read_text()
    parsed = parse_rubric(rubric)
    if parsed is None:
        raise CannotRun(f"evals/{skill}/rubric.md has no criteria table or no Threshold line.")
    try:
        data = json.loads(cases_path.read_text())
    except ValueError:
        raise CannotRun(f"evals/{skill}/cases.json is not a case list: not JSON.")
    wrong = case_list_problem(data, skill, set_dir)
    if wrong:
        raise CannotRun(f"evals/{skill}/cases.json is not a case list: {wrong}.")
    return rubric, parsed[0], parsed[1], data["cases"]


def git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True)


def case_line(case: dict) -> str:
    files = ", ".join(case["files"]) or "no file"
    return f"{case['id']} · {files} · {case['function']}"


def judged_line(models: list[str], judged_by: dict[str, str]) -> str:
    return "Judged by the other model: " + ", ".join(f"{m} by {judged_by[m]}" for m in models) + "."


def child_env() -> dict[str, str]:
    return {k: v for k, v in os.environ.items() if k not in DROP_ENV}


def call_claude(argv: list[str], cwd: Path, prompt: str, skill: str) -> tuple[str | None, bool, str | None]:
    """Runs one claude -p; returns (reply, skill_loaded, error) (T11 Spec Req 15)."""
    try:
        done = subprocess.run(argv, cwd=str(cwd), input=prompt, capture_output=True, text=True,
                              env=child_env(), timeout=TIMEOUT)
    except subprocess.TimeoutExpired:
        return None, False, "timeout"
    reply, loaded = None, False
    for line in done.stdout.splitlines():
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if not isinstance(obj, dict):
            continue
        if obj.get("type") == "result":
            reply = obj.get("result") if isinstance(obj.get("result"), str) else None
        elif obj.get("type") == "assistant":
            content = (obj.get("message") or {}).get("content") if isinstance(obj.get("message"), dict) else None
            for part in content if isinstance(content, list) else []:
                if (isinstance(part, dict) and part.get("type") == "tool_use" and part.get("name") == "Skill"
                        and isinstance(part.get("input"), dict)
                        and any(isinstance(v, str) and skill in v for v in part["input"].values())):
                    loaded = True
    if done.returncode != 0:
        return reply, loaded, f"claude exited {done.returncode}"
    if reply is None:
        return None, loaded, "no result"
    return reply, loaded, None


def judge_prompt(skill: str, rubric: str, case: dict, set_dir: Path, answer: str) -> str:
    lines = [f'You are the judge in the eval of the skill "{skill}". Score the answer below against the rubric. Use no tool.',
             "",
             "Reply with one JSON object and nothing else, in this shape:",
             '{"criteria": {"<criterion>": <0, 1 or 2>}, "reasons": "<two sentences at most>"}',
             'Give one value for each criterion in the rubric\'s table, and no other key in "criteria".',
             "",
             "----- rubric -----",
             one_line_less(rubric),
             f"----- case {case['id']}: the prompt the model was given -----",
             case["prompt"]]
    for path, source in case["files"].items():
        lines += [f"----- file {path}, as the model was given it -----",
                  one_line_less((set_dir / source).read_text())]
    lines += ["----- what a correct answer says -----",
              case["expect"],
              "----- the answer -----",
              answer,
              "----- end -----"]
    return "\n".join(lines) + "\n"


def read_verdict(reply: str, criteria: list[str]) -> tuple[dict | None, str, str | None]:
    """(criteria scores, reasons, error) from the judge's reply (T11 Spec Req 16)."""
    text = reply.strip()
    fenced = FENCED.match(text)
    if fenced:
        text = fenced.group(1).strip()
    try:
        obj = json.loads(text)
    except ValueError:
        return None, "", "judge reply malformed: not JSON"
    if not isinstance(obj, dict):
        return None, "", "judge reply malformed: not JSON"
    scores = obj.get("criteria")
    if not isinstance(scores, dict) or set(scores) != set(criteria):
        return None, "", "judge reply malformed: criteria keys differ"
    if any(type(scores[c]) is not int or scores[c] not in (0, 1, 2) for c in criteria):
        return None, "", "judge reply malformed: value out of range"
    reasons = obj.get("reasons") if isinstance(obj.get("reasons"), str) else ""
    return {c: scores[c] for c in criteria}, reasons, None


def extract_skill(archive: bytes, folder: Path) -> None:
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        if hasattr(tarfile, "data_filter"):
            tar.extractall(str(folder), filter="data")
        else:
            tar.extractall(str(folder))


def run_case(ctx: dict, model: str, case: dict) -> dict:
    """The model's answer in its own folder, then the other model's verdict on it."""
    folder = ctx["run_dir"] / model / case["id"]
    folder.mkdir(parents=True)
    extract_skill(ctx["archive"], folder)
    for path, source in case["files"].items():
        (folder / path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ctx["set_dir"] / source, folder / path)
    answer, loaded, error = call_claude(model_argv(ctx["claude"], model), folder, case["prompt"], ctx["skill"])
    result = {"score": 0.0, "criteria": None, "reasons": "", "skill_loaded": loaded, "answer": answer, "error": error}
    if error:
        return result
    judge = ctx["judged_by"][model]
    prompt = judge_prompt(ctx["skill"], ctx["rubric"], case, ctx["set_dir"], answer)
    verdict, _, error = call_claude(judge_argv(ctx["claude"], judge), ctx["run_dir"] / f"judge-{model}", prompt, ctx["skill"])
    if error:
        result["error"] = error
        return result
    scores, reasons, error = read_verdict(verdict, ctx["criteria"])
    if error:
        result["error"] = error
        return result
    result.update(score=round(sum(scores.values()) / (2 * len(ctx["criteria"])), 4), criteria=scores, reasons=reasons)
    return result


def utc(moment: datetime.datetime, fmt: str) -> str:
    return moment.astimezone(datetime.timezone.utc).strftime(fmt)


def find_repo(given: str | None) -> Path:
    if given:
        return Path(given).expanduser().resolve()
    top = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    if top.returncode != 0:
        raise CannotRun("Not inside a git repo: run it in harness-demo or pass --repo.")
    return Path(top.stdout.strip())


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="run_eval.py", description="Run a skill's eval on the Claude plan login.")
    ap.add_argument("skill")
    ap.add_argument("--dry", action="store_true", help="check the set and list it; run nothing, write nothing")
    ap.add_argument("--jobs", type=int, default=4, help="claude processes at a time (default 4)")
    ap.add_argument("--keep", action="store_true", help="keep the run folder under --runs-dir")
    ap.add_argument("--repo", help="the repo (default: git rev-parse --show-toplevel)")
    ap.add_argument("--runs-dir", default=DEFAULT_RUNS, help=f"where run folders go (default {DEFAULT_RUNS})")
    args = ap.parse_args(argv)
    if args.jobs < 1:
        ap.error("--jobs must be 1 or more")
    try:
        return run(args)
    except CannotRun as e:
        print(str(e), file=sys.stderr)
        return 2
    except (OSError, tarfile.TarError, subprocess.SubprocessError) as e:  # exit 1 means "ran and failed"
        print(f"Eval could not run: {type(e).__name__}: {e}", file=sys.stderr)
        return 2


def run(args: argparse.Namespace) -> int:
    skill = args.skill
    if "ANTHROPIC_API_KEY" in os.environ:
        raise CannotRun(W21)
    models, judged_by = load_config(Path(os.environ.get("DEMO_CONFIG") or DEFAULT_CONFIG).expanduser())
    repo = find_repo(args.repo)
    rubric, criteria, threshold, cases = load_set(repo, skill)
    set_dir = repo / "evals" / skill

    if args.dry:
        print(f"Eval {skill} (dry run) · models {', '.join(models)} · threshold {threshold:.2f}")
        print(judged_line(models, judged_by))
        print(f"Rubric: evals/{skill}/rubric.md")
        print(one_line_less(rubric))
        print(f"Cases ({len(cases)}):")
        for case in cases:
            print(case_line(case))
        print("Nothing run, nothing written.")
        return 0

    skill_path = f".claude/skills/{skill}"
    if not (repo / skill_path).is_dir():
        raise CannotRun(f"No skill folder {skill_path}/ yet: nothing to evaluate.")
    dirty = git(repo, "status", "--porcelain", "--", f"{skill_path}/")
    sha = git(repo, "rev-parse", f"HEAD:{skill_path}")
    if dirty.returncode != 0 or dirty.stdout.strip() or sha.returncode != 0:
        raise CannotRun(f"{skill_path}/ has uncommitted changes. Commit it first: the run is tied to its git tree hash.")
    skill_sha = sha.stdout.decode().strip()
    claude = shlex.split(os.environ.get("ENDIX_CLAUDE") or "claude")
    if not claude or shutil.which(claude[0]) is None:
        raise CannotRun("claude not found (ENDIX_CLAUDE or PATH).")
    archive = git(repo, "archive", "--format=tar", "HEAD", skill_path)
    if archive.returncode != 0:
        raise CannotRun(f"git archive of {skill_path} failed: {archive.stderr.decode().strip()}")

    runs_dir = Path(args.runs_dir).expanduser()
    out_dir = set_dir / "runs"
    while True:  # one stamp names both the run folder and the run file; never reuse one
        started = datetime.datetime.now(datetime.timezone.utc)
        stamp = utc(started, "%Y%m%dT%H%M%SZ")
        run_dir = runs_dir / f"eval-{skill}-{stamp}"
        if not run_dir.exists() and not (out_dir / f"{stamp}.json").exists():
            break
        time.sleep(1.05 - started.microsecond / 1e6)
    run_file = out_dir / f"{stamp}.json"
    rel = f"evals/{skill}/runs/{stamp}.json"

    print(f"Eval {skill} · skill_sha {skill_sha[:7]} · models {', '.join(models)} · threshold {threshold:.2f}", flush=True)
    print(judged_line(models, judged_by), flush=True)

    run_dir.mkdir(parents=True)
    try:
        for model in models:
            (run_dir / f"judge-{model}").mkdir()
        ctx = {"skill": skill, "rubric": rubric, "criteria": criteria, "set_dir": set_dir, "run_dir": run_dir,
               "archive": archive.stdout, "claude": claude, "judged_by": judged_by}
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
            futures = {(m, c["id"]): pool.submit(run_case, ctx, m, c) for m in models for c in cases}
            results = {key: f.result() for key, f in futures.items()}
    finally:
        if not args.keep:
            shutil.rmtree(run_dir, ignore_errors=True)
    finished = datetime.datetime.now(datetime.timezone.utc)

    scores = {}
    for m in models:
        mean = round(sum(results[(m, c["id"])]["score"] for c in cases) / len(cases), 4)
        scores[m] = {"mean": mean, "cases": {c["id"]: results[(m, c["id"])] for c in cases}}
    passed = all(scores[m]["mean"] >= threshold for m in models)
    record = {
        "skill": skill,
        "skill_sha": skill_sha,
        "models": {"runner": list(models), "judged_by": {m: judged_by[m] for m in models}},
        "cases": [{"id": c["id"], "function": c["function"], "files": list(c["files"])} for c in cases],
        "scores": scores,
        "threshold": threshold,
        "pass": passed,
        "started_at": utc(started, "%Y-%m-%dT%H:%M:%SZ"),
        "finished_at": utc(finished, "%Y-%m-%dT%H:%M:%SZ"),
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    run_file.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    labels = {c["id"]: f"{c['id']} {c['function']}" for c in cases}
    width = max([len(x) for x in labels.values()] + [len("mean")])
    for c in cases:
        cols = []
        for m in models:
            r = results[(m, c["id"])]
            cols.append(f"{m} {r['score']:.2f}{'!' if r['error'] else ''}")
        print(labels[c["id"]].ljust(width) + "   " + "   ".join(cols))
    print("mean".ljust(width) + "   " + "   ".join(f"{m} {scores[m]['mean']:.2f}" for m in models))
    loaded = sum(1 for r in results.values() if r["skill_loaded"])
    print(f"skill loaded in {loaded} of {len(results)} runs")
    for c in cases:
        for m in models:
            r = results[(m, c["id"])]
            if r["error"]:
                print(f"! {c['id']} {m}: {r['error']}")
    print(f"{'PASS' if passed else 'FAIL'} · {rel}")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
