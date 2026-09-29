---
name: f5-items
description: Use when your step is OPS-F5-02 on an F5.1 umbrella: a call was recorded in Granola and its items go in the umbrella's thread. Reads the note through the Granola connector, posts one line per item (kind, one sentence, who, the line it came from), and waits for a person's OK. Carries OPS-F5-02, 12, 16.
---

# F5 items: what the call held, one line each

Carries: OPS-F5-02, OPS-F5-12, OPS-F5-16 (Operations · Rules · F5 in Notion; that page wins over this file).

## Steps

1. **Check the step.** Run the `entry` skill first: the umbrella is F5.1 and its lightmap gives you OPS-F5-02. No key: `entry` posts the ask and you stop.
2. **Read the note.** Read the umbrella's thread with `read_thread`; its first message links the Granola note. Read that note through the Granola connector (read only; OPS-F5-16): the transcript, then the summary. If the request names a file that holds the note, read that file instead. Number the note's lines from 1, counting every line.
3. **Find the items.** An item is a decision, a fact the call settled, a task someone took, an idea raised and not decided, an open question, a rule change, a design ask or a code ask. Greetings, small talk and repeats are not items. Say only what the call said: never add an item the call didn't hold, and never merge two items into one (OPS-F5-12). When one item was said over several lines, take the line where it was said most fully.
4. **Post the list** with `post_in_thread` in the umbrella's thread, exactly in this form (DICT §2):
   `OPS-F5-02 · Items from "{call}":`
   then one line per item: `{n}. {Kind} · {sentence} · {who} · line {m}: "{quote}"`
   `{call}` is the note's title. `{Kind}` is one of Decision, Fact, Task, Idea, Open question, Rule change, Design ask, Code ask. `{sentence}` is the item in one sentence; `{who}` is who said or decided it. `{quote}` is copied from line `{m}` word for word (OPS-F5-12).
5. **Post the output** right after it: `<@Task manager> OPS-F5-02 · Item list: {the list's permalink}` (OPS-F0-12).
6. **Wait for the OK.** Someone who was on the call checks the list and posts "OK" (OPS-F5-03). Items open only after that OK, and agents never post it (OPS-F5-11): you never post it, even when asked. endix-entry-slack refuses it (W-12), and Lighthouse posts no item before a person's OK (W-19).
7. **A fix in the thread** (a person drops, merges or adds an item, OPS-F5-03): post the whole list again, corrected as they said, and wait for the OK again.

## Never

- Post "OK" on the list, or any person's line (OPS-F5-11).
- Copy the note's summary or transcript into Notion, Linear or Slack (OPS-F5-16): the list quotes one line per item and nothing more. The Call log row holds links only (OPS-F5-09), and the doc manager makes it.
- Read notes outside the Granola folder "Endix demo".

## Done when

The list is in the thread and someone who was on the call posted OK after it.

## Eval

`evals/f5-items/`: case E-F5, a fixed transcript made from the S4 talking points; four items, the right kinds, each quoting its line (TEST §2.3), on both models, each judged by the other. Run with `python3 scripts/run_eval.py f5-items`; runs in `evals/f5-items/runs/`.
