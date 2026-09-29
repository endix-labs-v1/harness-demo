import { z } from "zod";
import { fenceProject } from "../../fence/project";
import { parsePermalink } from "../../clients/slack";
import { defineTool, refused, wouldDo, type ToolContext } from "../define";
import { isLater, ISSUE_KEY, sourceOf, threadOf, type FullIssue } from "./issues";
import { createComment, fencedIssue, inputError, updateIssue } from "./mutations";
import { verifyPersonLine } from "./person_lines";
import {
  CLOSED_FORMATS,
  closedLine,
  ledToClosing,
  notDoingClosing,
  openChild,
  personClosing,
  reopenedClosing,
  ruleRefused,
  W15,
  type CloseKind,
  type RuleRefusal,
} from "./texts";

export const KINDS = ["Done", "Drop", "No", "Led to", "Reopened", "Not doing", "Closed"] as const;

type Checked = { comment: string } | { refusal: ReturnType<typeof refused> | RuleRefusal };

function inIdeas(ctx: ToolContext, text: string): boolean {
  try {
    return parsePermalink(text).channel === ctx.config.slack.channels.ideas && !!ctx.config.slack.channels.ideas;
  } catch {
    return false;
  }
}

/** W-15 on an issue labelled Later (T7 Spec Req 12.2): the comment, or the W-15 refusal. */
async function checkLater(ctx: ToolContext, issue: FullIssue, kind: CloseKind, text: string, permalink: string | undefined): Promise<Checked> {
  const w15 = { refusal: refused("W-15", W15) };
  switch (kind) {
    case "Done":
    case "Drop": {
      const line = await verifyPersonLine(ctx, permalink, { starts: [`${kind}:`], thread: threadOf(issue) });
      return line ? { comment: personClosing(kind, line.author_name, line.text, line.permalink) } : w15;
    }
    case "No": {
      const line = await verifyPersonLine(ctx, permalink, { starts: ["No:"], thread: sourceOf(issue) });
      return line ? { comment: personClosing("No", line.author_name, line.text, line.permalink) } : w15;
    }
    case "Led to": {
      if (!/^END-\d+$/.test(text) || text === issue.key) return w15;
      if (await fenceProject(ctx, text)) return w15;
      return { comment: ledToClosing(text) };
    }
    case "Reopened":
      return inIdeas(ctx, text) ? { comment: reopenedClosing(text) } : w15;
    default:
      return w15; // Closed and Not doing never close a to-do.
  }
}

/** An issue without the label Later (T7 Spec Req 12.3). */
async function checkOther(ctx: ToolContext, issue: FullIssue, kind: CloseKind, text: string): Promise<Checked> {
  switch (kind) {
    case "Closed": {
      for (const c of issue.children) {
        if (c.state.type !== "completed" && c.state.type !== "canceled") return { refusal: ruleRefused("OPS-F0-09", openChild(c.key, c.title, c.state.name)) };
      }
      if (!CLOSED_FORMATS.some((r) => r.test(text))) throw inputError(`Closed text must be 'Closed · …', 'Code doc: <link>' or 'No doc change: <why>'`);
      return { comment: text };
    }
    case "Led to": {
      if (!/^END-\d+$/.test(text) || text === issue.key) throw inputError("Led to text is one issue key, END-<n>");
      const fence = await fenceProject(ctx, text);
      if (fence) return { refusal: fence };
      return { comment: ledToClosing(text) };
    }
    case "Not doing":
      if (!/^https:\/\/\S+$/.test(text)) throw inputError("Not doing text is the discussion URL");
      return { comment: notDoingClosing(text) };
    default:
      throw inputError(`${kind} closes only a to-do (an issue labelled Later)`);
  }
}

/** SYS §5.3 `close` (T7 Spec Req 12): the DICT §4 closing comment, then the state. W-11, W-15. */
export const close = defineTool({
  name: "close",
  description:
    "Close an issue: posts the DICT §4 closing comment, then sets Done (Canceled for Drop, No, Not doing). A to-do (label Later) closes only on a person's line: Done/Drop need person_line_permalink to Henry's 'Done:'/'Drop:' in the task's thread, No his 'No:' in the idea thread; Led to takes text END-<n>; Reopened takes text the idea thread permalink. Closed (a tree, a step, a docs issue) needs every child Done or Canceled and text 'Closed · …', 'Code doc: <link>' or 'No doc change: <why>'. Walls W-11, W-15.",
  input: {
    issue: z.string().regex(ISSUE_KEY),
    kind: z.enum(KINDS),
    text: z.string(),
    person_line_permalink: z.string().optional(),
  },
  async handler(input, ctx) {
    const f = await fencedIssue(ctx, input.issue);
    if ("refusal" in f) return f.refusal;
    const issue = f.issue;
    const text = input.text.trim();
    const checked = isLater(issue) ? await checkLater(ctx, issue, input.kind, text, input.person_line_permalink) : await checkOther(ctx, issue, input.kind, text);
    if ("refusal" in checked) return checked.refusal;
    const state = input.kind === "Drop" || input.kind === "No" || input.kind === "Not doing" ? "Canceled" : "Done";
    const closed_reply = closedLine(issue.key, input.kind);
    if (ctx.dryRun) return wouldDo(`close ${issue.key} (${input.kind}) with the comment, then ${state}`, { comment: checked.comment, state, closed_reply });
    await createComment(ctx, issue.id, checked.comment);
    await updateIssue(ctx, issue.id, { stateId: ctx.config.linear.states[state] });
    return { key: issue.key, url: issue.url, state, comment: checked.comment, closed_reply };
  },
});
