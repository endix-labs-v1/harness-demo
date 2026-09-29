// add_checked_against (SYS §5.4, §6.4; OPS-F0-43): T8 Spec Requirement 13. As of and
// Last change stay as they are.
import { z } from "zod";
import { parsePageId } from "../../clients/notion";
import { defineTool } from "../define";
import { appendChangeLogBullet, notionOf, readPage, titleOf } from "./pages";
import { checkedAgainstLine } from "./texts";

export const addCheckedAgainst = defineTool({
  name: "add_checked_against",
  description:
    "Append `YYYY-MM-DD · Checked against <changed page> (<origin key>): no change, <why>` under the page's Change log (OPS-F0-43). As of and Last change are not touched.",
  input: {
    page: z.string(),
    changed_page: z.string(),
    origin_key: z.string().regex(/^END-\d+$/),
    why: z.string().min(1),
  },
  async handler(input, ctx) {
    const page = await readPage(ctx, input.page);
    const changed = await notionOf(ctx).pages.retrieve({ page_id: parsePageId(input.changed_page) });
    if (!changed) throw new Error(`No Notion page ${input.changed_page}`);
    const line = checkedAgainstLine(ctx.today(), titleOf(changed.properties), input.origin_key, input.why);
    return appendChangeLogBullet(ctx, page, line);
  },
});
