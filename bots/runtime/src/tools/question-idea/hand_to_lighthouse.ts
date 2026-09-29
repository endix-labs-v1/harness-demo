import { z } from "zod";
import { postGuarded } from "../../clients/slack";
import { defineTool } from "../define";
import { handText } from "./texts";
import { dryRunPermalink } from "./thread";

/** SYS §5.5 hand_to_lighthouse (T9 Req 7): DICT §2's ask, top-level in #demo-lighthouse (E2). */
export const handToLighthouse = defineTool({
  name: "hand_to_lighthouse",
  description:
    "Hand an ask to Lighthouse when the asker's next step is writing something, or the work is already decided: posts `Ask from <asker> via the question/idea agent: <text> · <source permalink>` in #demo-lighthouse.",
  input: { text: z.string().min(1), source_permalink: z.string(), asker: z.string().min(1) },
  async handler(input, ctx) {
    const channel = ctx.config.slack.channels.lighthouse;
    const r = await postGuarded(ctx, { channel, text: handText(input.asker, input.text, input.source_permalink) });
    if ("dry_run" in r) return { ...r, permalink: dryRunPermalink(ctx, "lighthouse") };
    return r;
  },
});
