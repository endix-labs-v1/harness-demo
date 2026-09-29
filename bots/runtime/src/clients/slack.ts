import { WebClient, LogLevel } from "@slack/web-api";
import type { DemoConfig } from "../core/config";
import { guardClosingLine, guardPersonLine } from "../guard/person-line";
import { renderMentions } from "../slack/mentions";
import { DryRunWriteError, GuardRefusal, wouldDo, type ToolContext } from "../tools/define";

export { GuardRefusal };

/** Args objects postGuarded cleared through a matched closing format. */
const CLOSING_CLEARED = new WeakSet<object>();

const SLACK_WRITES: Record<string, string[]> = {
  chat: ["postMessage", "update", "delete"],
  reactions: ["add"],
};

/**
 * Puts the W-12 guard inside `chat.postMessage` and, in dry run, blocks the write
 * methods (Req 14, 18). Works on a real WebClient or a test double.
 */
export function guardSlack<T extends object>(client: T, opts: { dryRun: boolean }): T {
  return new Proxy(client, {
    get(target, prop, _recv) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof prop === "string" && prop in SLACK_WRITES && value && typeof value === "object") {
        const writes = SLACK_WRITES[prop];
        return new Proxy(value as object, {
          get(ns, method) {
            const fn = Reflect.get(ns, method, ns) as unknown;
            if (typeof method !== "string" || typeof fn !== "function") return fn;
            if (!writes.includes(method)) return (fn as Function).bind(ns);
            return async (args: Record<string, unknown>) => {
              if (prop === "chat" && method === "postMessage" && !CLOSING_CLEARED.has(args)) {
                const refusal = guardPersonLine(String(args?.text ?? ""));
                if (refusal) throw new GuardRefusal(refusal);
              }
              if (opts.dryRun) throw new DryRunWriteError(`dry run: ${prop}.${method} blocked`);
              return (fn as Function).call(ns, args);
            };
          },
        });
      }
      return typeof value === "function" ? (value as Function).bind(target) : value;
    },
  });
}

export function makeSlack(token: string, opts: { dryRun: boolean }): WebClient {
  return guardSlack(new WebClient(token, { logLevel: LogLevel.WARN }), opts);
}

export async function getPermalink(ctx: Pick<ToolContext, "slack">, channel: string, ts: string): Promise<string> {
  const r = (await ctx.slack.chat.getPermalink({ channel, message_ts: ts })) as { permalink?: string };
  if (!r.permalink) throw new Error(`No permalink for ${channel} ${ts}`);
  return r.permalink;
}

const PERMALINK = /^https:\/\/[A-Za-z0-9-]+\.slack\.com\/archives\/(C[A-Z0-9_]+)\/p(\d{10})(\d{6})(?:\?(.*))?$/;

export function parsePermalink(url: string): { channel: string; ts: string; threadTs: string | null } {
  const m = PERMALINK.exec(url.trim());
  if (!m) throw new Error(`Not a Slack permalink: ${url}`);
  let threadTs: string | null = null;
  if (m[4]) {
    const q = new URLSearchParams(m[4]);
    threadTs = q.get("thread_ts");
  }
  return { channel: m[1], ts: `${m[2]}.${m[3]}`, threadTs };
}

export function plainText(text: string): string {
  return text.replace(/<([^<>|]+)\|([^<>]*)>/g, "$2").replace(/<(https?:[^<>|]+)>/g, "$1");
}

export function mentionedUserIds(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/<@([UW][A-Z0-9_]+)(?:\|[^>]*)?>/g)) out.push(m[1]);
  return out;
}

export type AuthorKind = "person" | "bot" | "other";
export interface Author {
  name: string;
  kind: AuthorKind;
  user_id?: string | null;
}

/** Bot display names by config key (Req 8). */
export const BOT_DISPLAY: Record<string, string> = {
  lighthouse: "Lighthouse",
  task_manager: "Task manager",
  doc_manager: "Doc manager",
  question_idea: "Question/idea agent",
  checker: "Checker",
  entry_agent: "Entry agent",
};

/**
 * Who wrote a message (Req 8). A message whose `user` is Henry's is a person's, even
 * when it carries `app_id`, `bot_id` or `bot_profile` (Henry's lines posted through the
 * Demo reset app's user token). Then the bots by user ID, then by bot ID.
 */
export function authorOf(
  msg: { user?: string | null; bot_id?: string | null },
  config: DemoConfig,
  botIds: Record<string, string> = {},
): Author {
  const henry = config.people.henry.slack_user_id;
  if (henry && msg.user === henry) return { name: config.people.henry.name || "Henry", kind: "person", user_id: msg.user };
  const bots = config.slack.bots as Record<string, { user_id?: string }>;
  for (const [key, name] of Object.entries(BOT_DISPLAY)) {
    const id = bots[key]?.user_id;
    if (id && msg.user === id) return { name, kind: "bot", user_id: msg.user };
  }
  if (msg.bot_id) {
    if (config.slack.bots.actions.bot_id && msg.bot_id === config.slack.bots.actions.bot_id) return { name: "Endix Actions", kind: "bot", user_id: msg.user ?? null };
    const name = botIds[msg.bot_id];
    if (name) return { name, kind: "bot", user_id: msg.user ?? null };
  }
  return { name: msg.user ?? msg.bot_id ?? "unknown", kind: "other", user_id: msg.user ?? null };
}

export interface ThreadMessage {
  ts: string;
  author: { name: string; kind: AuthorKind };
  text: string;
  permalink: string;
}

/** Subtypes that are messages; every other subtype is a system message (Req 8). */
export const MESSAGE_SUBTYPES = new Set<string | undefined>([undefined, "bot_message", "thread_broadcast", "file_share"]);

type ReadCtx = Pick<ToolContext, "slack" | "config"> & { reads?: ToolContext["reads"]; botIds?: Record<string, string> };

/** The thread of a message, oldest first, parent included, at most 100 (Req 15, 18). */
export async function readThread(ctx: ReadCtx, where: { permalink: string } | { channel: string; ts: string }): Promise<{ messages: ThreadMessage[] }> {
  if ("permalink" in where && ctx.reads?.read_thread?.[where.permalink]) {
    return ctx.reads.read_thread[where.permalink] as { messages: ThreadMessage[] };
  }
  let channel: string;
  let ts: string;
  if ("permalink" in where) {
    const p = parsePermalink(where.permalink);
    channel = p.channel;
    ts = p.threadTs ?? p.ts;
  } else {
    channel = where.channel;
    ts = where.ts;
  }
  const r = (await ctx.slack.conversations.replies({ channel, ts, limit: 100 })) as { messages?: any[] };
  const messages: ThreadMessage[] = [];
  for (const m of (r.messages ?? []).slice(0, 100)) {
    if (!MESSAGE_SUBTYPES.has(m.subtype)) continue;
    const a = authorOf(m, ctx.config, ctx.botIds);
    messages.push({ ts: m.ts, author: { name: a.name, kind: a.kind }, text: m.text ?? "", permalink: await getPermalink(ctx, channel, m.ts) });
  }
  return { messages };
}

/** The one message a permalink points to (for the permalink walls of T7 and T8). */
export async function messageAt(ctx: ReadCtx, permalink: string) {
  const p = parsePermalink(permalink);
  const r = (await ctx.slack.conversations.replies({ channel: p.channel, ts: p.ts, limit: 1, inclusive: true, latest: p.ts, oldest: p.ts })) as { messages?: any[] };
  const m = (r.messages ?? []).find((x) => x.ts === p.ts);
  if (!m) throw new Error(`No message at ${permalink}`);
  const a = authorOf(m, ctx.config, ctx.botIds);
  return { ts: m.ts as string, thread_ts: (m.thread_ts as string | undefined) ?? null, author: { name: a.name, kind: a.kind, user_id: a.user_id ?? null }, text: (m.text as string) ?? "", permalink };
}

function channelName(config: DemoConfig, id: string): string {
  const ch = config.slack.channels as Record<string, string>;
  const names: Record<string, string> = { lighthouse: "#demo-lighthouse", questions: "#demo-questions", ideas: "#demo-ideas", build_test: "#demo-build-test", no_bots: "#demo-no-bots" };
  for (const [k, v] of Object.entries(ch)) if (v && v === id) return names[k] ?? id;
  return id;
}

/**
 * Every bot's Slack post (Req 18): the W-12 guard (or a closing format), mentions, then
 * the post. A refusal is returned, never posted. Dry run returns wouldDo.
 */
export async function postGuarded(
  ctx: Pick<ToolContext, "slack" | "config" | "dryRun">,
  args: { channel: string; thread_ts?: string; text: string; closingFormats?: RegExp[] },
) {
  const refusal = args.closingFormats ? guardClosingLine(args.text, args.closingFormats) : guardPersonLine(args.text);
  if (refusal) return refusal;
  const text = renderMentions(args.text, ctx.config);
  if (ctx.dryRun) {
    return wouldDo(`post in ${channelName(ctx.config, args.channel)}${args.thread_ts ? ` thread ${args.thread_ts}` : ""}: ${text.slice(0, 80)}`);
  }
  const call: Record<string, unknown> = { channel: args.channel, text, unfurl_links: false };
  if (args.thread_ts) call.thread_ts = args.thread_ts;
  if (args.closingFormats) CLOSING_CLEARED.add(call);
  const r = (await ctx.slack.chat.postMessage(call as any)) as { ts?: string; channel?: string };
  const ts = r.ts as string;
  const permalink = await getPermalink(ctx, args.channel, ts);
  return { ts, permalink };
}
