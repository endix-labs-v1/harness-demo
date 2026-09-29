// call_log_update (SYS §5.4; OPS-F5-05, 09): T8 Spec Requirement 18.
import { z } from "zod";
import { parsePageId } from "../../clients/notion";
import { defineTool, refused, wouldDo } from "../define";
import { notionOf, pageSummary, plainRich } from "./pages";
import { hasAny, W13_KEYS, w13Shape } from "./set_fields";
import { BODY_KEYS, bodyShape } from "./call_log_create";
import { ruleRefusal, texts, W13_TEXT } from "./texts";

const ENTRY = /^(END-\d+|https:\/\/[A-Za-z0-9-]+\.slack\.com\/archives\/\S+)$/;
const norm = (id: string) => id.replace(/-/g, "").toLowerCase();

export const callLogUpdate = defineTool({
  name: "call_log_update",
  description:
    "Add Linear keys (END-<n>) or Slack thread permalinks to a Call log row's Linear issues, and/or pages to its Changed docs. No body, ever (OPS-F5-09).",
  input: {
    row: z.string(),
    linear_issues_add: z.array(z.string().regex(ENTRY)).optional(),
    changed_docs_add: z.array(z.string()).optional(),
    ...w13Shape,
    ...bodyShape,
  },
  async handler(input, ctx) {
    if (hasAny(input, W13_KEYS)) return refused("W-13", W13_TEXT);
    if (hasAny(input, BODY_KEYS)) return ruleRefusal("OPS-F5-09", texts.noBody);
    if (!input.linear_issues_add?.length && !input.changed_docs_add?.length) return { error: "input: pass linear_issues_add or changed_docs_add" };
    const notion = notionOf(ctx);
    const id = parsePageId(input.row);
    const p = await notion.pages.retrieve({ page_id: id });
    const s = pageSummary(p);
    if (!s.parentDataSource || norm(s.parentDataSource) !== norm(ctx.config.notion.call_log_data_source)) {
      return { error: "input: row is not a row of the Call log" };
    }
    const properties: Record<string, unknown> = {};
    const current = (s.props["Linear issues"]?.rich_text ?? []).map((t: any) => t.plain_text ?? t.text?.content ?? "").join("");
    const entries = current ? current.split(", ").filter((x: string) => x !== "") : [];
    for (const e of input.linear_issues_add ?? []) if (!entries.includes(e)) entries.push(e);
    const linearIssues = entries.join(", ");
    if (input.linear_issues_add?.length) properties["Linear issues"] = { rich_text: plainRich(linearIssues) };
    if (input.changed_docs_add?.length) {
      const rel: string[] = (s.props["Changed docs"]?.relation ?? []).map((r: any) => r.id);
      for (const d of input.changed_docs_add) {
        const did = parsePageId(d);
        if (!rel.some((x) => norm(x) === norm(did))) rel.push(did);
      }
      properties["Changed docs"] = { relation: rel.map((x) => ({ id: x })) };
    }
    if (ctx.dryRun) return wouldDo(`update the Call log row ${s.title}`, { row: id, properties });
    await notion.pages.update({ page_id: id, properties });
    return { row: id, url: s.url, linear_issues: linearIssues };
  },
});
