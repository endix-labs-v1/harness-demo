// Slack side of endix-entry-slack: the client, permalinks, thread reads and mentions
// (T10 Spec Req 4, 7, 8; SYS §5.0: permalinks come from chat.getPermalink, never built by hand).
import { LogLevel, WebClient, type Logger } from "@slack/web-api";
import { renderMentions } from "../../../bots/runtime/src/slack/mentions";
import type { EntryConfig } from "./env";

/** The WebClient methods the tools call. Tests pass a fake with the same shape. */
export interface SlackClient {
  conversations: {
    replies(args: { channel: string; ts: string; limit?: number }): Promise<{ messages?: SlackMessage[] }>;
  };
  chat: {
    postMessage(args: {
      channel: string;
      text: string;
      thread_ts?: string;
      unfurl_links?: boolean;
    }): Promise<{ ts?: string }>;
    getPermalink(args: { channel: string; message_ts: string }): Promise<{ permalink?: string }>;
  };
}

export interface SlackMessage {
  ts?: string;
  user?: string;
  bot_id?: string;
  text?: string;
}

/** Every log line goes to stderr: stdout carries only MCP protocol. */
function stderrLogger(): Logger {
  let level = LogLevel.WARN;
  let name = "endix-entry-slack";
  const order = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
  const write = (at: LogLevel, msg: unknown[]) => {
    if (order.indexOf(at) >= order.indexOf(level)) process.stderr.write(`[${at}] ${name} ${msg.map(String).join(" ")}\n`);
  };
  return {
    debug: (...m) => write(LogLevel.DEBUG, m),
    info: (...m) => write(LogLevel.INFO, m),
    warn: (...m) => write(LogLevel.WARN, m),
    error: (...m) => write(LogLevel.ERROR, m),
    setLevel: (l) => void (level = l),
    getLevel: () => level,
    setName: (n) => void (name = n),
  };
}

/** The Entry agent app's client. A failed call fails fast instead of retrying for minutes. */
export function makeSlack(token: string): SlackClient {
  return new WebClient(token, {
    logger: stderrLogger(),
    logLevel: LogLevel.WARN,
    retryConfig: { retries: 1 },
    timeout: 30_000,
  }) as unknown as SlackClient;
}

export interface Permalink {
  channel: string;
  ts: string;
  threadTs: string | null;
}

const PERMALINK =
  /^https:\/\/[A-Za-z0-9-]+\.slack\.com\/archives\/([CDG][A-Z0-9]+)\/p(\d{10})(\d{6})(?:\?thread_ts=(\d{10}\.\d{6})&cid=[CDG][A-Z0-9]+)?$/;

/** `https://<ws>.slack.com/archives/<C…>/p<16 digits>[?thread_ts=<ts>&cid=<C…>]` → its channel and timestamps. */
export function parsePermalink(url: string): Permalink {
  const m = PERMALINK.exec(url.trim());
  if (!m) throw new Error(`Not a Slack permalink: ${url}`);
  return { channel: m[1], ts: `${m[2]}.${m[3]}`, threadTs: m[4] ?? null };
}

/** The ts a reply goes under, or a thread is read from: the thread's root. */
export function threadRoot(p: Permalink): string {
  return p.threadTs ?? p.ts;
}

const BOT_NAMES: Record<string, string> = {
  lighthouse: "Lighthouse",
  task_manager: "Task manager",
  doc_manager: "Doc manager",
  question_idea: "Question/idea agent",
  checker: "Checker",
  entry_agent: "Entry agent",
};

export type Author = { name: string; kind: "person" | "bot" | "other" };

/** Author kinds as the bot runtime gives them (T5 Spec Req 8). An empty ID in config matches nobody. */
export function authorOf(msg: SlackMessage, config: EntryConfig): Author {
  const user = msg.user ?? "";
  if (user && user === config.people.henry.slack_user_id) return { name: "Henry", kind: "person" };
  for (const [key, name] of Object.entries(BOT_NAMES)) {
    const id = config.slack.bots[key as keyof typeof config.slack.bots] as { user_id?: string } | undefined;
    if (user && id?.user_id && user === id.user_id) return { name, kind: "bot" };
  }
  const actions = config.slack.bots.actions?.bot_id ?? "";
  if (msg.bot_id && actions && msg.bot_id === actions) return { name: "Endix Actions", kind: "bot" };
  return { name: user || msg.bot_id || "unknown", kind: "other" };
}

/** The mention forms of DICT §2 that post_in_thread turns into real mentions. */
export const MENTION_FORMS: Record<string, (c: EntryConfig) => string> = {
  Henry: (c) => c.people.henry.slack_user_id,
  Lighthouse: (c) => c.slack.bots.lighthouse.user_id,
  "Task manager": (c) => c.slack.bots.task_manager.user_id,
  "Doc manager": (c) => c.slack.bots.doc_manager.user_id,
  "Question/idea agent": (c) => c.slack.bots.question_idea.user_id,
  Checker: (c) => c.slack.bots.checker.user_id,
};

/** renderMentions (T5) plus a warning for each name it had to leave as written. */
export function mentionText(text: string, config: EntryConfig): { text: string; warnings: string[] } {
  // T5's renderMentions declares its own config shape (it has no import); it reads
  // people.henry.slack_user_id and slack.bots.<key>.user_id, which loadConfig keeps.
  const rendered = renderMentions(text, config as unknown as Parameters<typeof renderMentions>[1]);
  const warnings = Object.keys(MENTION_FORMS)
    .filter((name) => rendered.includes(`<@${name}>`))
    .map((name) => `no Slack user ID for ${name} in config`);
  return { text: rendered, warnings };
}

/** The code of a Slack Web API error (for example `not_in_channel`), never its request. */
export function slackErrorCode(err: unknown): string {
  const e = err as { data?: { error?: unknown }; code?: unknown; message?: unknown };
  if (typeof e?.data?.error === "string") return e.data.error;
  if (typeof e?.code === "string") return e.code;
  return typeof e?.message === "string" ? e.message : String(err);
}
