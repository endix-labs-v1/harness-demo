// mention (SYS §5.2, T6 Spec Req 13): `<@{bot}> {step} · {text}` in a thread (DICT §2).
import { z } from "zod";
import { defineTool } from "../define";
import { mentionText } from "./texts";
import { replyIn } from "./threads";

export const mention = defineTool({
  name: "mention",
  description:
    "Hand a step to another bot in a thread: posts '<@Task manager|Doc manager|Question/idea agent> <step_id> · <text>' (DICT §2), for example task-manager OPS-F0-07 'build the tree for END-123'. Holds W-12. Returns permalink and ts.",
  input: {
    bot: z.enum(["task-manager", "doc-manager", "question-idea"]),
    thread: z.string().min(1),
    step_id: z.string().regex(/^OPS-[A-Z0-9]+-\d+$/),
    text: z.string().min(1),
  },
  async handler(input, ctx) {
    return replyIn(ctx, input.thread, mentionText(input.bot, input.step_id, input.text));
  },
});
