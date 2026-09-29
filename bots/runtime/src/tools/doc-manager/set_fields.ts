// set_fields (SYS §5.4, WALL W-13): T8 Spec Requirements 9 and 14.
import { z } from "zod";
import { parsePageId } from "../../clients/notion";
import { defineTool, refused, wouldDo } from "../define";
import { lightmapUrl, notionOf } from "./pages";
import { W13_TEXT } from "./texts";

/** Keys W-13 refuses, declared so they reach the handler (T8 Spec Requirement 9). */
export const W13_KEYS = ["status", "Status", "approved_by", "approvedBy", "Approved by", "owner", "Owner"] as const;
export const w13Shape = Object.fromEntries(W13_KEYS.map((k) => [k, z.unknown().optional()])) as Record<(typeof W13_KEYS)[number], z.ZodOptional<z.ZodUnknown>>;

export function hasAny(input: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((k) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined);
}

export const setFields = defineTool({
  name: "set_fields",
  description:
    "Set a Demo Docs page's Lightmap (from an umbrella key of this thread) and/or Written from (page IDs; replaces the relation). Status, Approved by and Owner are refused (W-13).",
  input: {
    page: z.string(),
    lightmap_key: z.string().regex(/^END-\d+$/).optional(),
    written_from: z.array(z.string()).optional(),
    ...w13Shape,
  },
  async handler(input, ctx) {
    if (hasAny(input, W13_KEYS)) return refused("W-13", W13_TEXT);
    if (input.lightmap_key === undefined && input.written_from === undefined) return { error: "input: pass lightmap_key or written_from" };
    const id = parsePageId(input.page);
    const properties: Record<string, unknown> = {};
    if (input.lightmap_key !== undefined) {
      const l = lightmapUrl(ctx, input.lightmap_key);
      if ("error" in l) return l;
      properties.Lightmap = { url: l.url };
    }
    if (input.written_from !== undefined) {
      properties["Written from"] = { relation: input.written_from.map((p) => ({ id: parsePageId(p) })) };
      properties["Source page"] = { checkbox: input.written_from.length === 0 };
    }
    if (ctx.dryRun) return wouldDo(`set ${Object.keys(properties).join(", ")} on page ${id}`, { page: id, properties });
    const r = await notionOf(ctx).pages.update({ page_id: id, properties });
    return { page: id, url: r?.url ?? null, set: Object.keys(properties) };
  },
});
