import { z } from "zod";
import { defineTool, refused, wouldDo } from "../define";
import { hasBlocker, isLater, ISSUE_KEY, threadOf } from "./issues";
import { fencedIssue, inputError, updateIssue } from "./mutations";
import { verifyPersonLine } from "./person_lines";
import { CLOSE_VIA_CLOSE, ruleRefused, W15 } from "./texts";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** SYS §5.3 `set_fields` (T7 Spec Req 9). W-11; W-15 on a moved when of a Later issue. */
export const setFields = defineTool({
  name: "set_fields",
  description:
    "Set an issue's state (Todo, In Progress, In Review; never Done or Canceled: use close), assignee (henry), due date (YYYY-MM-DD) or add the label Later. On a Later issue that already has a when, a due date needs person_line_permalink: Henry's 'Move:' line in the task's thread (OPS-F7-12). Walls W-11, W-15.",
  input: {
    issue: z.string().regex(ISSUE_KEY),
    state: z.enum(["Todo", "In Progress", "In Review", "Done", "Canceled"]).optional(),
    assignee: z.literal("henry").optional(),
    due_date: z.string().regex(DAY).optional(),
    add_label: z.literal("Later").optional(),
    person_line_permalink: z.string().optional(),
  },
  async handler(input, ctx) {
    const f = await fencedIssue(ctx, input.issue);
    if ("refusal" in f) return f.refusal;
    const issue = f.issue;
    if (input.state === "Done" || input.state === "Canceled") return ruleRefused("OPS-F0-09", CLOSE_VIA_CLOSE);
    if (!input.state && !input.assignee && !input.due_date && !input.add_label) throw inputError("pass at least one of state, assignee, due_date, add_label");
    // W-15: on a Later issue a due date moves its when, except at opening (no when yet).
    if (input.due_date && isLater(issue) && (issue.dueDate || hasBlocker(issue))) {
      const line = await verifyPersonLine(ctx, input.person_line_permalink, { starts: ["Move:"], thread: threadOf(issue) });
      if (!line) return refused("W-15", W15);
    }
    const update: Record<string, unknown> = {};
    const set: Record<string, string> = {};
    if (input.state) {
      update.stateId = ctx.config.linear.states[input.state];
      set.state = input.state;
    }
    if (input.assignee) {
      update.assigneeId = ctx.config.people.henry.linear_user_id;
      set.assignee = "henry";
    }
    if (input.due_date) {
      update.dueDate = input.due_date;
      set.due_date = input.due_date;
    }
    if (input.add_label && !issue.labels.includes("Later")) {
      update.addedLabelIds = [ctx.config.linear.labels.Later];
      set.add_label = "Later";
    }
    if (Object.keys(update).length === 0) return { key: issue.key, url: issue.url, set, unchanged: true };
    if (ctx.dryRun) return wouldDo(`set ${Object.keys(set).join(", ")} on ${issue.key}`, { set });
    await updateIssue(ctx, issue.id, update);
    return { key: issue.key, url: issue.url, set };
  },
});
