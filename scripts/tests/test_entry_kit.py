"""The entry agent kit's advisors cite their rules (T-EA-5, T-EA-6) and the stage
settings load the entry-slack server on Opus. Run: python3 -m pytest -q scripts/tests/test_entry_kit.py"""
from __future__ import annotations
import json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parents[2]

# The rule IDs WALL §3 gives each skill (A-02, A-03, A-04).
SKILLS = {
    "entry": ["OPS-F0-01", "OPS-F0-02", "OPS-F0-08", "OPS-F0-22"],
    "hand-off": ["OPS-F0-38", "OPS-A4-02"],
    "f5-items": ["OPS-F5-02", "OPS-F5-12", "OPS-F5-16"],
}
CASE_IDS = {"entry": ["T-EA-8"], "hand-off": ["E-HO-1", "E-HO-2"], "f5-items": ["E-F5"]}

# T11 Spec Req 2 (rubric patterns), as scripts/run_eval.py reads them.
CRITERION = re.compile(r"^\|\s*`([a-z_]+)`\s*\|", re.M)
THRESHOLD = re.compile(r"^Threshold:\s*([0-9]*\.?[0-9]+)\s*$", re.M)
RULE_ID = re.compile(r"\b(OPS|CODE|PROD|BD|GTM|RES|CO)-[A-Z0-9]+-\d+\b")
SEPARATOR = re.compile(r"^\|\s*--")


def frontmatter(text: str) -> tuple[dict[str, str], str]:
    assert text.startswith("---\n"), "SKILL.md must start with ---"
    head, _, body = text[4:].partition("\n---\n")
    fields = {}
    for line in head.splitlines():
        key, sep, value = line.partition(":")
        assert sep, f"frontmatter line without a key: {line!r}"
        fields[key.strip()] = value.strip()
    return fields, body


def test_T_EA_5_skills_cite_their_rules_and_name_their_evals():
    for name, rules in SKILLS.items():
        text = (ROOT / ".claude" / "skills" / name / "SKILL.md").read_text()
        fields, body = frontmatter(text)
        assert sorted(fields) == ["description", "name"], name
        assert fields["name"] == name
        desc = fields["description"]
        assert 1 <= len(desc) <= 1024 and "\n" not in desc and "Carries" in desc, name
        carries = next((l for l in body.splitlines() if l.startswith("Carries:")), "")
        missing = [r for r in rules if r not in carries]
        assert not missing, f"{name}: Carries line lacks {missing}"
        assert "## Eval" in body and f"evals/{name}/" in body.split("## Eval", 1)[1], name

        evals = ROOT / "evals" / name
        rubric = (evals / "rubric.md").read_text()
        assert CRITERION.search(rubric) and THRESHOLD.search(rubric), f"{name}: rubric needs a criteria table and a Threshold line"
        cases = json.loads((evals / "cases.json").read_text())
        assert cases["skill"] == name
        assert [c["id"] for c in cases["cases"]] == CASE_IDS[name]
        for case in cases["cases"]:
            for source in case["files"].values():
                assert (evals / source).is_file(), f"{name}/{case['id']}: missing {source}"


def test_T_EA_6_every_agents_md_line_cites_a_rule():
    lines = (ROOT / "AGENTS.md").read_text().splitlines()
    bad = []
    for i, line in enumerate(lines):
        s = line.strip()
        if not s or s.startswith("#") or SEPARATOR.match(s):
            continue
        if i + 1 < len(lines) and SEPARATOR.match(lines[i + 1].strip()):
            continue  # a table header row
        if not RULE_ID.search(line):
            bad.append(f"line {i + 1}: {line}")
    assert not bad, "AGENTS.md lines with no rule ID (OPS-A4-34):\n" + "\n".join(bad)


def test_settings_model_and_servers():
    s = json.loads((ROOT / ".claude" / "settings.json").read_text())
    assert isinstance(s.get("model"), str) and s["model"]
    assert s.get("enabledMcpjsonServers") == ["endix-entry-slack"]
    assert sorted(s) == ["enabledMcpjsonServers", "hooks", "model"]
