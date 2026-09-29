# harness-demo

A small, real copy of the Endix harness: the walls that keep AI agents on the agreed path, whatever their prompt says.

All you need is trust, and trust comes from walls, not from instructions. AGENTS.md and the skills tell an agent what to do; they are advisors. The hooks, CI and branch protection refuse what breaks a rule; they are walls.

| Wall | Refuses | Where |
| -- | -- | -- |
| H1 hook | an entry agent writing in Notion or Linear | `.claude/hooks/h1_records.py` |
| H2 hook | a push from a branch with no umbrella key, or to main | `.claude/hooks/h2_h3_git.py` |
| H3 hook | an agent approving, posting "go" / "no", or merging a PR no person approved | `.claude/hooks/h2_h3_git.py` |
| CI: umbrella key | a PR that names no Linear umbrella | `scripts/check_umbrella_key.py` |
| CI: NatSpec | a public or external function without NatSpec | `scripts/check_natspec.py` |
| CI: harness rule ID | a harness change that cites no rule, or a skill change with no eval | `scripts/check_rule_id.py` |
| Branch protection | anything reaching main without green CI and a person's approval | GitHub settings |

The advisors: `AGENTS.md`, `CLAUDE.md`, `.claude/skills/entry`, `.claude/skills/hand-off`.

Every file cites the rule it carries (OPS-F0-36 and so on). The rules themselves live on the Operations Rules pages in Notion, and those pages win over any file here.

Run the wall tests: `python3 -m pytest -q scripts/tests .claude/hooks/tests` and `forge test`.
