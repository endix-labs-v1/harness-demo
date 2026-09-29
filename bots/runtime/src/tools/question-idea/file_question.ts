import { z } from "zod";
import { getPermalink } from "../../clients/slack";
import { defineTool, wouldDo, type ToolContext } from "../define";
import { ERR_QUESTIONS_ONLY, openQuestionTitle, threadLine } from "./texts";
import { isError, resolveThread } from "./thread";

const CLOSED = new Set(["Done", "Canceled"]);

/**
 * An open issue of the project whose description is this `Thread:` line (OPS-F4-14's one
 * thread, one issue). The filter's field names are Linear GraphQL facts C-18 checks; the
 * exact match is made here, in code.
 */
async function existingQuestion(ctx: ToolContext, line: string) {
  const data = await ctx.linear(
    `query OpenQuestionByThread($filter: IssueFilter) { issues(filter: $filter, first: 50) { nodes { identifier url description state { name } project { id } } } }`,
    { filter: { project: { id: { eq: ctx.config.linear.project_id } }, description: { contains: line } } },
  );
  const nodes: any[] = data?.issues?.nodes ?? [];
  return (
    nodes.find(
      (n) =>
        n?.project?.id === ctx.config.linear.project_id &&
        !CLOSED.has(n?.state?.name) &&
        String(n?.description ?? "")
          .split("\n")
          .map((l: string) => l.trim())
          .includes(line),
    ) ?? null
  );
}

/** SYS §5.5 file_question (T9 Req 9; SYS §6.3 open question). W-11 by construction. */
export const fileQuestion = defineTool({
  name: "file_question",
  description:
    "File the open-question issue for a #demo-questions thread (OPS-F4-06, OPS-F0-20): `Open question: <question>`, label Question, In Review, description `Thread: <permalink>`. When the thread already has one, returns it.",
  input: { thread: z.string(), question: z.string().min(1) },
  async handler(input, ctx) {
    const where = resolveThread(ctx, input.thread);
    if (isError(where)) return where;
    if (where.key !== "questions") return { error: ERR_QUESTIONS_ONLY };
    const rootPermalink = where.dry || !where.rootTs ? where.permalink : await getPermalink(ctx, where.channel, where.rootTs);
    const line = threadLine(rootPermalink);
    const found = await existingQuestion(ctx, line);
    if (found) return { key: found.identifier, url: found.url, existing: true };
    const title = openQuestionTitle(input.question.trim());
    const issueInput = {
      teamId: ctx.config.linear.team_id,
      projectId: ctx.config.linear.project_id,
      title,
      description: line,
      labelIds: [ctx.config.linear.labels.Question],
      stateId: ctx.config.linear.states["In Review"],
    };
    if (ctx.dryRun) return wouldDo(`create "${title}" (Question, In Review) in Harness demo`, { input: issueInput });
    const data = await ctx.linear(
      `mutation CreateOpenQuestion($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier url } } }`,
      { input: issueInput },
    );
    const issue = data?.issueCreate?.issue;
    if (!data?.issueCreate?.success || !issue) return { error: "Linear did not create the open-question issue." };
    return { key: issue.identifier, url: issue.url, existing: false };
  },
});
