import { z } from "zod";
import { getIssue } from "../../clients/linear";
import { fenceProject } from "../../fence/project";
import { w12Message } from "../../guard/person-line";
import { defineTool, refused, wouldDo } from "../define";
import { personLineIn } from "./close_thread";
import { answerComment } from "./texts";
import { isError, resolveThread } from "./thread";

/** SYS §5.5 close_question (T9 Req 10): the Answer line quoted, `Docs:`, then Done (OPS-F4-07, 15). */
export const closeQuestion = defineTool({
  name: "close_question",
  description:
    "Close an open-question issue once a person posted `Answer:` in its thread and the docs say it: one comment quoting the Answer line with `Docs: <link>`, then Done.",
  input: { issue: z.string().regex(/^END-\d+$/), answer_permalink: z.string(), docs_link: z.string() },
  async handler(input, ctx) {
    const fence = await fenceProject(ctx, input.issue);
    if (fence) return fence;
    const issue = await getIssue(ctx, input.issue);
    if (!issue) return { error: `${input.issue} not found.` };
    const labels: string[] = (issue.labels?.nodes ?? []).map((l: { name: string }) => l.name);
    if (!labels.includes("Question")) return { error: `${input.issue} is not an open question (no label Question).` };
    if (!/^https?:\/\/\S+$/.test(input.docs_link.trim())) return { error: "docs_link is the URL of the page that now says the answer (OPS-F4-15)." };
    const threadPermalink = /^Thread: (\S+)/m.exec(String(issue.description ?? ""))?.[1];
    const where = threadPermalink ? resolveThread(ctx, threadPermalink) : null;
    const answer = where && !isError(where) ? await personLineIn(ctx, where, input.answer_permalink, "Answer:") : null;
    if (!answer) return refused("W-12", w12Message("Answer:"));
    const body = answerComment(answer.text, input.answer_permalink, input.docs_link.trim());
    if (ctx.dryRun) return wouldDo(`comment on ${input.issue} and move it to Done`, { comment: body });
    await ctx.linear(`mutation CloseQuestionComment($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`, {
      input: { issueId: issue.id, body },
    });
    await ctx.linear(`mutation CloseQuestionDone($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`, {
      id: issue.id,
      input: { stateId: ctx.config.linear.states.Done },
    });
    return { key: input.issue, state: "Done", comment: body };
  },
});
