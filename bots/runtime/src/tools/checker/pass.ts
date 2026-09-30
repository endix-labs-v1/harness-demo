import { unwrapLink } from "../shared";
import { readThread } from "../../clients/slack";
import { trimForGuard } from "../../guard/person-line";
import type { ContextPacket } from "../../packet/build";
import type { ToolContext } from "../define";
import { listIdeaThreads, type IdeaThread } from "../idea-threads";

export type Finding =
  | { kind: "due"; task_key: string; title: string; thread: string; owner: "Henry" }
  | { kind: "check_date"; task_key: string; event: string; thread: string; owner: "Henry" }
  | { kind: "hand_on"; to: "lighthouse"; step_id: "OPS-F7-08"; task_key: string; thread: string }
  | { kind: "hand_on"; to: "question-idea"; step_id: "OPS-F7-10"; task_key: string; thread: string; idea_thread: string }
  | { kind: "quiet_idea"; thread: string }
  | { kind: "waiting_ok"; task_key: string; thread: string };

const KIND_ORDER: Finding["kind"][] = ["due", "check_date", "hand_on", "quiet_idea", "waiting_ok"];
const CLOSED_NAMES = new Set(["Done", "Canceled"]);
const CLOSED_TYPES = ["completed", "canceled"];

const isOpen = (n: any) => !CLOSED_NAMES.has(n?.state?.name) && !CLOSED_TYPES.includes(n?.state?.type);
const inProject = (ctx: ToolContext, n: any) => !n?.project?.id || n.project.id === ctx.config.linear.project_id;
const lineOf = (description: string | null | undefined, label: string) => {
  const v = new RegExp(`^${label}: *(.+?) *$`, "m").exec(String(description ?? ""))?.[1] ?? null;
  return v && label === "Thread" ? unwrapLink(v) : v;
};

/**
 * The Later tasks of the project with their inverse `blocks` relations, in one query of
 * T9's (T5's ISSUE_FIELDS has only the outgoing ones). The field names `inverseRelations`,
 * `type`, `issue { identifier state { name type } }` are (unverified) until C-18.
 */
export const LATER_TASKS_QUERY =
  "query CheckerLaterTasks($filter: IssueFilter) { issues(filter: $filter, first: 100) { nodes { identifier title description dueDate state { name type } labels { nodes { name } } assignee { name } project { id } inverseRelations { nodes { type issue { identifier state { name type } } } } } } }";

export const ITEM_LISTS_QUERY =
  "query CheckerItemLists($filter: IssueFilter) { issues(filter: $filter, first: 50) { nodes { identifier title description state { name type } project { id } } } }";

async function laterFindings(ctx: ToolContext): Promise<Finding[]> {
  const today = ctx.today();
  const data = await ctx.linear(LATER_TASKS_QUERY, {
    filter: { project: { id: { eq: ctx.config.linear.project_id } }, labels: { name: { eq: "Later" } }, state: { type: { nin: CLOSED_TYPES } } },
  });
  const out: Finding[] = [];
  for (const n of (data?.issues?.nodes ?? []) as any[]) {
    if (!isOpen(n) || !inProject(ctx, n)) continue;
    if (!(n.labels?.nodes ?? []).some((l: any) => l?.name === "Later")) continue;
    const dueByDate = typeof n.dueDate === "string" && n.dueDate <= today;
    const dueByBlocker = (n.inverseRelations?.nodes ?? []).some(
      (r: any) => r?.type === "blocks" && (r?.issue?.state?.name === "Done" || r?.issue?.state?.type === "completed"),
    );
    if (!dueByDate && !dueByBlocker) continue;
    const key: string = n.identifier;
    const title: string = n.title ?? "";
    const thread = lineOf(n.description, "Thread");
    if (!thread) {
      ctx.log.write({ kind: "ignored", message: `warning: ${key} is due but has no Thread: line; left out of the checker's findings` });
      continue;
    }
    if (title.startsWith("F7.1 · ")) {
      const event = lineOf(n.description, "Waits on");
      out.push(event ? { kind: "check_date", task_key: key, event, thread, owner: "Henry" } : { kind: "due", task_key: key, title, thread, owner: "Henry" });
    } else if (title.startsWith("F7.2 · ")) {
      out.push({ kind: "hand_on", to: "lighthouse", step_id: "OPS-F7-08", task_key: key, thread });
    } else if (title.startsWith("F7.3 · ")) {
      const idea = (lineOf(n.description, "Source") ?? "").split(" · ")[2]?.trim();
      if (!idea) {
        ctx.log.write({ kind: "ignored", message: `warning: ${key} is due but its Source: line names no idea thread; left out of the checker's findings` });
        continue;
      }
      out.push({ kind: "hand_on", to: "question-idea", step_id: "OPS-F7-10", task_key: key, thread, idea_thread: idea });
    }
  }
  return out;
}

async function quietIdeaFindings(ctx: ToolContext): Promise<Finding[]> {
  const threads: IdeaThread[] = (ctx.reads?.list_idea_threads?.threads as IdeaThread[] | undefined) ?? (await listIdeaThreads(ctx, {}));
  const cutoff = ctx.now().getTime() - ctx.config.checker.quiet_idea_days * 24 * 60 * 60 * 1000;
  return threads
    .filter((t) => !t.decision_line && !t.closing_line && Number(t.last_activity_ts) * 1000 <= cutoff)
    .map((t) => ({ kind: "quiet_idea" as const, thread: t.permalink }));
}

async function waitingOkFindings(ctx: ToolContext): Promise<Finding[]> {
  const data = await ctx.linear(ITEM_LISTS_QUERY, {
    filter: { project: { id: { eq: ctx.config.linear.project_id } }, title: { startsWith: "F5.1 · " }, state: { type: { nin: CLOSED_TYPES } } },
  });
  const out: Finding[] = [];
  for (const n of (data?.issues?.nodes ?? []) as any[]) {
    if (!isOpen(n) || !inProject(ctx, n) || !String(n.title ?? "").startsWith("F5.1 · ")) continue;
    const thread = lineOf(n.description, "Thread");
    if (!thread) {
      ctx.log.write({ kind: "ignored", message: `warning: ${n.identifier} has no Thread: line; left out of the checker's findings` });
      continue;
    }
    const { messages } = await readThread(ctx, { permalink: thread });
    const lists = messages.filter((m) => m.author.name === "Entry agent" && m.text.startsWith('OPS-F5-02 · Items from "'));
    if (!lists.length) continue;
    const list = lists[lists.length - 1];
    const okAfter = messages.some((m) => Number(m.ts) > Number(list.ts) && m.author.kind === "person" && /^ok\b/i.test(trimForGuard(m.text)));
    if (!okAfter) out.push({ kind: "waiting_ok", task_key: n.identifier, thread });
  }
  return out;
}

const keyNum = (f: Finding) => ("task_key" in f ? Number(f.task_key.replace(/^END-/, "")) : Number.MAX_SAFE_INTEGER);

/** SYS §5.6's pass, reads only (T9 Req 15): due Later tasks, quiet ideas, item lists waiting for an OK. */
export async function findings(ctx: ToolContext): Promise<Finding[]> {
  const all = [...(await laterFindings(ctx)), ...(await quietIdeaFindings(ctx)), ...(await waitingOkFindings(ctx))];
  return all
    .map((f, i) => ({ f, i }))
    .sort((a, b) => KIND_ORDER.indexOf(a.f.kind) - KIND_ORDER.indexOf(b.f.kind) || keyNum(a.f) - keyNum(b.f) || a.i - b.i)
    .map((x) => x.f);
}

/** The E16 packet's `findings` (T5's BotDef.packetExtras). */
export async function checkerPacketExtras(_packet: ContextPacket, ctx: ToolContext): Promise<Record<string, unknown>> {
  return { findings: await findings(ctx) };
}
