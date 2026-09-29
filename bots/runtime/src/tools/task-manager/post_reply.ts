import { z } from "zod";
import { parsePermalink, postGuarded } from "../../clients/slack";
import { defineTool } from "../define";
import { inputError } from "./mutations";

/** SYS §5.3 `post_reply` (T7 Spec Req 13): a reply in a #demo-lighthouse thread. W-12. */
export const postReply = defineTool({
  name: "post_reply",
  description: "Reply in a #demo-lighthouse thread: pass the thread's permalink (or any message's in it) and the text, one DICT §2 line. Wall W-12: never a person's line.",
  input: { thread: z.string(), text: z.string().min(1) },
  async handler(input, ctx) {
    let p: ReturnType<typeof parsePermalink>;
    try {
      p = parsePermalink(input.thread);
    } catch {
      throw inputError("thread is a Slack permalink");
    }
    const lighthouse = ctx.config.slack.channels.lighthouse;
    if (!lighthouse || p.channel !== lighthouse) throw inputError("the task manager replies only in #demo-lighthouse threads");
    return postGuarded(ctx, { channel: p.channel, thread_ts: p.threadTs ?? p.ts, text: input.text });
  },
});
