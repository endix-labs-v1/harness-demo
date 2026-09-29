// list_feeds (SYS §5.4, §6.4): the page's Feeds relation, the synced side of Written from
// (T8 Spec Requirement 15). It writes nothing.
import { z } from "zod";
import { defineTool } from "../define";
import { parsePageId } from "../../clients/notion";
import { notionOf, pageSummary } from "./pages";

/** Every related page ID of a relation property, paging past the page object's 25. */
async function relationIds(notion: any, pageId: string, prop: any): Promise<string[]> {
  const first: string[] = (prop?.relation ?? []).map((r: any) => r.id);
  if (!prop?.has_more) return first;
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const r = await notion.pages.properties.retrieve({ page_id: pageId, property_id: prop.id, start_cursor: cursor, page_size: 100 });
    for (const item of r?.results ?? []) if (item?.relation?.id) out.push(item.relation.id);
    cursor = r?.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return out;
}

export const listFeeds = defineTool({
  name: "list_feeds",
  description: "The pages written from this page (its Feeds, the synced side of Written from): title, Status, Owner names and URL of each.",
  input: { page: z.string() },
  async handler(input, ctx) {
    const notion = notionOf(ctx);
    const id = parsePageId(input.page);
    const p = await notion.pages.retrieve({ page_id: id });
    if (!p) throw new Error(`No Notion page ${id}`);
    const ids = await relationIds(notion, id, p.properties?.Feeds);
    const feeds = [];
    for (const fid of ids) {
      const f = pageSummary(await notion.pages.retrieve({ page_id: fid }));
      feeds.push({ page: f.id, title: f.title, status: f.status, owners: f.ownerNames, url: f.url });
    }
    return { page: id, feeds };
  },
});
