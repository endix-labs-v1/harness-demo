// call_log_create (SYS §5.4, §6.4; OPS-F5-01, 09, 10): T8 Spec Requirement 17.
import { z } from "zod";
import { defineTool, refused, wouldDo } from "../define";
import { lightmapUrl, notionOf, pageSummary, plainRich } from "./pages";
import { hasAny, W13_KEYS, w13Shape } from "./set_fields";
import { ruleRefusal, texts, W13_TEXT } from "./texts";

/** Body keys a Call log row never takes (OPS-F5-09), declared so they reach the handler. */
export const BODY_KEYS = ["body", "content", "children", "summary", "text", "sections", "markdown", "notes"] as const;
export const bodyShape = Object.fromEntries(BODY_KEYS.map((k) => [k, z.unknown().optional()])) as Record<(typeof BODY_KEYS)[number], z.ZodOptional<z.ZodUnknown>>;

export const callLogCreate = defineTool({
  name: "call_log_create",
  description:
    "Create one Call log row, links only (OPS-F5-01, 09): Call, Date (YYYY-MM-DD, the call's date from the mention), Who, Granola note, Slack thread, Lightmap (an umbrella key of this thread). A row with the same Granola note is returned as existing.",
  input: {
    call: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    who: z.string().min(1),
    granola_url: z.string().url(),
    thread_permalink: z.string().url(),
    lightmap_key: z.string().regex(/^END-\d+$/),
    ...w13Shape,
    ...bodyShape,
  },
  async handler(input, ctx) {
    if (hasAny(input, W13_KEYS)) return refused("W-13", W13_TEXT);
    if (hasAny(input, BODY_KEYS)) return ruleRefusal("OPS-F5-09", texts.noBody);
    const l = lightmapUrl(ctx, input.lightmap_key);
    if ("error" in l) return l;
    const notion = notionOf(ctx);
    const dataSourceId = ctx.config.notion.call_log_data_source;
    const q = await notion.dataSources.query({ data_source_id: dataSourceId, filter: { property: "Granola note", url: { equals: input.granola_url } } });
    const hit = (q?.results ?? []).find((r: any) => r?.properties?.["Granola note"]?.url === input.granola_url);
    if (hit) {
      const s = pageSummary(hit);
      return { row: s.id, url: s.url, existing: true };
    }
    const properties = {
      Call: { title: plainRich(input.call) },
      Date: { date: { start: input.date } },
      Who: { rich_text: plainRich(input.who) },
      "Granola note": { url: input.granola_url },
      "Slack thread": { url: input.thread_permalink },
      Lightmap: { url: l.url },
    };
    if (ctx.dryRun) return wouldDo(`create the Call log row ${input.call} (${input.date})`, { properties });
    const r = await notion.pages.create({ parent: { type: "data_source_id", data_source_id: dataSourceId }, properties });
    return { row: r.id, url: r.url ?? null, existing: false };
  },
});
