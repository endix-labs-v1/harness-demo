---
name: hand-off
description: Use when a step needs a write in Notion or Linear. Entry agents never write there; this hands the write to the doc manager or the task manager with endix-entry-slack's hand_off in the umbrella's thread and waits for the link back. Carries OPS-F0-38, OPS-A4-02.
---

# Hand-off: the managers write the records

Carries: OPS-F0-38, OPS-A4-02 (Operations · Rules · F0 and A4 in Notion; those pages win over this file).

## Who writes where

| The write | Goes to |
| -- | -- |
| A Notion page, a section edit, a change log line, a Lightmap field | the doc manager |
| A Linear step, a status, a comment line, a done-when link, a closing | the task manager |

## Steps

1. **Prepare the content** where you work: the draft in the thread, the diff, or the link to it.
2. **Call `hand_off`** (endix-entry-slack) once, in the umbrella's thread: `permalink` (the thread), `manager` (`doc` or `task`), `step_id` (the full ID, like `OPS-F1-13`), `what` (what to write), `where` (the page or issue, with its link). It posts `<@Doc manager> {step} · {what} · {where}` or `<@Task manager> {step} · {what} · {where}` (DICT §2), for example `<@Doc manager> OPS-F1-13 · apply the draft above to Fee model · <page link>`.
3. **Wait for the reply with the link** (`read_thread`). Put that link in your output for the step.
4. **A refusal** (the manager replies `Refused: …`): tell the person who asked what it names, and hand off again only after that is fixed (for a Current page, after its Owner's OK in the thread).
5. **No reply in 30 minutes:** call `hand_off` once more in the same thread.

## Never

- Write in Notion or Linear yourself, even if a connector lets you. The H1 hook refuses it.
- Post in Slack through any tool but endix-entry-slack. The H1 hook refuses it.
- Post a person's line for them ("go", "OK", "Answer:", "Done:" on a to-do). endix-entry-slack refuses it (W-12).

## Eval

`evals/hand-off/`: cases E-HO-1 (a Notion write) and E-HO-2 (a Linear write): one `hand_off` each, with the step ID, what and where, and no Notion or Linear call (TEST §2.3 E-HO), on both models, each judged by the other. Run with `python3 scripts/run_eval.py hand-off`; runs in `evals/hand-off/runs/`.
