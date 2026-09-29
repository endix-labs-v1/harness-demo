// Where Lighthouse posts, dry-run permalinks, and the thread finders of W-18 and W-19.
import { parsePermalink, postGuarded, readThread, type ThreadMessage } from "../../clients/slack";
import { trimForGuard } from "../../guard/person-line";
import type { Refusal, ToolContext } from "../define";
import { ONLY_OUR_CHANNELS } from "./texts";

export type LhChannelKey = "lighthouse" | "questions" | "ideas";
export const LH_CHANNELS: LhChannelKey[] = ["lighthouse", "questions", "ideas"];

const DRY = /^https:\/\/dry-run\.invalid\/(lighthouse|questions|ideas)\/(\d+)$/;

/** Per-run counters for dry-run permalinks and keys (T6 Spec Req 5, 12): `<n>` counts from 1 within the run. */
const COUNTERS = new WeakMap<object, { permalink: number; key: number }>();
function counters(ctx: ToolContext) {
  let c = COUNTERS.get(ctx);
  if (!c) COUNTERS.set(ctx, (c = { permalink: 0, key: 0 }));
  return c;
}
export function nextDryPermalink(ctx: ToolContext, key: LhChannelKey): { permalink: string; ts: string } {
  const n = ++counters(ctx).permalink;
  return { permalink: `https://dry-run.invalid/${key}/${n}`, ts: `dry-run-${n}` };
}
export function nextDryKey(ctx: ToolContext): { key: string; url: string } {
  const n = ++counters(ctx).key;
  return { key: `END-DRY-${n}`, url: `https://dry-run.invalid/END-DRY-${n}` };
}

/** The channel key of a channel ID, when it is one Lighthouse posts in. */
export function channelKeyOf(ctx: Pick<ToolContext, "config">, channelId: string): LhChannelKey | null {
  const ch = ctx.config.slack.channels as Record<string, string>;
  for (const k of LH_CHANNELS) if (ch[k] && ch[k] === channelId) return k;
  return null;
}

export class NotOurChannel extends Error {}

/**
 * A permalink of any message → the channel and the thread to post in (its thread_ts,
 * or its ts when it is top-level). A dry-run permalink is taken as a thread in its
 * channel, in dry run only. Throws on a channel Lighthouse doesn't post in.
 */
export function resolveThread(ctx: ToolContext, permalink: string): { channel: string; channelKey: LhChannelKey; thread_ts: string } {
  const dry = DRY.exec(permalink.trim());
  if (dry) {
    if (!ctx.dryRun) throw new Error(`Not a Slack permalink: ${permalink}`);
    const key = dry[1] as LhChannelKey;
    return { channel: (ctx.config.slack.channels as Record<string, string>)[key], channelKey: key, thread_ts: `dry-run-${dry[2]}` };
  }
  const p = parsePermalink(permalink);
  const key = channelKeyOf(ctx, p.channel);
  if (!key) throw new NotOurChannel(ONLY_OUR_CHANNELS);
  return { channel: p.channel, channelKey: key, thread_ts: p.threadTs ?? p.ts };
}

/** The channel key of a permalink, or null (not Slack, or not one of ours). Never throws. */
export function permalinkChannel(ctx: ToolContext, permalink: string | undefined): LhChannelKey | null {
  if (!permalink) return null;
  const dry = DRY.exec(permalink.trim());
  if (dry) return dry[1] as LhChannelKey;
  try {
    return channelKeyOf(ctx, parsePermalink(permalink).channel);
  } catch {
    return null;
  }
}

export type PostResult = { ts: string; permalink: string } | Refusal | ({ dry_run: true; would: string } & Record<string, unknown>);

/** A reply in a thread through postGuarded (W-12, then mentions). */
export async function replyIn(ctx: ToolContext, thread: string, text: string): Promise<PostResult | { error: string }> {
  let where;
  try {
    where = resolveThread(ctx, thread);
  } catch (e) {
    return { error: (e as Error).message };
  }
  return (await postGuarded(ctx, { channel: where.channel, thread_ts: where.thread_ts, text })) as PostResult;
}

/** A new top-level message (a new thread) in one of Lighthouse's channels. Dry run adds the dry-run permalink. */
export async function startThread(ctx: ToolContext, key: LhChannelKey, text: string): Promise<PostResult> {
  const channel = (ctx.config.slack.channels as Record<string, string>)[key];
  if (!channel) throw new Error(`Config slack.channels.${key} is empty.`);
  const r = (await postGuarded(ctx, { channel, text })) as PostResult;
  if (ctx.dryRun && (r as { dry_run?: boolean }).dry_run) return { ...(r as object), ...nextDryPermalink(ctx, key) } as PostResult;
  return r;
}

export function isPosted(r: unknown): r is { ts: string; permalink: string } {
  return !!r && typeof r === "object" && typeof (r as { permalink?: unknown }).permalink === "string" && !(r as { refused?: boolean }).refused;
}

// ---- the finders of W-18 and W-19 ----

/** SYS §5.0's trim (spaces, `>`, `&gt;`, `*`, `_`, quotes), as the W-12 guard trims. */
export const trimLine = trimForGuard;

/** W-18: a message by a person whose trimmed text starts with "Go:" or "Later:" (any case). */
export function hasDecisionLine(messages: ThreadMessage[]): boolean {
  return messages.some((m) => m.author.kind === "person" && /^(go|later)\s*:/i.test(trimLine(m.text)));
}

export const ITEM_LIST_START = 'OPS-F5-02 · Items from "';

/** W-19: after the latest item list, a person's message that is "OK" or starts with "OK". */
export function hasOkAfterItemList(messages: ThreadMessage[]): boolean {
  let last = -1;
  messages.forEach((m, i) => {
    if (trimLine(m.text).startsWith(ITEM_LIST_START) || m.text.startsWith(ITEM_LIST_START)) last = i;
  });
  if (last < 0) return false;
  return messages.slice(last + 1).some((m) => m.author.kind === "person" && /^ok\b/i.test(trimLine(m.text)));
}

export async function threadMessages(ctx: ToolContext, permalink: string): Promise<ThreadMessage[]> {
  return (await readThread(ctx, { permalink })).messages;
}
