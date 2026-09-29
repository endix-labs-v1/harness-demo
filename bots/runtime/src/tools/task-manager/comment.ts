import { z } from "zod";
import { defineTool, wouldDo } from "../define";
import { ISSUE_KEY } from "./issues";
import { createComment, fencedIssue } from "./mutations";
import { commentLine } from "./texts";

/** SYS §5.3 `comment` (T7 Spec Req 8): one line `<today> · <what> · <thread permalink>`. */
export const comment = defineTool({
  name: "comment",
  description: "Add one comment line to an issue: '<today> · <what> · <thread permalink>'. Wall W-11.",
  input: { issue: z.string().regex(ISSUE_KEY), what: z.string().min(1), thread_permalink: z.string().regex(/^https:\/\/\S+$/) },
  async handler(input, ctx) {
    const f = await fencedIssue(ctx, input.issue);
    if ("refusal" in f) return f.refusal;
    const body = commentLine(ctx.today(), input.what, input.thread_permalink);
    if (ctx.dryRun) return wouldDo(`comment on ${f.issue.key}: ${body}`, { comment: body });
    await createComment(ctx, f.issue.id, body);
    return { key: f.issue.key, url: f.issue.url, comment: body };
  },
});
