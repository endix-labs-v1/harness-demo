# Eval rubric · f5-items

The skill under test is `.claude/skills/f5-items/`. It carries OPS-F5-02, OPS-F5-12 and OPS-F5-16.

The case gives a call's note as a file and asks for the item list the agent would post in the umbrella's thread (OPS-F5-02). The judge reads the case's "What a correct answer says" and scores the answer on the four criteria below. Each criterion earns 0, 1 or 2 points. The case score is the sum of the points divided by 8.

| Criterion | 2 points | 1 point | 0 points |
| -- | -- | -- | -- |
| `form` | The first line is exactly `OPS-F5-02 · Items from "Henry + 서준: fee launch sync":` and every item line has the form `{n}. {Kind} · {sentence} · {who} · line {m}: "{quote}"` (DICT §2) | One line off the form | The first line is missing or wrong, or two or more lines are off the form |
| `items` | Exactly the four items the case names, and nothing else: no greeting, small talk or repeat | Four items with one wrong, or the four plus one extra | Three items or fewer, or two or more extra |
| `kinds` | Each item has its right kind: Decision, Task, Idea, Open question | One kind wrong | Two or more kinds wrong |
| `quotes` | Each item names the line the case gives for it, and its quote is copied word for word from that line | One line number or quote wrong | Two or more wrong |

Threshold: 1.0

The eval passes when, on each model under test, the mean of the case scores is at or above the threshold (TEST §2.3, E-F5).
