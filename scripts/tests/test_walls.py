"""The CI walls fail what they should. Run: python3 -m pytest scripts/tests"""
import pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import check_natspec, check_rule_id, check_umbrella_key

BAD = '''pragma solidity 0.8.24;
contract X {
    /// @notice Has it.
    /// @param a The a.
    /// @return r The r.
    function good(uint256 a) external pure returns (uint256 r) { r = a; }

    function bare(uint256 amount) external pure returns (uint256) { return amount; }

    /// @notice Missing param doc.
    function half(uint256 b) public pure {}

    function hidden(uint256 c) internal pure {}
}
'''

W30_QUICK_FIX = ("No umbrella key on this PR (branch 'quick-fix'). Name the branch from its Linear "
                 "step, like henrychoi/end-123-short-title (OPS-F0-36). No umbrella yet: the ask "
                 "goes to #lighthouse first (OPS-F0-01).")
W32_AGENTS = ("Harness change with no rule ID (AGENTS.md). Cite the rule this change puts in force, "
              "like OPS-F0-36; with no rule, F9 runs first (OPS-F2-28).")

def test_natspec_flags_bad_functions(tmp_path):
    """T-CI-4, T-CI-5, T-CI-6, T-CI-7 · Missing @notice, @param and @return are flagged; internal functions are not."""
    f = tmp_path / "X.sol"; f.write_text(BAD)
    problems = check_natspec.check_file(f)
    assert len(problems) == 2
    assert "bare" in problems[0] and "@notice" in problems[0] and "@return" in problems[0]
    assert "half" in problems[1] and "@param b" in problems[1]

def test_w31_plain_line(tmp_path, capsys):
    """No ID · main prints the plain W-31 line, with the line of the function's name."""
    f = tmp_path / "X.sol"; f.write_text(BAD)
    assert check_natspec.main([str(f)]) == 1
    lines = capsys.readouterr().out.splitlines()
    assert f"{f}:8: function bare is missing @notice, @param amount, @return" in lines
    assert f"{f}:11: function half is missing @param b" in lines

def test_umbrella_key():
    """T-CI-1 · A key in the branch or the title passes; none fails."""
    assert check_umbrella_key.check("henrychoi/end-123-fix", "", "") is None
    assert check_umbrella_key.check("fix", "Fix rounding (END-7)", "") is None
    assert check_umbrella_key.check("quick-fix", "Fix rounding", "") is not None

def test_t_ci_2_key_only_in_description():
    """T-CI-2 · A key only in the description passes."""
    assert check_umbrella_key.check("quick-fix", "Fix rounding", "Umbrella: END-7") is None

def test_t_ci_3_no_key_w30_text():
    """T-CI-3 · With no key anywhere the check gives the W-30 text, naming the branch."""
    assert check_umbrella_key.check("quick-fix", "Fix rounding", "") == W30_QUICK_FIX

def test_rule_id():
    """T-CI-8, T-CI-9 · A harness change needs a rule ID; other changes don't. A skill change that cites a rule passes W-32; its eval is W-33's."""
    assert check_rule_id.check(["src/FeeModel.sol"], "") == []
    assert len(check_rule_id.check(["AGENTS.md"], "tidy")) == 1
    assert check_rule_id.check(["AGENTS.md"], "Puts OPS-F0-36 in force") == []
    assert check_rule_id.check([".claude/skills/entry/SKILL.md"], "OPS-F0-01") == []
    assert check_rule_id.check([".claude/skills/entry/SKILL.md"], "OPS-F0-01\nEval: https://x/run/1") == []

def test_t_ci_8_w32_text():
    """T-CI-8 · A harness change with no rule ID gives the W-32 text, naming the file."""
    assert check_rule_id.check(["AGENTS.md"], "tidy") == [W32_AGENTS]

def test_t_ci_10_bots_tools_evals_are_harness():
    """T-CI-10 · bots/, tools/ and evals/ are harness paths."""
    for f in ("bots/lighthouse.md", "tools/entry-slack-mcp/src/index.ts", "evals/natspec/rubric.md"):
        assert len(check_rule_id.check([f], "tidy")) == 1, f
        assert check_rule_id.check([f], "Puts OPS-F2-28 in force") == [], f
