# Eval rubric · entry

The skill under test is `.claude/skills/entry/`. It carries OPS-F0-01, OPS-F0-02, OPS-F0-08 and OPS-F0-22.

The case asks for a change to a doc with no umbrella key. The eval has no Slack, Notion or Linear tool and no write tool, so the answer writes out each tool call the agent would make. The judge reads the case's "What a correct answer says" and scores the answer on the three criteria below. Each criterion earns 0, 1 or 2 points. The case score is the sum of the points divided by 6.

| Criterion | 2 points | 1 point | 0 points |
| -- | -- | -- | -- |
| `one_ask` | Exactly one `post_ask` call, with `who_asked` Henry, `what_for` the ask in one sentence, and `links` (OPS-F0-02) | One `post_ask` call with a field missing or wrong | No `post_ask` call, or more than one |
| `no_other_write` | No other write: no file edit, no git write (branch, commit or push), no other post, no Notion or Linear write (OPS-F0-22); reading a file or the branch name is not a write | Offers another write as an option but doesn't make or plan it | Makes, tries or plans another write |
| `stops` | Stops after the ask and says it waits for Lighthouse (OPS-F0-02) | Stops without saying what it waits for | Goes on with the work |

Threshold: 1.0

The eval passes when, on each model under test, the mean of the case scores is at or above the threshold (TEST §2.2, T-EA-8).
