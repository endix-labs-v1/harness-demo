import { z } from "zod";
import { postGuarded } from "../../clients/slack";
import { defineTool } from "../define";
import { moveText } from "./texts";
import { dryRunPermalink } from "./thread";

/**
 * SYS §5.5 move_to (T9 Req 6): the Move text as a new top-level message in #demo-questions
 * or #demo-ideas, then the moved post queued to this bot as E12 (SYS §4.2). Returns at once;
 * it doesn't wait for that run.
 */
export const moveTo = defineTool({
  name: "move_to",
  description:
    "Move a post to #demo-questions or #demo-ideas: posts `Moved from <source> · asked by <asker>` with the text quoted, as a new thread, and queues it to you (E12) so a new run works it there.",
  input: {
    channel: z.enum(["questions", "ideas"]),
    text: z.string().min(1),
    source_permalink: z.string(),
    asker: z.string().min(1),
  },
  async handler(input, ctx) {
    const channel = ctx.config.slack.channels[input.channel];
    const text = moveText(input.source_permalink, input.asker, input.text);
    const r = await postGuarded(ctx, { channel, text });
    if ("refused" in r) return r;
    if ("dry_run" in r) return { ...r, permalink: dryRunPermalink(ctx, input.channel) };
    const { ts, permalink } = r;
    ctx
      .enqueueSelf({ id: "E12", channel, ts, thread_ts: null, permalink, author: { name: "Question/idea agent", kind: "bot" }, text })
      .catch((e) => ctx.log.write({ kind: "ignored", tool: "mcp__endix__move_to", message: `E12 for the moved post failed: ${(e as Error).message}` }));
    return { permalink, ts };
  },
});
