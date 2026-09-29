import { z } from "zod";
import { defineTool, wouldDo } from "../define";
import { ISSUE_KEY } from "./issues";
import { fencedIssue, updateIssue } from "./mutations";
import { manyDoneWhen, noDoneWhen, ruleRefused } from "./texts";

const DONE_WHEN = /^Done when: (.*?):( \S+)?$/;

/**
 * Rewrites the one `Done when:` line to `Done when: <output>: <link>`; every other
 * character stays. Null when the description has no such line; "many" for more than one.
 */
export function rewriteDoneWhen(description: string, link: string): string | null | "many" {
  const parts = description.split("\n");
  let at = -1;
  for (let i = 0; i < parts.length; i++) {
    const cr = parts[i].endsWith("\r");
    const line = cr ? parts[i].slice(0, -1) : parts[i];
    if (DONE_WHEN.test(line)) {
      if (at >= 0) return "many";
      at = i;
    }
  }
  if (at < 0) return null;
  const cr = parts[at].endsWith("\r");
  const line = cr ? parts[at].slice(0, -1) : parts[at];
  const m = DONE_WHEN.exec(line)!;
  parts[at] = `Done when: ${m[1]}: ${link}${cr ? "\r" : ""}`;
  return parts.join("\n");
}

/** SYS §5.3 `fill_done_when` (T7 Spec Req 11; OPS-F0-13). W-11. */
export const fillDoneWhen = defineTool({
  name: "fill_done_when",
  description: "OPS-F0-13: rewrite a step's 'Done when: <output>:' line with the output's link (a permalink or URL). Refuses an issue with no such line (an umbrella, a check issue). Wall W-11.",
  input: { issue: z.string().regex(ISSUE_KEY), link: z.string().regex(/^https:\/\/\S+$/) },
  async handler(input, ctx) {
    const f = await fencedIssue(ctx, input.issue);
    if ("refusal" in f) return f.refusal;
    const issue = f.issue;
    const next = rewriteDoneWhen(issue.description, input.link);
    if (next === null) return ruleRefused("OPS-F0-13", noDoneWhen(issue.key));
    if (next === "many") return ruleRefused("OPS-F0-13", manyDoneWhen(issue.key));
    if (ctx.dryRun) return wouldDo(`fill the Done when line of ${issue.key} with ${input.link}`, { description: next });
    if (next !== issue.description) await updateIssue(ctx, issue.id, { description: next });
    return { key: issue.key, url: issue.url, done_when: next.split("\n").find((l) => l.startsWith("Done when: ")) ?? null };
  },
});
