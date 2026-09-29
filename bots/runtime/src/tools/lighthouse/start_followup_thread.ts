// start_followup_thread (SYS §5.2, T6 Spec Req 14): a carry-over "changes" line gets its own thread (OPS-F0-42).
import { z } from "zod";
import { defineTool } from "../define";
import { followupText } from "./texts";
import { isPosted, startThread } from "./threads";

export const startFollowupThread = defineTool({
  name: "start_followup_thread",
  description:
    "Start a #demo-lighthouse thread for one carry-over 'changes' line (OPS-F0-42): 'Follow-up from <origin_key>, carry-over line: \"<line>\"'. Queues no E3: this same run then opens the follow-up's umbrella with this thread and posts its lightmap reply there. Holds W-12. Returns permalink, ts and page.",
  input: { origin_key: z.string().regex(/^END-\d+$/), page: z.string().min(1), line: z.string().min(1) },
  async handler(input, ctx) {
    const r = await startThread(ctx, "lighthouse", followupText(input.origin_key, input.line));
    if (isPosted(r)) return { ...(r as object), page: input.page };
    return r;
  },
});
