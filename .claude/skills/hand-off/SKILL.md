---
name: hand-off
description: Use when a step needs a write in Notion or Linear. Entry agents never write there; this posts the write to the doc manager or the task manager in the umbrella's thread and waits for the link back. Carries OPS-F0-38, OPS-A4-02.
---

# Hand-off: the managers write the records

Carries: OPS-F0-38, OPS-A4-02 (Operations · Rules · F0 and A4 in Notion; those pages win over this file).

## Who writes where

| The write | Goes to |
| -- | -- |
| A Notion page, a section edit, a change log line, a Lightmap field | the doc manager |
| A Linear step, a status, a comment line, a done-when link, a closing | the task manager |

## Steps

1. **Prepare the content** where you work: the draft text, the diff, or the link to it.
2. **Post one message in the umbrella's thread**, mentioning the manager:
   `@doc-manager F1-04 · write <draft link> to <page name>`
   `@task-manager F2-10 · close <step key> with "Done: #<GitHub Issue> closed · PRs <links>"`
   Always: the step ID, what to write, and where.
3. **Wait for the reply with the link.** Put that link in your output for the step.
4. **No reply in 30 minutes:** mention the manager once more in the same thread.

## Never

- Write in Notion or Linear yourself, even if a connector lets you. The H1 hook refuses it.
- Post a person's line for them ("go", "OK", "Answer:", "Done:" on a to-do).

## Eval

Given a step that needs a Notion write, the agent posts exactly one hand-off message with the step ID, content and place, and makes no Notion call. Rubric and runs: `evals/hand-off/` (to add, OPS-A4-48).
