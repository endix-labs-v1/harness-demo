---
name: entry
description: Use at the start of any request that may write something (code, a doc, an issue, a frame). Finds the umbrella key, reads the lightmap, and limits the work to its steps; with no key, posts the ask in #lighthouse and stops. Carries OPS-F0-01, 02, 08, 22.
---

# Entry: stamp first

Carries: OPS-F0-01, OPS-F0-02, OPS-F0-08, OPS-F0-22 (Operations · Rules · F0 in Notion; that page wins over this file).

## Steps

1. **Find the key.** Look for a Linear issue key (`END-` followed by digits) in, in order: the request, the Slack thread it came from, the current branch name. Take the first one found.
2. **No key.** Post the ask in #lighthouse in one message: who asked, what for, which agent you are, links to the sources. Then stop and tell the asker it's waiting for Lighthouse. Write nothing else.
3. **Key found.** Read the umbrella issue's description: the lightmap. List the steps it gives to you (the entry agent), each with its ID and where its output goes.
4. **Work only those steps**, in order. For code, create the branch from the step's Linear branch name so it carries the key.
5. **A Notion or Linear write** in a step: load the `hand-off` skill. Never write there yourself.
6. **Anything outside the lightmap** (a new page, another repo, a decision): stop and say so in the umbrella's thread. Lighthouse re-stamps or opens a new umbrella.

## Done when

Every step given to you has its output in its place, and each output is posted in the umbrella's thread with its link.

## Eval

A request with no key ends in one #lighthouse post and no other write. A request with a key produces only the lightmap's steps. Rubric and runs: `evals/entry/` (to add, OPS-A4-48).
