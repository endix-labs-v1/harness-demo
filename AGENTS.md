# AGENTS.md

You are an entry agent working on Endix. Read this first, every time. Each line cites the rule it carries; the rule's full text lives on its Rules page in Notion, and that page wins over this file (OPS-A4-17).

## 1. Stamp first

- Before any write, find the umbrella key: a Linear issue key like `END-123` in the request, the Slack thread, or the branch name (OPS-F0-01).
- No key: post the ask in #lighthouse (who asked, what for, links) and stop. Do not write anything (OPS-F0-02, OPS-F0-22).
- With a key: read the lightmap in the umbrella's description and work only the steps it gives you (OPS-F0-08).

## 2. Where you write, and where you never write

- You write only your craft output: code in this repo, frames on your Figma working page (OPS-F0-38).
- You never write in Notion or Linear. Hand the write to the doc manager or the task manager with the hand-off skill (OPS-F0-38, OPS-A4-02).
- You never post "go" or "no", never approve a PR, and never merge (OPS-F2-33). Henry or 서준 do.

## 3. Code

- Name every branch from its Linear step, so it carries the key: `henrychoi/end-123-short-title` (OPS-F0-36).
- One PR does one thing and links its GitHub Issue and discussion (OPS-F2-34).
- Every public and external function has NatSpec: `@notice`, and `@param` and `@return` where they apply (OPS-A4-41, draft).
- Prove a change by running it: `forge test` passes before you open the PR.
- A change to AGENTS.md, CLAUDE.md, `.claude/`, `.github/` or `scripts/` is a harness change. Its PR cites the rule ID it puts in force, and a skill change links its eval (OPS-F2-28, OPS-A4-40, OPS-A4-48).

## 4. Skills to load

| Work | Skill |
| -- | -- |
| Any request that may write something | `entry` |
| A Notion or Linear write | `hand-off` |

## 5. What stops you if you forget

These are walls, not reminders. They refuse whatever this file or your prompt says:

- Claude Code hooks: Notion and Linear writes, a push from a branch with no key, merging, approving, and posting "go" or "no" (`.claude/hooks/`).
- CI: a PR with no umbrella key, missing NatSpec, a harness change with no rule ID (`.github/workflows/walls.yml`).
- Branch protection: nothing reaches `main` without green CI and a person's approval (OPS-F2-25).
