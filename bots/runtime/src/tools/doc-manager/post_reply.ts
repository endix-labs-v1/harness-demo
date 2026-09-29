// post_reply (SYS §5.4, WALL W-12): replies in a #demo-lighthouse thread through T5's guard.
import { z } from "zod";
import { parsePermalink, postGuarded } from "../../clients/slack";
import { defineTool } from "../define";

export const postReply = defineTool({
  name: "post_reply",
  description: "Reply in a #demo-lighthouse thread: pass the thread's permalink (or its root ts) and the text, a DICT §2 Doc manager line.",
  input: { thread: z.string().min(1), text: z.string().min(1) },
  async handler(input, ctx) {
    const lighthouse = ctx.config.slack.channels.lighthouse;
    let channel = lighthouse;
    let threadTs: string;
    if (/^\d+\.\d+$/.test(input.thread)) threadTs = input.thread;
    else {
      let p: ReturnType<typeof parsePermalink>;
      try {
        p = parsePermalink(input.thread);
      } catch {
        return { error: "input: thread must be a Slack permalink or a thread ts in #demo-lighthouse" };
      }
      channel = p.channel;
      threadTs = p.threadTs ?? p.ts;
    }
    if (!lighthouse || channel !== lighthouse) return { error: "input: the doc manager replies only in #demo-lighthouse threads" };
    return postGuarded(ctx, { channel, thread_ts: threadTs, text: input.text });
  },
});
