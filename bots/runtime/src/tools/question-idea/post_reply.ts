import { z } from "zod";
import { postGuarded } from "../../clients/slack";
import { defineTool } from "../define";
import { ERR_CHANNEL, ERR_LIGHTHOUSE } from "./texts";
import { isError, resolveThread } from "./thread";

/** SYS §5.5 post_reply (T9 Req 5): a reply in a thread, through postGuarded (W-12). */
export const postReply = defineTool({
  name: "post_reply",
  description:
    "Reply in a thread in #demo-questions or #demo-ideas (an answer, a gap, an ask back, idea context, a view when asked, a reopen). In #demo-lighthouse only a mention (starting <@) or a Refused: line. Pass the thread's permalink.",
  input: { thread: z.string(), text: z.string().min(1) },
  async handler(input, ctx) {
    const where = resolveThread(ctx, input.thread);
    if (isError(where)) return where;
    if (where.key !== "questions" && where.key !== "ideas" && where.key !== "lighthouse") return { error: ERR_CHANNEL };
    if (where.key === "lighthouse" && !input.text.startsWith("<@") && !input.text.startsWith("Refused: ")) return { error: ERR_LIGHTHOUSE };
    return postGuarded(ctx, { channel: where.channel, thread_ts: where.rootTs ?? undefined, text: input.text });
  },
});
