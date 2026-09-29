#!/usr/bin/env python3
"""The fake claude of the eval tests (T11 Spec Req 31): no test starts the real claude.

Not a test file: it holds no test, and pytest only imports it. The tests run it as
ENDIX_CLAUDE="<python> <this file>". It logs each call to FAKE_CLAUDE_LOG, answers a judge
call by FAKE_JUDGE (good, bad or bad:<case id>), and answers any other call as the model.
"""
from __future__ import annotations
import json, os, re, sys

CRITERION = re.compile(r"^\|\s*`([a-z_]+)`\s*\|", re.M)
JUDGE_HEAD = "You are the judge in the eval of the skill"


def files_under(folder: str) -> list[str]:
    return sorted(os.path.relpath(os.path.join(d, f), folder) for d, _, names in os.walk(folder) for f in names)


def result(text: str) -> str:
    return json.dumps({"type": "result", "subtype": "success", "is_error": False, "result": text})


def main(argv: list[str]) -> int:
    stdin = sys.stdin.read()
    cwd = os.getcwd()
    log = os.environ.get("FAKE_CLAUDE_LOG")
    if log:
        with open(log, "a") as f:
            f.write(json.dumps({"argv": argv, "cwd": cwd, "files": files_under(cwd), "stdin": stdin,
                                "api_key": "ANTHROPIC_API_KEY" in os.environ,
                                "claudecode": "CLAUDECODE" in os.environ}) + "\n")
    model = argv[argv.index("--model") + 1] if "--model" in argv else ""
    if stdin.startswith(JUDGE_HEAD):
        mode = os.environ.get("FAKE_JUDGE", "good")
        if mode == "bad" or (mode.startswith("bad:") and f"----- case {mode[4:]}:" in stdin):
            print(result("Score: great"))
        else:
            rubric = stdin.split("----- rubric -----\n", 1)[-1].split("\n----- case ", 1)[0]
            verdict = {"criteria": {c: 2 for c in CRITERION.findall(rubric)}, "reasons": "Fake judge: all good."}
            print(result(json.dumps(verdict)))
        return 0
    skills = os.path.join(cwd, ".claude", "skills")
    for name in sorted(os.listdir(skills)) if os.path.isdir(skills) else []:
        print(json.dumps({"type": "assistant", "message": {"role": "assistant", "content": [
            {"type": "tool_use", "id": f"toolu_fake_{name}", "name": "Skill", "input": {"skill": name}}]}}))
    print(result(f"Fake answer from {model} for {os.path.basename(cwd)}."))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
