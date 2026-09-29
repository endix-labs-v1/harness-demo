// post_reply (SYS §5.2, T6 Spec Req 6): a reply in a #demo-lighthouse, #demo-questions or #demo-ideas thread.
import { z } from "zod";
import { defineTool } from "../define";
import { replyIn } from "./threads";

export const postReply = defineTool({
  name: "post_reply",
  description:
    "Reply in a thread of #demo-lighthouse, #demo-questions or #demo-ideas: the lightmap reply, the split reply, an ask back, the no-flow line, a refusal line. `thread` is the permalink of any message in that thread. Holds W-12 (never a person's line). Returns permalink and ts.",
  input: { thread: z.string().min(1), text: z.string().min(1) },
  async handler(input, ctx) {
    return replyIn(ctx, input.thread, input.text);
  },
});
