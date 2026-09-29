import type { BotName } from "../bots/types";
import { BOTS } from "../bots/registry";
import type { DemoConfig } from "../core/config";
import { authorOf, MESSAGE_SUBTYPES, type Author } from "../clients/slack";
import { personLineStart, trimForGuard } from "../guard/person-line";
import { THREAD_PREDICATES, type PredicateMessage } from "./predicates";
import { EVENT_PRECEDENCE, EVENT_TABLE, type ChannelRole, type EventId, type EventRow } from "./table";

/** A normalized Slack message (Req 8). */
export interface SlackMessage {
  channel: string;
  ts: string;
  thread_ts?: string | null;
  user?: string | null;
  bot_id?: string | null;
  subtype?: string;
  text: string;
}

export interface EventMatch {
  bot: BotName;
  id: EventId;
  channel: string | null; // channel ID; null for E16
  role: ChannelRole | null;
  ts: string | null;
  thread_ts: string | null;
  text: string;
  author: { name: string; kind: string };
  source: "slack" | "self" | "manual" | "schedule";
  permalink?: string;
}

export interface ClassifyDeps {
  config: DemoConfig;
  /** bot_id → display name, from each app's auth.test. */
  botIds?: Record<string, string>;
  /** Only rows of these bots (each Bolt app classifies for its own bot). */
  bots?: BotName[];
  /** The thread, oldest first, read with the waking bot's token. */
  threadOf(bot: BotName, channel: string, threadTs: string): Promise<PredicateMessage[]>;
  /** An issue's label names, read with the task manager's Linear token. */
  issueLabels(key: string): Promise<string[]>;
}

/** The channel's role; #demo-build-test and #demo-no-bots have none, so they wake nobody. */
export function roleOf(config: DemoConfig, channel: string): ChannelRole | null {
  const ch = config.slack.channels;
  if (ch.lighthouse && channel === ch.lighthouse) return "lighthouse";
  if (ch.questions && channel === ch.questions) return "questions";
  if (ch.ideas && channel === ch.ideas) return "ideas";
  return null;
}

/**
 * `--test-channel`: #demo-build-test plays #demo-lighthouse for live tests. The runtime's
 * in-memory config points `slack.channels.lighthouse` at the build-test channel, so the
 * real #demo-lighthouse wakes nobody and the bots' posts land in build-test too.
 */
export function applyTestChannel(config: DemoConfig): DemoConfig {
  const bt = config.slack.channels.build_test;
  if (!bt) throw new Error("Config slack.channels.build_test is empty; --test-channel needs it. T2's setup fills it.");
  return { ...config, slack: { ...config.slack, channels: { ...config.slack.channels, lighthouse: bt } } };
}

function mentions(config: DemoConfig, key: string, raw: string): boolean {
  const id = (config.slack.bots as Record<string, { user_id?: string }>)[key]?.user_id;
  if (!id) return false;
  return raw.includes(`<@${id}>`) || raw.includes(`<@${id}|`);
}

function authorMatches(row: EventRow, author: Author): boolean {
  const a = row.author;
  if (!a) return false;
  if ("anyone" in a) return author.kind === "person" || author.kind === "bot";
  if (author.kind === "person") return a.person;
  if (author.kind === "bot") return (a.bots ?? []).includes(author.name);
  return false;
}

function textMatches(row: EventRow, config: DemoConfig, raw: string): boolean {
  const t = row.text;
  if (!t) return true;
  switch (t.kind) {
    case "mentions":
      return mentions(config, t.bot, raw) && (!t.holds || t.holds.some((h) => raw.includes(h)));
    case "prefix": {
      const start = personLineStart(raw);
      return !!start && t.starts.some((s) => s.toLowerCase() === start.toLowerCase());
    }
    case "ok":
      return /^ok\b/i.test(trimForGuard(raw));
    case "go_or_prefix": {
      if (/^go[.!]?$/i.test(trimForGuard(raw))) return true;
      const start = personLineStart(raw);
      return !!start && t.starts.some((s) => s.toLowerCase() === start.toLowerCase());
    }
  }
}

/** Which bots a Slack message wakes, one match per bot, by SYS §4.2's order (Req 8, 9). */
export async function classify(msg: SlackMessage, deps: ClassifyDeps): Promise<EventMatch[]> {
  if (!MESSAGE_SUBTYPES.has(msg.subtype)) return [];
  const role = roleOf(deps.config, msg.channel);
  if (!role) return [];
  const author = authorOf(msg, deps.config, deps.botIds);
  if (author.kind === "other") return [];
  const isReply = !!msg.thread_ts && msg.thread_ts !== msg.ts;
  const threadTs = msg.thread_ts ?? msg.ts;
  const threads = new Map<BotName, Promise<PredicateMessage[]>>();
  const threadFor = (bot: BotName) => {
    let p = threads.get(bot);
    if (!p) {
      p = isReply ? deps.threadOf(bot, msg.channel, threadTs) : Promise.resolve([]);
      threads.set(bot, p);
    }
    return p;
  };

  const byBot = new Map<BotName, EventRow[]>();
  for (const row of EVENT_TABLE) {
    if (deps.bots && !deps.bots.includes(row.wakes)) continue;
    if (!row.channels.includes(role)) continue;
    if (row.position === "self" || row.position === "cli") continue;
    if (row.position === "top" || row.position === "top_or_self") {
      if (isReply) continue;
    } else if (row.position === "reply" && !isReply) continue;
    if (author.kind === "bot" && author.name === BOTS[row.wakes].displayName) continue; // a bot's own message
    if (!authorMatches(row, author)) continue;
    if (!textMatches(row, deps.config, msg.text)) continue;
    if (row.thread) {
      const thread = await threadFor(row.wakes);
      const ok = await THREAD_PREDICATES[row.thread]({ eventTs: msg.ts, thread, issueLabels: deps.issueLabels });
      if (!ok) continue;
    }
    const list = byBot.get(row.wakes) ?? [];
    list.push(row);
    byBot.set(row.wakes, list);
  }

  const out: EventMatch[] = [];
  for (const [bot, rows] of byBot) {
    rows.sort((a, b) => EVENT_PRECEDENCE.indexOf(a.id) - EVENT_PRECEDENCE.indexOf(b.id));
    out.push({
      bot,
      id: rows[0].id,
      channel: msg.channel,
      role,
      ts: msg.ts,
      thread_ts: isReply ? threadTs : null,
      text: msg.text,
      author: { name: author.name, kind: author.kind },
      source: "slack",
    });
  }
  return out;
}
