import { parsePermalink } from "../../clients/slack";
import type { ToolContext } from "../define";

/** The channels a thread permalink can be in (config.slack.channels keys). */
export type ChannelKey = "lighthouse" | "questions" | "ideas" | "build_test" | "no_bots";

export interface ThreadRef {
  permalink: string;
  channel: string; // channel ID
  key: ChannelKey | null;
  /** The thread's root ts (a reply's permalink carries it as thread_ts). */
  rootTs: string | null;
  /** A dry-run permalink (`https://dry-run.invalid/<channel key>/<n>`): no Slack message behind it. */
  dry: boolean;
}

export const CHANNEL_NAMES: Record<ChannelKey, string> = {
  lighthouse: "#demo-lighthouse",
  questions: "#demo-questions",
  ideas: "#demo-ideas",
  build_test: "#demo-build-test",
  no_bots: "#demo-no-bots",
};

const DRY = /^https:\/\/dry-run\.invalid\/([a-z_]+)\/(\d+)$/;

function keyOf(ctx: Pick<ToolContext, "config">, channel: string): ChannelKey | null {
  const ch = ctx.config.slack.channels as Record<string, string>;
  for (const [k, v] of Object.entries(ch)) if (v && v === channel) return k as ChannelKey;
  return null;
}

/**
 * Where a thread permalink points. In dry run a tool that would start a thread returns
 * a dry-run permalink, and every post tool takes it as a thread in that channel (T9 Req 4).
 */
export function resolveThread(ctx: Pick<ToolContext, "config" | "dryRun">, permalink: string): ThreadRef | { error: string } {
  const dry = DRY.exec(permalink.trim());
  if (dry) {
    if (!ctx.dryRun) return { error: `${permalink} is a dry-run permalink; it exists only in dry run.` };
    const key = dry[1] as ChannelKey;
    const channel = (ctx.config.slack.channels as Record<string, string>)[key];
    if (!channel) return { error: `Unknown channel key "${dry[1]}" in ${permalink}.` };
    return { permalink, channel, key, rootTs: null, dry: true };
  }
  try {
    const p = parsePermalink(permalink);
    return { permalink, channel: p.channel, key: keyOf(ctx, p.channel), rootTs: p.threadTs ?? p.ts, dry: false };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const COUNTERS = new WeakMap<object, number>();

/** The dry-run permalink of a thread a tool would start (T9 Req 4, as T6's tool preamble). */
export function dryRunPermalink(ctx: object, key: ChannelKey): string {
  const n = (COUNTERS.get(ctx) ?? 0) + 1;
  COUNTERS.set(ctx, n);
  return `https://dry-run.invalid/${key}/${n}`;
}

export function isError(v: unknown): v is { error: string } {
  return !!v && typeof v === "object" && typeof (v as { error?: unknown }).error === "string";
}
