import { z } from "zod";
import { messageAt, parsePermalink, postGuarded } from "../../clients/slack";
import { CLOSING_FORMATS, personLineStart, w12Message } from "../../guard/person-line";
import { defineTool, refused, type ToolContext } from "../define";
import {
  CLOSE_KINDS,
  CLOSE_KINDS_BY_CHANNEL,
  closingLine,
  ERR_CLOSE_CHANNEL,
  ERR_LATER_BODY,
  ERR_LED_TO_BODY,
  LATER_BODY,
  LED_TO_BODY,
  PERSON_START,
  type CloseKind,
} from "./texts";
import { isError, resolveThread, type ThreadRef } from "./thread";

/**
 * True when `permalink` is a person's message in `thread` whose trimmed text starts with
 * `start` (`Later:`, `No:`, `Answer:`). Any failure to read it is false: without the
 * person's line behind it, the closing line would be the agent's own decision (W-12).
 */
export async function personLineIn(ctx: ToolContext, thread: Pick<ThreadRef, "channel" | "rootTs">, permalink: string | undefined, start: string) {
  if (!permalink) return null;
  try {
    if (parsePermalink(permalink).channel !== thread.channel) return null;
    const m = await messageAt(ctx, permalink);
    if (m.author.kind !== "person") return null;
    if ((m.thread_ts ?? m.ts) !== thread.rootTs) return null;
    if ((personLineStart(m.text) ?? "").toLowerCase() !== start.toLowerCase()) return null;
    return m;
  } catch {
    return null;
  }
}

/** SYS §5.5 close_thread (T9 Req 8): DICT §4's closing line, through the closing formats only. */
export const closeThread = defineTool({
  name: "close_thread",
  description:
    "Close a thread with its one closing line. #demo-questions: Answered (body: the page links), Led to (body: END-1, END-2), Parked (body: why). #demo-ideas: Led to, Later (body: END-520 · revisit YYYY-MM-DD) or Dropped (body: why in a few words). Later and Dropped need person_line_permalink: the person's Later: or No: line in that thread.",
  input: {
    thread: z.string(),
    kind: z.enum(CLOSE_KINDS as [CloseKind, ...CloseKind[]]),
    body: z.string().min(1),
    person_line_permalink: z.string().optional(),
  },
  async handler(input, ctx) {
    const where = resolveThread(ctx, input.thread);
    if (isError(where)) return where;
    if ((where.key !== "questions" && where.key !== "ideas") || !CLOSE_KINDS_BY_CHANNEL[where.key].includes(input.kind)) return { error: ERR_CLOSE_CHANNEL };
    const body = input.body.trim();
    if (input.kind === "Later" && !LATER_BODY.test(body)) return { error: ERR_LATER_BODY };
    if (input.kind === "Led to" && !LED_TO_BODY.test(body)) return { error: ERR_LED_TO_BODY };
    const start = PERSON_START[input.kind];
    if (start) {
      const line = where.dry ? null : await personLineIn(ctx, where, input.person_line_permalink, start);
      if (!line) return refused("W-12", w12Message(start));
    }
    const text = closingLine(input.kind, body, input.person_line_permalink);
    const r = await postGuarded(ctx, { channel: where.channel, thread_ts: where.rootTs ?? undefined, text, closingFormats: CLOSING_FORMATS.close_thread });
    if ("refused" in r) return r;
    if ("dry_run" in r) return { ...r, line: text };
    return { permalink: r.permalink, line: text };
  },
});
