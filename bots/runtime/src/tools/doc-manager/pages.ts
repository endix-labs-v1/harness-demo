// Reading a Demo Docs page and appending to its Change log (T8 Spec Requirement 6).
import type { DemoConfig } from "../../core/config";
import { parsePageId } from "../../clients/notion";
import { wouldDo, type ToolContext } from "../define";
import { fromMarkdown, inSubset, toMarkdown } from "./richtext";
import { ruleRefusal, texts, type RuleRefusal } from "./texts";

export const EDITABLE = new Set(["heading_1", "heading_2", "heading_3", "paragraph", "bulleted_list_item", "numbered_list_item"]);
const HEADINGS = new Set(["heading_1", "heading_2", "heading_3"]);

export interface PageBlock {
  id: string;
  type: string;
  markdown: string;
  editable: boolean;
}

export interface Page {
  id: string;
  url: string;
  title: string;
  status: string | null;
  ownerIds: string[];
  ownerNames: string[];
  parentDataSource: string | null;
  props: Record<string, any>;
  blocks: PageBlock[];
}

export function notionOf(ctx: Pick<ToolContext, "notion" | "def">): any {
  if (!ctx.notion) throw new Error(`${ctx.def.displayName} has no Notion token.`);
  return ctx.notion as any;
}

export function titleOf(props: Record<string, any>): string {
  for (const p of Object.values(props ?? {})) if (p?.type === "title") return (p.title ?? []).map((t: any) => t.plain_text ?? t.text?.content ?? "").join("");
  return "";
}

/** The option name of a `status` or `select` property (C-17 records which one Status is). */
export function optionName(p: any): string | null {
  if (!p) return null;
  return p.status?.name ?? p.select?.name ?? null;
}

export function pageSummary(p: any) {
  const props = p?.properties ?? {};
  return {
    id: p.id as string,
    url: (p.url as string) ?? "",
    title: titleOf(props),
    status: optionName(props.Status),
    ownerIds: ((props.Owner?.people ?? []) as any[]).map((u) => u.id as string),
    ownerNames: ((props.Owner?.people ?? []) as any[]).map((u) => (u.name as string) ?? u.id),
    parentDataSource: (p.parent?.data_source_id as string) ?? null,
    props,
  };
}

async function listBlocks(notion: any, blockId: string): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  do {
    const r = await notion.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 100 });
    out.push(...(r?.results ?? []));
    cursor = r?.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return out;
}

function blockOf(b: any): PageBlock {
  const rt = b?.[b?.type]?.rich_text;
  const hasText = Array.isArray(rt);
  return {
    id: b.id,
    type: b.type,
    markdown: hasText ? toMarkdown(rt) : "",
    editable: EDITABLE.has(b.type) && hasText && inSubset(rt),
  };
}

/** The page's properties and its top-level blocks in order (T8 Spec Requirement 6). */
export async function readPage(ctx: Pick<ToolContext, "notion" | "def">, pageId: string): Promise<Page> {
  const notion = notionOf(ctx);
  const id = parsePageId(pageId);
  const p = await notion.pages.retrieve({ page_id: id });
  if (!p) throw new Error(`No Notion page ${id}`);
  const blocks = (await listBlocks(notion, id)).map(blockOf);
  return { ...pageSummary(p), blocks };
}

/** The check of appendChangeLogBullet: the last heading is `## Change log`. */
export function changeLogCheck(page: Page): RuleRefusal | null {
  const headings = page.blocks.filter((b) => HEADINGS.has(b.type));
  const last = headings[headings.length - 1];
  if (!last || last.type !== "heading_2" || last.markdown.trim() !== "Change log") return ruleRefusal("OPS-F1-13", texts.noChangeLog(page.title));
  return null;
}

export function bullet(line: string) {
  return { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: fromMarkdown(line) } };
}

/**
 * Appends one bullet at the end of the page, which is the end of its `## Change log`
 * (SYS §6.4). Refused with OPS-F1-13 when the page's last heading isn't that section.
 */
export async function appendChangeLogBullet(ctx: ToolContext, page: Page, line: string) {
  const refusal = changeLogCheck(page);
  if (refusal) return refusal;
  if (ctx.dryRun) return wouldDo(`append to the Change log of ${page.title}: ${line}`, { page: page.id, line });
  await notionOf(ctx).blocks.children.append({ block_id: page.id, children: [bullet(line)] });
  return { page: page.id, url: page.url, line };
}

export interface Person {
  key: string;
  name: string;
  slackUserId: string | null;
  notionUserId: string | null;
}

/** A person of `config.people` by their Notion or Slack user ID (T8 Spec Requirement 6). */
export function personOf(config: DemoConfig, by: { notionUserId: string } | { slackUserId: string }): Person | null {
  const people = (config.people ?? {}) as Record<string, any>;
  const norm = (s: string) => s.replace(/-/g, "").toLowerCase();
  for (const [key, p] of Object.entries(people)) {
    if (!p || typeof p !== "object") continue;
    const hit =
      "notionUserId" in by ? !!p.notion_user_id && norm(p.notion_user_id) === norm(by.notionUserId) : !!p.slack_user_id && p.slack_user_id === by.slackUserId;
    if (hit) return { key, name: p.name ?? key, slackUserId: p.slack_user_id || null, notionUserId: p.notion_user_id || null };
  }
  return null;
}

/** The Lightmap URL: the umbrella's Linear URL from the packet (T8 Spec Requirement 4). */
export function lightmapUrl(ctx: Pick<ToolContext, "packet">, key: string): { url: string } | { error: string } {
  const u = (ctx.packet.umbrellas ?? []).find((x) => x.key === key) as { url?: string | null; error?: string } | undefined;
  if (!u || u.error || !u.url) return { error: texts.notUmbrella(key) };
  return { url: u.url };
}

export function plainRich(content: string) {
  return [{ type: "text", text: { content } }];
}
