import { Client } from "@notionhq/client";
import { DryRunWriteError, refused, type Refusal, type ToolContext } from "../tools/define";

const NOTION_WRITES: Record<string, string[]> = {
  pages: ["create", "update", "updateMarkdown", "move"],
  blocks: ["update", "delete"],
  "blocks.children": ["append"],
  dataSources: ["update"],
};

function blockWrites<T extends object>(obj: T, path: string, dryRun: boolean): T {
  return new Proxy(obj, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target) as unknown;
      if (typeof prop !== "string") return v;
      const here = path ? `${path}.${prop}` : prop;
      if (typeof v === "function") {
        if (dryRun && (NOTION_WRITES[path] ?? []).includes(prop)) {
          return async () => {
            throw new DryRunWriteError(`dry run: ${here} blocked`);
          };
        }
        return (v as Function).bind(target);
      }
      if (v && typeof v === "object" && (here in NOTION_WRITES || Object.keys(NOTION_WRITES).some((k) => k.startsWith(`${here}.`)))) {
        return blockWrites(v as object, here, dryRun);
      }
      return v;
    },
  });
}

/** A Notion client on Notion-Version 2025-09-03, its write methods blocked in dry run (Req 20). */
export function makeNotion(token: string, opts: { dryRun: boolean }): Client {
  return guardNotion(new Client({ auth: token, notionVersion: "2025-09-03" }), opts);
}

export function guardNotion<T extends object>(client: T, opts: { dryRun: boolean }): T {
  return blockWrites(client, "", opts.dryRun);
}

/** A 32-hex ID with or without dashes, or a Notion URL (its last 32 hex characters). */
export function parsePageId(input: string): string {
  const hex = input.replace(/-/g, "").match(/[0-9a-f]{32}/gi);
  if (!hex) throw new Error(`Not a Notion page ID or URL: ${input}`);
  const h = hex[hex.length - 1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function titleOf(props: Record<string, any>): string {
  for (const p of Object.values(props ?? {})) if (p?.type === "title") return (p.title ?? []).map((t: any) => t.plain_text ?? "").join("");
  return "";
}

function flatten(p: any): unknown {
  switch (p?.type) {
    case "title":
    case "rich_text":
      return (p[p.type] ?? []).map((t: any) => t.plain_text ?? "").join("");
    case "select":
    case "status":
      return p[p.type]?.name ?? null;
    case "multi_select":
      return (p.multi_select ?? []).map((o: any) => o.name);
    case "people":
      return (p.people ?? []).map((u: any) => u.name ?? u.id);
    case "date":
      return p.date?.start ?? null;
    case "relation":
      return (p.relation ?? []).map((r: any) => ({ id: r.id, title: r.title ?? null }));
    case "url":
      return p.url ?? null;
    default:
      return p?.[p?.type] ?? null;
  }
}

function flattenAll(props: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props ?? {})) out[k] = flatten(v);
  return out;
}

type NotionCtx = Pick<ToolContext, "notion" | "config" | "def"> & { reads?: ToolContext["reads"] };

/** Pages of the demo Docs data source whose title or markdown holds a word of `text` (Req 15). */
export async function notionSearch(ctx: NotionCtx, text: string) {
  const notion = ctx.notion as any;
  if (!notion) throw new Error("No Notion token for this bot.");
  const words = text.split(/\s+/).filter((w) => w.length >= 3).map((w) => w.toLowerCase());
  const pages: any[] = [];
  let cursor: string | undefined;
  do {
    const r = await notion.dataSources.query({ data_source_id: ctx.config.notion.docs_data_source, start_cursor: cursor });
    pages.push(...(r.results ?? []));
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  const out: any[] = [];
  for (const page of pages) {
    const props = flattenAll(page.properties);
    const title = titleOf(page.properties);
    const status = (props.Status as string) ?? null;
    if (ctx.def.notionCurrentOnly && status !== "Current") continue;
    let hit = words.length === 0 || words.some((w) => title.toLowerCase().includes(w));
    if (!hit) {
      const md = await notion.pages.retrieveMarkdown({ page_id: page.id }).catch(() => ({ markdown: "" }));
      const body = String(md?.markdown ?? "").toLowerCase();
      hit = words.some((w) => body.includes(w));
    }
    if (hit) out.push({ id: page.id, title, status, type: props.Type ?? null, owner: props.Owner ?? null, url: page.url });
  }
  return { pages: out };
}

export function w20(title: string, status: string): string {
  return `Refused by the harness (W-20, OPS-F4-09): ${title} is ${status}; answers come from Current pages only.`;
}

/** Properties flattened and the page as markdown (Req 15); W-20 for Current-only bots. */
export async function notionRead(ctx: NotionCtx, page: string): Promise<Record<string, unknown> | Refusal> {
  const id = parsePageId(page);
  const fixture = ctx.reads?.notion_read;
  if (fixture) {
    const hit = fixture[id] ?? fixture[id.replace(/-/g, "")] ?? fixture[page];
    if (hit) return hit as Record<string, unknown>;
  }
  const notion = ctx.notion as any;
  if (!notion) throw new Error("No Notion token for this bot.");
  const p = await notion.pages.retrieve({ page_id: id });
  const properties = flattenAll(p.properties);
  const title = titleOf(p.properties);
  if (ctx.def.notionCurrentOnly && properties.Status !== "Current") return refused("W-20", w20(title, String(properties.Status ?? "unknown")));
  const md = await notion.pages.retrieveMarkdown({ page_id: id });
  return { id: p.id, url: p.url, title, properties, markdown: md?.markdown ?? "" };
}
