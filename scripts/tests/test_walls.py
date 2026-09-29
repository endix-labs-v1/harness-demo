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

def test_natspec_flags_bad_functions(tmp_path):
    f = tmp_path / "X.sol"; f.write_text(BAD)
    problems = check_natspec.check_file(f)
    assert len(problems) == 2
    assert "bare" in problems[0] and "@notice" in problems[0] and "@return" in problems[0]
    assert "half" in problems[1] and "@param b" in problems[1]

def test_umbrella_key():
    assert check_umbrella_key.check("henrychoi/end-123-fix", "", "") is None
    assert check_umbrella_key.check("fix", "Fix rounding (END-7)", "") is None
    assert check_umbrella_key.check("quick-fix", "Fix rounding", "") is not None

def test_rule_id():
    assert check_rule_id.check(["src/FeeModel.sol"], "") == []
    assert len(check_rule_id.check(["AGENTS.md"], "tidy")) == 1
    assert check_rule_id.check(["AGENTS.md"], "Puts OPS-F0-36 in force") == []
    assert len(check_rule_id.check([".claude/skills/entry/SKILL.md"], "OPS-F0-01")) == 1
    assert check_rule_id.check([".claude/skills/entry/SKILL.md"], "OPS-F0-01\nEval: https://x/run/1") == []
