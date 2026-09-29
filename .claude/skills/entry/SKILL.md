---
name: entry
description: Use at the start of any request that may write something (code, a doc, an issue, a frame). Finds the umbrella key, reads the lightmap, and limits the work to its steps; with no key, posts the ask in #demo-lighthouse with endix-entry-slack's post_ask and stops. Carries OPS-F0-01, 02, 08, 22.
---

# Entry: stamp first

Carries: OPS-F0-01, OPS-F0-02, OPS-F0-08, OPS-F0-22 (Operations · Rules · F0 in Notion; that page wins over this file).

## Steps

1. **Find the key.** Look for a Linear issue key (`END-` followed by digits) in, in order: the request, the Slack thread it came from, the current branch name. Take the first one found.
2. **No key.** Call `post_ask` (endix-entry-slack) once: `who_asked` is the person who asked (at this terminal, Henry), `what_for` is the ask in one sentence in their words, `links` are its sources (an empty list when there are none). Then stop and tell the asker it waits for Lighthouse, with the permalink `post_ask` returned. Write nothing else: no file edit, no git write (no branch, commit or push; reading the branch is fine), no other post.
3. **Key found.** Read the umbrella's description, the lightmap (through the Linear connector, read only), and its thread with `read_thread`. List the steps it gives to you (the entry agent), each with its ID and where its output goes.
4. **Work only those steps**, in order. For code, create the branch from the step's Linear branch name so it carries the key.
5. **Post each output** in the umbrella's thread with `post_in_thread`, in the forms below, so the task manager fills its done-when (OPS-F0-12). When you carry on after a person's step whose output is on GitHub, where the task manager can't read (OPS-F2-03 Discussion replies, OPS-F2-04 go, OPS-F2-09 approval), first post that step's output with the person's link, in its form below. It reports their link; it is not their line.
6. **A Notion or Linear write** in a step: load the `hand-off` skill. Never write there yourself.
7. **Anything outside the lightmap** (a new page, another repo, a decision): stop and say so in the umbrella's thread with `post_in_thread`. Lighthouse re-stamps or opens a new umbrella.

## Post forms (DICT §2)

Write each post exactly in its form; `{…}` is filled in. `post_in_thread` turns `<@Henry>`, `<@Lighthouse>`, `<@Task manager>` and `<@Doc manager>` into mentions.

- Output (OPS-F0-12): `<@Task manager> {step} · {output}: {link}`
- Output of a person's step (OPS-F0-12), for OPS-F2-03, OPS-F2-04 and OPS-F2-09: `<@Task manager> {step} · {output} by {person}: {link}`, for example `<@Task manager> OPS-F2-04 · go by Henry: {the go comment's link}` or `<@Task manager> OPS-F2-09 · approved by Seojun (demo): {PR link}`
- Draft of a change (OPS-F1-10): `OPS-F1-10 · Draft for {page}`, then the lines `Section: {section}`, `Now: "{old}"`, `New: "{new}"`, `Why: {why}`, then `<@{Owner}> please OK or send back.`
- Carry-over list (OPS-F0-41): `OPS-F0-41 · Carry-over for {page} ({key}):`, then one line per page, `{page} · changes · {section}: {why} · <@{Owner}>` or `{page} · no change · {why}`; then `<@Lighthouse> OPS-F0-42 · open the follow-ups` when a line says "changes", and `<@Doc manager> OPS-F0-43 · add the Checked-against lines` when a line says "no change". With no pages: `OPS-F0-41 · Carry-over for {page} ({key}): no pages are written from it.` and `<@Task manager> OPS-F0-43 · close {key}`.
- Code doc check (OPS-F2-12): `OPS-F2-12 · {Code doc}: {sections that change}` or `OPS-F2-12 · no doc change: {why}`
- Close a docs issue (OPS-F2-14), in F2: `<@Task manager> OPS-F2-14 · close the docs issue {key}: Code doc {link}` or `<@Task manager> OPS-F2-14 · close the docs issue {key}: no doc change, {why}`. In F1 the carry-over's `OPS-F0-43 · close {key}` closes the tree instead.

## Done when

Every step given to you has its output in its place, and each output is posted in the umbrella's thread with its link.

## Eval

`evals/entry/`: case T-EA-8, a request with no key to change a doc ends in one `post_ask` and no other write (TEST §2.2), on both models, each judged by the other. Run with `python3 scripts/run_eval.py entry`; runs in `evals/entry/runs/`.
