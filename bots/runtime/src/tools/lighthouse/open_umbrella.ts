// open_umbrella (SYS §5.2, T6 Spec Req 9 to 12): input rules, then W-18, W-17, W-16,
// W-11 in that order; the first that fails returns its refusal and nothing is written.
import { z } from "zod";
import { defineTool, refused, wouldDo, type ToolContext } from "../define";
import { allowedSteps, loadCatalogue } from "./catalogue";
import { buildDescription, buildLightmapReply, type DescriptionInput } from "./lightmap";
import { TASK_ROW, W17, W18, w16 } from "./texts";
import { hasDecisionLine, nextDryKey, permalinkChannel, threadMessages } from "./threads";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const RULE_ID = /^(OPS|CODE|PROD|BD|GTM|RES|CO)-[A-Z0-9]+-\d+$/;

export const openUmbrellaInput = {
  variant: z.string().min(1),
  ask: z.string().min(1),
  asker: z.string().min(1),
  thread_permalink: z.string().min(1),
  source: z.string().min(1).optional(),
  origin_key: z.string().regex(/^END-\d+$/).optional(),
  lightmap: z
    .object({
      task_row: z.string(),
      steps: z.array(z.string()).min(1),
      read_first: z.array(z.string().min(1)).min(1),
      outputs: z.array(z.string().min(1)).min(1),
      closes_when: z.string().min(1).regex(/^[^\n]+$/, "one line"),
    })
    .strict(),
  when: z
    .object({
      due_date: z.string().regex(DAY).optional(),
      blocked_by: z.string().regex(/^END-\d+$/).optional(),
      check_date: z.string().regex(DAY).optional(),
      waits_on: z.string().optional(),
    })
    .strict()
    .optional(),
  rule_id: z.string().regex(RULE_ID).optional(),
};
type Input = z.infer<z.ZodObject<typeof openUmbrellaInput>>;

const MUTATION = `mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier url project { id } } } }`;

function inputError(message: string) {
  return { error: `input: ${message}` };
}

/** W-17: exactly one when; a check date needs what it waits on. */
function oneWhen(w: Input["when"]): boolean {
  if (!w) return false;
  const whens = [w.due_date, w.blocked_by, w.check_date].filter((x) => x !== undefined).length;
  if (whens !== 1) return false;
  if (w.check_date !== undefined) return !!w.waits_on && w.waits_on.trim().length > 0;
  return w.waits_on === undefined;
}

/** W-18: every #demo-ideas thread this umbrella would come from has a person's Go: or Later: line. */
async function w18Passes(ctx: ToolContext, input: Input): Promise<boolean> {
  const threads: string[] = [];
  for (const p of [input.source, input.thread_permalink]) if (p && permalinkChannel(ctx, p) === "ideas") threads.push(p);
  if (ctx.event.channel === "demo-ideas" && ctx.event.permalink) threads.push(ctx.event.permalink);
  if (!threads.length) return true;
  for (const t of new Set(threads)) {
    const messages = await threadMessages(ctx, t);
    if (!hasDecisionLine(messages)) return false;
  }
  return true;
}

export const openUmbrella = defineTool({
  name: "open_umbrella",
  description:
    "Open the umbrella of one piece in the project Harness demo: title '<variant> · <ask>', the SYS §6.1 description with its lightmap, label Lightmap (F7: and Later), state Todo. Holds W-18 (an idea thread needs a person's Go: or Later: line), W-17 (F7: exactly one when), W-16 (only steps of the variant in steps.json) and W-11 (the project is always Harness demo). Returns key, url and the lightmap_reply to post.",
  input: openUmbrellaInput,
  async handler(input, ctx) {
    const cat = loadCatalogue();
    const v = cat.variants[input.variant];
    const isF7 = /^F7\./.test(input.variant);
    // Input rules (T6 Spec Req 9).
    if (input.lightmap.task_row !== TASK_ROW) return inputError(`lightmap.task_row must be "${TASK_ROW}".`);
    if (v && !v.umbrella) return { error: `${input.variant} opens no umbrella (steps.json).` };
    if (input.when && !isF7) return inputError("when is only for F7 variants.");
    if (input.variant === "F2.3" && !input.rule_id) return inputError("rule_id is required for F2.3.");
    if (input.variant !== "F2.3" && input.rule_id) return inputError("rule_id is only for F2.3.");
    // 1. W-18
    if (!(await w18Passes(ctx, input))) return refused("W-18", W18);
    // 2. W-17
    if (isF7 && !oneWhen(input.when)) return refused("W-17", W17);
    // 3. W-16
    const allowed = new Set(allowedSteps(cat, input.variant));
    const bad = input.lightmap.steps.find((id) => !allowed.has(id));
    if (bad !== undefined) return refused("W-16", w16(bad, input.variant));
    // 4. W-11: the create always names the demo project and team; no input can name another.
    const { project_id, team_id, labels, states } = ctx.config.linear;
    if (!project_id || !team_id) return { error: "Config linear.project_id or linear.team_id is empty; an umbrella opens only in the project Harness demo (W-11)." };
    const labelIds = isF7 ? [labels.Lightmap, labels.Later] : [labels.Lightmap];
    const missing = [...(labels.Lightmap ? [] : ["linear.labels.Lightmap"]), ...(isF7 && !labels.Later ? ["linear.labels.Later"] : []), ...(states.Todo ? [] : ["linear.states.Todo"])];
    // A live create needs them; a dry run (the eval) names what is missing and goes on.
    if (missing.length && !ctx.dryRun) return { error: `Config ${missing.join(", ")} is empty (T2's setup fills it).` };

    const d: DescriptionInput = {
      variant: input.variant,
      asker: input.asker,
      today: ctx.today(),
      thread_permalink: input.thread_permalink,
      source: input.source,
      origin_key: input.origin_key,
      waits_on: input.when?.check_date !== undefined ? input.when.waits_on : undefined,
      rule_id: input.rule_id,
      lightmap: input.lightmap,
    };
    const title = `${input.variant} · ${input.ask}`;
    const description = buildDescription(cat, d);
    const create = { teamId: team_id, projectId: project_id, title, description, labelIds, stateId: states.Todo };
    if (ctx.dryRun) {
      const { key, url } = nextDryKey(ctx);
      return wouldDo(`create umbrella ${title}`, {
        key,
        url,
        lightmap_reply: buildLightmapReply(cat, { ...d, key, url, ask: input.ask }),
        title,
        ...(missing.length ? { config_missing: missing } : {}),
      });
    }
    const data = await ctx.linear(MUTATION, { input: create });
    const issue = data?.issueCreate?.issue as { identifier?: string; url?: string } | undefined;
    if (!data?.issueCreate?.success || !issue?.identifier || !issue.url) return { error: "Linear issueCreate returned no issue." };
    return { key: issue.identifier, url: issue.url, lightmap_reply: buildLightmapReply(cat, { ...d, key: issue.identifier, url: issue.url, ask: input.ask }) };
  },
});
