import { authorOf, getPermalink, MESSAGE_SUBTYPES, readThread } from "../clients/slack";
import { personLineStart } from "../guard/person-line";
import { startOfDaySeoul, todaySeoul } from "../core/time";
import type { ToolContext } from "./define";

export interface IdeaThread {
  permalink: string;
  ts: string;
  date: string;
  text: string;
  author: { name: string; kind: string };
  last_reopen_ts: string | null;
  last_quiet_ping_ts: string | null;
  decision_line: { ts: string; text: string; permalink: string } | null;
  closing_line: { ts: string; text: string; permalink: string } | null;
  last_activity_ts: string;
  last_activity: string;
}

const dayOf = (ts: string) => todaySeoul(new Date(Number(ts) * 1000));

/** SYS §5.1 list_idea_threads (OPS-F6-06, 21); T9's checker pass calls it too. */
export async function listIdeaThreads(ctx: Pick<ToolContext, "slack" | "config">, opts: { since?: string } = {}): Promise<IdeaThread[]> {
  const channel = ctx.config.slack.channels.ideas;
  const args: Record<string, unknown> = { channel, limit: 200 };
  if (opts.since) args.oldest = String(startOfDaySeoul(opts.since).getTime() / 1000);
  const r = (await ctx.slack.conversations.history(args as any)) as { messages?: any[] };
  const roots = (r.messages ?? []).filter((m) => MESSAGE_SUBTYPES.has(m.subtype) && (!m.thread_ts || m.thread_ts === m.ts));
  roots.sort((a, b) => Number(b.ts) - Number(a.ts));
  const out: IdeaThread[] = [];
  for (const root of roots) {
    const { messages } = await readThread(ctx, { channel, ts: root.ts });
    const replies = messages.filter((m) => m.ts !== root.ts);
    const latest = <T extends { ts: string }>(xs: T[]) => (xs.length ? xs.reduce((a, b) => (Number(b.ts) > Number(a.ts) ? b : a)) : null);
    const reopen = latest(replies.filter((m) => m.author.name === "Question/idea agent" && m.text.startsWith("Reopened for ")));
    const ping = latest(replies.filter((m) => m.author.name === "Checker" && m.text.startsWith("Go, later or no?")));
    const after = (m: { ts: string }) => !reopen || Number(m.ts) > Number(reopen.ts);
    const decision = latest(
      replies.filter((m) => m.author.kind === "person" && after(m) && ["go:", "later:", "no:"].includes((personLineStart(m.text) ?? "").toLowerCase())),
    );
    const closing = latest(
      replies.filter((m) => m.author.name === "Question/idea agent" && after(m) && /^(Led to:|Later:|Dropped:)/.test(m.text)),
    );
    const last = latest(messages) ?? { ts: root.ts };
    const a = authorOf(root, ctx.config);
    out.push({
      permalink: messages.find((m) => m.ts === root.ts)?.permalink ?? (await getPermalink(ctx, channel, root.ts)),
      ts: root.ts,
      date: dayOf(root.ts),
      text: root.text ?? "",
      author: { name: a.name, kind: a.kind },
      last_reopen_ts: reopen?.ts ?? null,
      last_quiet_ping_ts: ping?.ts ?? null,
      decision_line: decision ? { ts: decision.ts, text: decision.text, permalink: decision.permalink } : null,
      closing_line: closing ? { ts: closing.ts, text: closing.text, permalink: closing.permalink } : null,
      last_activity_ts: last.ts,
      last_activity: dayOf(last.ts),
    });
  }
  return out;
}
