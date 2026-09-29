// replace_text (SYS §5.4, WALL W-14, OPS-F1-35): the checks of T8 Spec Requirement 11, in order.
import { z } from "zod";
import { messageAt, parsePermalink } from "../../clients/slack";
import { defineTool, refused, wouldDo, type Refusal, type ToolContext } from "../define";
import { fromMarkdown } from "./richtext";
import { notionOf, personOf, readPage, type Page } from "./pages";
import { isOk, latestDraft } from "./threads";
import { ruleRefusal, texts, w14Text } from "./texts";

const CHANNEL_KEYS: Record<string, string> = { "demo-lighthouse": "lighthouse", "demo-questions": "questions", "demo-ideas": "ideas" };

function count(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let at = haystack.indexOf(needle);
  while (at >= 0) {
    n += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return n;
}

function replaceOnce(haystack: string, oldText: string, newText: string): string {
  const at = haystack.indexOf(oldText);
  return haystack.slice(0, at) + newText + haystack.slice(at + oldText.length);
}

/** The Owner (as named in config.people) and the Slack user IDs that count as the Owner. */
function ownerOf(ctx: ToolContext, page: Page): { name: string; slackIds: Set<string> } {
  const slackIds = new Set<string>();
  let name: string | null = null;
  page.ownerIds.forEach((id, i) => {
    const p = personOf(ctx.config, { notionUserId: id });
    if (p?.slackUserId) slackIds.add(p.slackUserId);
    if (name === null) name = p?.name ?? page.ownerNames[i] ?? null;
  });
  return { name: name ?? "the Owner", slackIds };
}

/** W-14: `ok_permalink` points to the Owner's OK, in this event's thread, after the latest draft. */
async function w14(ctx: ToolContext, page: Page, okPermalink: string | undefined): Promise<Refusal | null> {
  const owner = ownerOf(ctx, page);
  const refusal = refused("W-14", w14Text(page.title, owner.name));
  const draft = latestDraft(ctx.packet.thread);
  if (!okPermalink || !draft || owner.slackIds.size === 0) return refusal;
  let p: ReturnType<typeof parsePermalink>;
  let msg: Awaited<ReturnType<typeof messageAt>>;
  try {
    p = parsePermalink(okPermalink);
    msg = await messageAt(ctx, okPermalink);
  } catch {
    return refusal;
  }
  const channelKey = ctx.event.channel ? CHANNEL_KEYS[ctx.event.channel] : undefined;
  const eventChannel = channelKey ? (ctx.config.slack.channels as Record<string, string>)[channelKey] : undefined;
  const eventRoot = ctx.event.thread_ts ?? ctx.event.ts;
  const msgRoot = msg.thread_ts ?? msg.ts;
  const byOwner = msg.author.kind === "person" && !!msg.author.user_id && owner.slackIds.has(msg.author.user_id);
  const sameThread = !!eventChannel && p.channel === eventChannel && !!eventRoot && msgRoot === eventRoot;
  const afterDraft = Number(msg.ts) > Number(draft.ts);
  if (!byOwner || !isOk(msg.text) || !sameThread || !afterDraft) return refusal;
  return null;
}

export const replaceText = defineTool({
  name: "replace_text",
  description:
    "Replace `old` with `new` on a Demo Docs page, word for word from the latest draft's Now and New lines (OPS-F1-35); `old` must occur exactly once. On a Current page pass ok_permalink: the permalink of the Owner's OK in this thread (W-14).",
  input: {
    page: z.string(),
    old: z.string().min(1),
    new: z.string(),
    ok_permalink: z.string().optional(),
  },
  async handler(input, ctx) {
    const page = await readPage(ctx, input.page);
    // 1. Retired pages don't change.
    if (page.status === "Retired") return ruleRefusal("OPS-F1-09", texts.retired(page.title));
    // 2. W-14 on a Current page.
    if (page.status === "Current") {
      const r = await w14(ctx, page, input.ok_permalink);
      if (r) return r;
    }
    // 3. Word for word: the latest draft's Now and New.
    const draft = latestDraft(ctx.packet.thread);
    if (!draft || draft.now !== input.old || draft.new !== input.new) return ruleRefusal("OPS-F1-35", texts.wordForWord);
    // 4. Exactly once, counted per block.
    const n = page.blocks.reduce((s, b) => s + count(b.markdown, input.old), 0);
    if (n !== 1) return ruleRefusal("OPS-F1-35", texts.exactlyOnce(page.title, n));
    // 5. The block holding it is one this tool edits.
    const block = page.blocks.find((b) => count(b.markdown, input.old) === 1)!;
    if (!block.editable) return ruleRefusal("OPS-F1-35", texts.notEditable(block.type));
    // 6. One blocks.update of that block.
    const markdown = replaceOnce(block.markdown, input.old, input.new);
    if (ctx.dryRun) return wouldDo(`replace text in one ${block.type} block of ${page.title}`, { page: page.id, block: block.id, markdown });
    await notionOf(ctx).blocks.update({ block_id: block.id, [block.type]: { rich_text: fromMarkdown(markdown) } });
    return { page: page.id, url: page.url, title: page.title, block: block.id };
  },
});
