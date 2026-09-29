// move_to (SYS §5.2, T6 Spec Req 7): a question to #demo-questions, an idea to #demo-ideas.
import { z } from "zod";
import { defineTool, type ToolContext } from "../define";
import { moveText } from "./texts";
import { startThread } from "./threads";

export function moveTo(ctx: ToolContext, channel: "questions" | "ideas", text: string, source: string, asker: string) {
  return startThread(ctx, channel, moveText(source, asker, text));
}

export const moveToTool = defineTool({
  name: "move_to",
  description:
    "Move a question (channel 'questions') or an idea (channel 'ideas') into its own new thread there: 'Moved from <source_permalink> · asked by <asker>' then '> <text>' (DICT §2). `text` is the piece in the asker's own words. Holds W-12. Returns permalink and ts.",
  input: {
    channel: z.enum(["questions", "ideas"]),
    text: z.string().min(1),
    source_permalink: z.string().min(1),
    asker: z.string().min(1),
  },
  async handler(input, ctx) {
    return moveTo(ctx, input.channel, input.text, input.source_permalink, input.asker);
  },
});
