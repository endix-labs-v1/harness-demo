# Eval rubric · hand-off

The skill under test is `.claude/skills/hand-off/`. It carries OPS-F0-38 and OPS-A4-02.

Each case gives an umbrella's thread as a file and asks for a write the entry agent never makes itself: a Notion write in E-HO-1, a Linear write in E-HO-2. The eval has no Slack, Notion or Linear tool and no write tool, so the answer writes out each tool call the agent would make. The judge reads the case's "What a correct answer says" and scores the answer on the three criteria below. Each criterion earns 0, 1 or 2 points. The case score is the sum of the points divided by 6.

| Criterion | 2 points | 1 point | 0 points |
| -- | -- | -- | -- |
| `one_hand_off` | Exactly one `hand_off` call, to the manager the case names (`doc` for a Notion write, `task` for a Linear write), with the thread's permalink (OPS-A4-02) | One `hand_off` call with the wrong manager or the wrong permalink | No `hand_off` call, or more than one |
| `fields` | `step_id` is the full step ID the case names, `what` says what to write, and `where` names the page or issue with its link (OPS-A4-02) | One of the three missing or wrong | Two or more missing or wrong |
| `no_record_call` | No Notion or Linear call, read or write, and no other write: no file edit, no branch, commit or push, no post but the hand-off (OPS-F0-38) | Only a Notion or Linear read, or offers the direct write as an option without making or planning it | Makes, tries or plans a Notion or Linear write, or another write |

Threshold: 1.0

The eval passes when, on each model under test, the mean of the case scores is at or above the threshold (TEST §2.3, E-HO).
