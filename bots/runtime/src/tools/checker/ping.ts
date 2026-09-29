import { z } from "zod";
import { postGuarded } from "../../clients/slack";
import { renderMentions } from "../../slack/mentions";
import { defineTool } from "../define";
import { isError, resolveThread } from "../question-idea/thread";
import { postedToday } from "./once";
import { ERR_OWNER, ERR_PING_CHANNEL, ERR_SUBJECT, PING_KINDS, pingLine, SKIPPED, type PingKind } from "./texts";

/** SYS §5.6 ping (T9 Req 12): the fixed line for the kind, at most once a day per thread. */
export const ping = defineTool({
  name: "ping",
  description:
    "Post the fixed Checker line in a thread: due (subject: the task's title) and check_date (subject: the event) in the task's #demo-lighthouse thread; quiet_idea in the #demo-ideas thread; waiting_ok in the item list's #demo-lighthouse thread. owner is Henry. Posts at most once a day per thread and line.",
  input: {
    thread: z.string(),
    kind: z.enum(PING_KINDS as [PingKind, ...PingKind[]]),
    subject: z.string().optional(),
    owner: z.string().optional(),
  },
  async handler(input, ctx) {
    const where = resolveThread(ctx, input.thread);
    if (isError(where)) return where;
    const wants = input.kind === "quiet_idea" ? "ideas" : "lighthouse";
    if (where.key !== wants) return { error: ERR_PING_CHANNEL };
    const named = input.kind === "due" || input.kind === "check_date";
    if (named && !input.subject?.trim()) return { error: ERR_SUBJECT };
    if (named && (input.owner ?? "Henry") !== "Henry") return { error: ERR_OWNER };
    const line = pingLine(input.kind, (input.subject ?? "").trim(), "Henry");
    const head = line.split("<@")[0];
    if (await postedToday(ctx, where, (t) => t.startsWith(head))) return { ...SKIPPED };
    const r = await postGuarded(ctx, { channel: where.channel, thread_ts: where.rootTs ?? undefined, text: line });
    if ("refused" in r || "dry_run" in r) return r;
    return { permalink: r.permalink, line: renderMentions(line, ctx.config) };
  },
});
