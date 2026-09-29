import { z } from "zod";
import { defineTool, refused, wouldDo } from "../define";
import { subIssueFlag } from "./catalogue";
import { ISSUE_KEY, lightmapSteps, shortId, variantOf } from "./issues";
import { createIssue, fencedIssue, inputError } from "./mutations";
import { stepDescription, stepTitle, treeBuilt, w16 } from "./texts";

// SYS §6.2's list, plus "Lighthouse" (proposed): F5.1's OPS-F5-04 is Lighthouse's step and has a sub-issue.
export const BY = ["entry agent", "doc manager", "task manager", "Henry", "Discussion Action", "merge Action", "Lighthouse"] as const;

/** SYS §6.2's `By:` value for a step that gets a sub-issue; "Owner" and "Henry or 서준" are Henry. Null when it isn't one. */
export function normalizeBy(by: string): (typeof BY)[number] | null {
  const t = by.trim();
  if (/^(owner|henry)\b/i.test(t)) return "Henry";
  return BY.find((b) => b.toLowerCase() === t.toLowerCase()) ?? null;
}

/** SYS §5.3 `create_steps` (T7 Spec Req 7): one sub-issue per lightmap step with an output. */
export const createSteps = defineTool({
  name: "create_steps",
  description:
    "OPS-F0-07: file one sub-issue per lightmap step under the umbrella (title '<short ID> · <output>', body 'By:' and 'Done when:', state Todo). Pass every lightmap step; steps with no sub-issue are skipped, steps already filed are listed as existing. Walls W-11, W-16.",
  input: {
    umbrella: z.string().regex(ISSUE_KEY),
    steps: z
      .array(z.object({ step_id: z.string().regex(/^OPS-[A-Z0-9]+-\d+$/), output: z.string().nullable(), by: z.string() }).strict())
      .min(1),
  },
  async handler(input, ctx) {
    const f = await fencedIssue(ctx, input.umbrella);
    if ("refusal" in f) return f.refusal;
    const umbrella = f.issue;
    const lightmap = lightmapSteps(umbrella);
    const variant = variantOf(umbrella);
    for (const s of input.steps) {
      if (!lightmap.includes(s.step_id)) return refused("W-16", w16(s.step_id, variant));
    }
    const skipped: string[] = [];
    const existing: { key: string; title: string }[] = [];
    const toCreate: { step_id: string; short: string; title: string; description: string }[] = [];
    const seen = new Set<string>();
    for (const s of input.steps) {
      if (seen.has(s.step_id)) continue;
      seen.add(s.step_id);
      const flag = subIssueFlag(s.step_id, variant);
      if (flag === null) throw inputError(`${s.step_id} is not in the step catalogue for ${variant}`);
      if (!flag) {
        skipped.push(s.step_id);
        continue;
      }
      const short = shortId(s.step_id);
      const child = umbrella.children.find((c) => c.title.startsWith(`${short} · `));
      if (child) {
        existing.push({ key: child.key, title: child.title });
        continue;
      }
      const output = (s.output ?? "").trim();
      const by = normalizeBy(s.by);
      if (!output) throw inputError(`${s.step_id} needs its output`);
      if (!by) throw inputError(`${s.step_id}: by is one of ${BY.join(", ")}`);
      toCreate.push({ step_id: s.step_id, short, title: stepTitle(short, output), description: stepDescription(by, output) });
    }
    const filedShorts = new Set([...existing.map((e) => e.title.split(" · ")[0]), ...toCreate.map((c) => c.short)]);
    const ordered = lightmap.map(shortId).filter((s) => filedShorts.has(s));
    const tree_reply = treeBuilt(umbrella.key, ordered.length, ordered);
    if (ctx.dryRun) {
      return wouldDo(`create ${toCreate.length} sub-issues under ${umbrella.key}`, { titles: toCreate.map((c) => c.title), skipped, existing, tree_reply });
    }
    const created: { key: string; title: string; url: string }[] = [];
    for (const c of toCreate) {
      const issue = await createIssue(ctx, {
        teamId: ctx.config.linear.team_id,
        projectId: ctx.config.linear.project_id,
        title: c.title,
        description: c.description,
        parentId: umbrella.id,
        stateId: ctx.config.linear.states.Todo,
      });
      created.push({ key: issue.key, title: issue.title, url: issue.url });
    }
    return { key: umbrella.key, url: umbrella.url, created, skipped, existing, tree_reply };
  },
});
