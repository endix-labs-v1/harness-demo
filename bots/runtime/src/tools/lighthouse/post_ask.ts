// post_ask (SYS §5.2, T6 Spec Req 14): a top-level ask in #demo-lighthouse, queued to Lighthouse itself as E3.
import { z } from "zod";
import type { RunSummary } from "../../events/dispatch";
import { defineTool, type SelfEvent, type ToolContext } from "../define";
import { isPosted, startThread, type PostResult } from "./threads";

/** SYS §5.2, C-21: a waiting tool waits at most 300 seconds. */
export const WAIT_MS = 300_000;
const TIMED_OUT = Symbol("timed out");

/** The key of the first open_umbrella result in a run that isn't refused (or an error), else null. */
export function firstKey(summary: RunSummary | null | undefined): string | null {
  for (const r of summary?.toolResults ?? []) {
    if (r.name !== "open_umbrella") continue;
    const v = r.result as { refused?: boolean; key?: unknown } | null;
    if (v && !v.refused && typeof v.key === "string") return v.key;
  }
  return null;
}

/** A deadline shared by several waits; `wait(p)` gives p's value or null once it passes. */
export function deadline(ms: number = WAIT_MS) {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<typeof TIMED_OUT>((res) => {
    timer = setTimeout(() => res(TIMED_OUT), ms);
    timer.unref?.();
  });
  return {
    async wait<T>(p: Promise<T>): Promise<T | null> {
      const v = await Promise.race([p, expired]);
      return v === TIMED_OUT ? null : (v as T);
    },
    clear() {
      if (timer) clearTimeout(timer);
    },
  };
}

/** Posts `text` top-level in #demo-lighthouse and, outside dry run, queues it as E3. */
export async function postAndQueue(ctx: ToolContext, text: string): Promise<{ post: PostResult; run: Promise<RunSummary> | null }> {
  const post = await startThread(ctx, "lighthouse", text);
  if (ctx.dryRun || !isPosted(post)) return { post, run: null };
  const e: SelfEvent = {
    id: "E3",
    channel: ctx.config.slack.channels.lighthouse,
    ts: post.ts,
    thread_ts: null,
    permalink: post.permalink,
    author: { name: "Lighthouse", kind: "bot" },
    text,
  };
  const run = ctx.enqueueSelf(e);
  run.catch(() => undefined); // a failed E3 run gives key null, never an unhandled rejection
  return { post, run };
}

export const postAsk = defineTool({
  name: "post_ask",
  description:
    "Post an ask as a new top-level message in #demo-lighthouse (one of the DICT §2 ask lines, text unchanged) and queue it to yourself as E3, which opens it. With wait true, waits for that E3 run (at most 300 s) and returns the key it opened (or null). Holds W-12. Returns permalink and ts (and key with wait).",
  input: {
    text: z.string().min(1),
    source_permalink: z.string().min(1),
    asker: z.string().min(1),
    wait: z.boolean().optional(),
  },
  async handler(input, ctx) {
    const { post, run } = await postAndQueue(ctx, input.text);
    if (!isPosted(post)) return post; // a refusal (W-12)
    if (ctx.dryRun) return input.wait ? { ...(post as object), key: null } : post; // no post, no E3
    if (!input.wait || !run) return { permalink: post.permalink, ts: post.ts };
    const d = deadline();
    try {
      const summary = await d.wait(run.catch(() => null));
      return { permalink: post.permalink, ts: post.ts, key: firstKey(summary) };
    } finally {
      d.clear();
    }
  },
});
