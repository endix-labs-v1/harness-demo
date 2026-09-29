import { z } from "zod";
import { postGuarded } from "../../clients/slack";
import { renderMentions } from "../../slack/mentions";
import { defineTool } from "../define";
import { isError, resolveThread } from "../question-idea/thread";
import { postedToday } from "./once";
import { ERR_HAND_CHANNEL, ERR_HAND_STEP, ERR_HAND_TEXT, HAND_STEP, handOnLine, handOnMark, SKIPPED } from "./texts";

/** SYS §5.6 hand_on (T9 Req 13): F7.2 to Lighthouse (OPS-F7-08), F7.3 to the Question/idea agent (OPS-F7-10). */
export const handOn = defineTool({
  name: "hand_on",
  description:
    "Hand a due Later task on, in the task's #demo-lighthouse thread: to lighthouse with step_id OPS-F7-08 (F7.2), or to question-idea with step_id OPS-F7-10 and text the idea thread's permalink (F7.3). At most once a day per task.",
  input: {
    thread: z.string(),
    to: z.enum(["lighthouse", "question-idea"]),
    step_id: z.string(),
    task_key: z.string().regex(/^END-\d+$/),
    text: z.string().optional(),
  },
  async handler(input, ctx) {
    const where = resolveThread(ctx, input.thread);
    if (isError(where)) return where;
    if (where.key !== "lighthouse") return { error: ERR_HAND_CHANNEL };
    if (input.step_id !== HAND_STEP[input.to]) return { error: ERR_HAND_STEP };
    const text = (input.text ?? "").trim();
    if (input.to === "question-idea") {
      const idea = text ? resolveThread(ctx, text) : null;
      if (!idea || isError(idea) || idea.key !== "ideas") return { error: ERR_HAND_TEXT };
    }
    const mark = handOnMark(input.step_id, input.task_key);
    if (await postedToday(ctx, where, (t) => t.includes(mark))) return { ...SKIPPED };
    const line = handOnLine(input.to, input.task_key, text);
    const r = await postGuarded(ctx, { channel: where.channel, thread_ts: where.rootTs ?? undefined, text: line });
    if ("refused" in r || "dry_run" in r) return r;
    return { permalink: r.permalink, line: renderMentions(line, ctx.config) };
  },
});
