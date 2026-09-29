// add_change_log_line (SYS §5.4, §6.4; OPS-F1-13, OPS-F1-30): T8 Spec Requirement 12.
import { z } from "zod";
import { defineTool, wouldDo } from "../define";
import { changeLogCheck, notionOf, plainRich, readPage, appendChangeLogBullet } from "./pages";
import { changeLogLine, ruleRefusal, texts } from "./texts";

export const addChangeLogLine = defineTool({
  name: "add_change_log_line",
  description:
    "Append `YYYY-MM-DD · <what> · <why> · <umbrella key>` under the page's Change log, and set As of today and Last change to that line. Not on a Draft page (OPS-F1-30).",
  input: {
    page: z.string(),
    what: z.string().min(1),
    why: z.string().min(1),
    umbrella_key: z.string().regex(/^END-\d+$/),
  },
  async handler(input, ctx) {
    const page = await readPage(ctx, input.page);
    if (page.status === "Draft") return ruleRefusal("OPS-F1-30", texts.draftNoChangeLog(page.title));
    const today = ctx.today();
    const line = changeLogLine(today, input.what, input.why, input.umbrella_key);
    const check = changeLogCheck(page);
    if (check) return check;
    if (ctx.dryRun) return wouldDo(`append to the Change log of ${page.title} and set As of and Last change: ${line}`, { page: page.id, line });
    const r = await appendChangeLogBullet(ctx, page, line);
    if ("refused" in r) return r;
    await notionOf(ctx).pages.update({
      page_id: page.id,
      properties: { "As of": { date: { start: today } }, "Last change": { rich_text: plainRich(line) } },
    });
    return { page: page.id, url: page.url, line };
  },
});
