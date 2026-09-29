import { z } from "zod";
import { defineTool, wouldDo } from "../define";
import { ISSUE_KEY } from "./issues";
import { createRelation, fencedIssue, inputError, linkUrl } from "./mutations";

/** SYS §5.3 `link` (T7 Spec Req 10): a blocked-by or related relation, or a URL attachment. W-11 on both ends. */
export const link = defineTool({
  name: "link",
  description:
    "Add to an issue: blocked_by (another issue in the project blocks it), related (a related issue in the project), or url with url_title (an attachment link). An identical relation or link is not added twice. Wall W-11 on both ends.",
  input: {
    issue: z.string().regex(ISSUE_KEY),
    blocked_by: z.string().regex(ISSUE_KEY).optional(),
    related: z.string().regex(ISSUE_KEY).optional(),
    url: z.string().regex(/^https:\/\/\S+$/).optional(),
    url_title: z.string().min(1).optional(),
  },
  async handler(input, ctx) {
    if (!input.blocked_by && !input.related && !input.url) throw inputError("pass at least one of blocked_by, related, url");
    if (input.blocked_by === input.issue || input.related === input.issue) throw inputError("an issue can't be linked to itself");
    const f = await fencedIssue(ctx, input.issue);
    if ("refusal" in f) return f.refusal;
    const issue = f.issue;
    const blocker = input.blocked_by ? await fencedIssue(ctx, input.blocked_by) : null;
    if (blocker && "refusal" in blocker) return blocker.refusal;
    const rel = input.related ? await fencedIssue(ctx, input.related) : null;
    if (rel && "refusal" in rel) return rel.refusal;

    const added: string[] = [];
    const already: string[] = [];
    const todo: (() => Promise<void>)[] = [];
    if (blocker && "issue" in blocker) {
      const b = blocker.issue;
      const what = `blocked by ${b.key}`;
      if (issue.inverseRelations.some((r) => r.type === "blocks" && r.key === b.key)) already.push(what);
      else {
        added.push(what);
        todo.push(() => createRelation(ctx, b.id, issue.id, "blocks"));
      }
    }
    if (rel && "issue" in rel) {
      const r = rel.issue;
      const what = `related ${r.key}`;
      const has = issue.relations.some((x) => x.type === "related" && x.key === r.key) || issue.inverseRelations.some((x) => x.type === "related" && x.key === r.key);
      if (has) already.push(what);
      else {
        added.push(what);
        todo.push(() => createRelation(ctx, issue.id, r.id, "related"));
      }
    }
    if (input.url) {
      const url = input.url;
      const what = `link ${url}`;
      if (issue.attachments.some((a) => a.url === url)) already.push(what);
      else {
        added.push(what);
        todo.push(() => linkUrl(ctx, issue.id, url, input.url_title ?? url));
      }
    }
    if (ctx.dryRun) return wouldDo(`on ${issue.key}: ${added.join("; ") || "nothing new"}`, { added, already });
    for (const t of todo) await t();
    return { key: issue.key, url: issue.url, added, already };
  },
});
