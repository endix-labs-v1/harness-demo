import { readThread } from "../../clients/slack";
import { todaySeoul } from "../../core/time";
import type { ToolContext } from "../define";
import type { ThreadRef } from "../question-idea/thread";

/**
 * The once-a-day rule (SYS §5.6): true when the thread already holds a Checker message
 * from today (Asia/Seoul) that `matches`. A dry-run thread has no messages.
 */
export async function postedToday(ctx: ToolContext, where: ThreadRef, matches: (text: string) => boolean): Promise<boolean> {
  if (where.dry) return false;
  const { messages } = await readThread(ctx, { permalink: where.permalink });
  const today = ctx.today();
  return messages.some((m) => m.author.name === "Checker" && todaySeoul(new Date(Number(m.ts) * 1000)) === today && matches(m.text));
}
