// create_page (SYS §5.4, WALL W-13, OPS-F1-04): T8 Spec Requirement 10.
import { z } from "zod";
import { parsePageId } from "../../clients/notion";
import { defineTool, refused, wouldDo } from "../define";
import { fromMarkdown } from "./richtext";
import { lightmapUrl, notionOf, plainRich } from "./pages";
import { hasAny, W13_KEYS, w13Shape } from "./set_fields";
import { ruleRefusal, texts, W13_TEXT } from "./texts";

export const CALL_LOG_KEYS = ["call", "date", "who", "granola_url", "granola_note", "thread_permalink", "slack_thread", "linear_issues", "changed_docs"] as const;
const callLogShape = Object.fromEntries(CALL_LOG_KEYS.map((k) => [k, z.unknown().optional()])) as Record<(typeof CALL_LOG_KEYS)[number], z.ZodOptional<z.ZodUnknown>>;

export const DOC_TYPES = ["Spec", "Code doc", "FAQ", "Rules", "Plan"];

/** One block per non-empty line: `- ` starts a bullet, anything else is a paragraph. */
export function sectionBlocks(sections: { heading: string; text: string }[]) {
  const children: unknown[] = [];
  const block = (type: string, text: string) => ({ object: "block", type, [type]: { rich_text: fromMarkdown(text) } });
  for (const s of sections) {
    children.push(block("heading_2", s.heading));
    for (const line of s.text.split("\n")) {
      if (line.trim() === "") continue;
      if (line.startsWith("- ")) children.push(block("bulleted_list_item", line.slice(2)));
      else children.push(block("paragraph", line));
    }
  }
  children.push({ object: "block", type: "heading_2", heading_2: { rich_text: fromMarkdown("Change log") } });
  return children;
}

export const createPage = defineTool({
  name: "create_page",
  description:
    "Create a Demo Docs page as Draft, Owner Henry, As of today, Lightmap from an umbrella key of this thread, Written from the given pages, the sections word for word and an empty Change log (OPS-F1-04). Status, Approved by and Owner are refused (W-13); Call log rows go through call_log_create.",
  input: {
    title: z.string().min(1),
    domain: z.enum(["Product", "Code", "GTM", "Operations"]),
    type: z.string(),
    lightmap_key: z.string().regex(/^END-\d+$/),
    written_from: z.array(z.string()),
    sections: z.array(z.object({ heading: z.string().min(1), text: z.string() })).min(1),
    ...w13Shape,
    ...callLogShape,
  },
  async handler(input, ctx) {
    if (hasAny(input, W13_KEYS)) return refused("W-13", W13_TEXT);
    if (hasAny(input, CALL_LOG_KEYS) || input.type === "Call log") return ruleRefusal("OPS-F5-01", texts.callLogByCreatePage);
    if (!DOC_TYPES.includes(input.type)) return { error: `input: type must be one of ${DOC_TYPES.join(", ")}` };
    const l = lightmapUrl(ctx, input.lightmap_key);
    if ("error" in l) return l;
    const notion = notionOf(ctx);
    const dataSourceId = ctx.config.notion.docs_data_source;
    const ds = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
    const statusType = ds?.properties?.Status?.type === "select" ? "select" : "status";
    const henry = ctx.config.people.henry.notion_user_id;
    if (!henry) throw new Error("Config people.henry.notion_user_id is empty.");
    const properties = {
      Name: { title: plainRich(input.title) },
      Domain: { select: { name: input.domain } },
      Type: { select: { name: input.type } },
      Status: { [statusType]: { name: "Draft" } },
      Owner: { people: [{ id: henry }] },
      "As of": { date: { start: ctx.today() } },
      Lightmap: { url: l.url },
      "Written from": { relation: input.written_from.map((p) => ({ id: parsePageId(p) })) },
      "Source page": { checkbox: input.written_from.length === 0 },
    };
    const children = sectionBlocks(input.sections);
    if (ctx.dryRun) return wouldDo(`create the Draft page ${input.title} in Demo · Endix Docs`, { title: input.title, properties, blocks: children.length });
    const r = await notion.pages.create({ parent: { type: "data_source_id", data_source_id: dataSourceId }, properties, children });
    return { page: r.id, url: r.url ?? null, title: input.title };
  },
});
