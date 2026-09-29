// post_items_as_asks (SYS §5.2, T6 Spec Req 15): after a person's OK on the item list (W-19),
// each call item becomes an ask (queued as E3) or moves to #demo-questions or #demo-ideas.
import { z } from "zod";
import type { RunSummary } from "../../events/dispatch";
import { guardPersonLine } from "../../guard/person-line";
import { defineTool, refused } from "../define";
import { moveTo } from "./move_to";
import { deadline, firstKey, postAndQueue } from "./post_ask";
import { itemAskText, moveText, W19 } from "./texts";
import { hasOkAfterItemList, isPosted, threadMessages } from "./threads";

export const ITEM_KINDS = ["Decision", "Fact", "Task", "Idea", "Open question", "Rule change", "Design ask", "Code ask"] as const;
type Kind = (typeof ITEM_KINDS)[number];

function moveOf(kind: Kind): "questions" | "ideas" | null {
  if (kind === "Open question") return "questions";
  if (kind === "Idea") return "ideas";
  return null;
}

export const postItemsAsAsks = defineTool({
  name: "post_items_as_asks",
  description:
    "After a person's OK on the OPS-F5-02 item list in `thread` (W-19), post each call item: a Decision, Fact, Task, Rule change, Design ask or Code ask as a #demo-lighthouse ask 'From the call <call_log_url>, item <n>, asked by <who>: <sentence>' queued as E3; an Open question moves to #demo-questions; an Idea moves to #demo-ideas. Waits for the E3 runs (at most 300 s) and returns each item's key or thread, for the OPS-F5-05 mention. Holds W-19 and W-12.",
  input: {
    thread: z.string().min(1),
    call_log_url: z.string().min(1),
    items: z
      .array(z.object({ n: z.number().int().positive(), kind: z.enum(ITEM_KINDS), sentence: z.string().min(1), who: z.string().min(1) }).strict())
      .min(1),
  },
  async handler(input, ctx) {
    // 1. W-19: a person's OK after the latest item list.
    let messages;
    try {
      messages = await threadMessages(ctx, input.thread);
    } catch (e) {
      return { error: (e as Error).message };
    }
    if (!hasOkAfterItemList(messages)) return refused("W-19", W19);
    const items = [...input.items].sort((a, b) => a.n - b.n);
    const texts = items.map((it) => {
      const to = moveOf(it.kind);
      return to ? moveText(input.call_log_url, it.who, it.sentence) : itemAskText(input.call_log_url, it.n, it.who, it.sentence);
    });
    // W-12 on every text before the first post.
    for (const t of texts) {
      const r = guardPersonLine(t);
      if (r) return r;
    }
    // 2. Post each item in n order.
    const out: Array<Record<string, unknown>> = [];
    const runs: Array<Promise<RunSummary> | null> = [];
    for (const [i, it] of items.entries()) {
      const to = moveOf(it.kind);
      if (to) {
        const r = await moveTo(ctx, to, it.sentence, input.call_log_url, it.who);
        if (!isPosted(r)) return r;
        out.push({ n: it.n, kind: it.kind, moved_to: to, thread: r.permalink });
        runs.push(null);
      } else {
        const { post, run } = await postAndQueue(ctx, texts[i]);
        if (!isPosted(post)) return post;
        out.push({ n: it.n, kind: it.kind, posted: post.permalink, key: null });
        runs.push(run);
      }
    }
    // 3. Wait for every queued E3 run (300 s in all); each ask gets the key of its own run.
    if (!ctx.dryRun) {
      const d = deadline();
      try {
        const summaries = await Promise.all(runs.map((r) => (r ? d.wait(r.catch(() => null)) : Promise.resolve(null))));
        summaries.forEach((s, i) => {
          if (runs[i]) out[i].key = firstKey(s);
        });
      } finally {
        d.clear();
      }
      return { items: out };
    }
    // 4. Dry run: what would be posted, keys null.
    return { dry_run: true, would: `post ${items.length} call items from ${input.call_log_url}`, items: out.map((o, i) => ({ ...o, text: texts[i] })) };
  },
});
