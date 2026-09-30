import { unwrapLink } from "../shared";
import type { ToolContext } from "../define";

// The issue reads of the task manager (T7 Spec Req 3). T5's getIssue lacks the
// children's descriptions and state types and the inverse relations, so this is its own
// query. Linear's field names here are unverified (C-18).

export interface ChildIssue {
  id: string;
  key: string;
  title: string;
  description: string;
  state: { name: string; type: string };
}
export interface FullIssue {
  id: string;
  key: string;
  title: string;
  url: string;
  description: string;
  dueDate: string | null;
  state: { name: string; type: string };
  labels: string[];
  assigneeId: string | null;
  projectId: string | null;
  parentKey: string | null;
  children: ChildIssue[];
  /** Relations this issue holds: `{ type, key }` of the other end. */
  relations: { type: string; key: string }[];
  /** Relations other issues hold on this one: `{ type, key, state }` of the holder (a `blocks` here blocks this issue). */
  inverseRelations: { type: string; key: string; state: { name: string; type: string } | null }[];
  attachments: { url: string; title: string }[];
}

export const ISSUE_FULL_QUERY = `query IssueFull($key: String!) { issue(id: $key) { id identifier title url description dueDate state { name type } labels { nodes { name } } assignee { id } project { id } parent { identifier } children { nodes { id identifier title description state { name type } } } relations { nodes { type relatedIssue { identifier } } } inverseRelations { nodes { type issue { identifier state { name type } } } } attachments { nodes { url title } } } }`;

function nodes<T = any>(x: unknown): T[] {
  if (Array.isArray(x)) return x as T[];
  if (x && typeof x === "object" && Array.isArray((x as { nodes?: unknown }).nodes)) return (x as { nodes: T[] }).nodes;
  return [];
}

function st(s: any): { name: string; type: string } {
  return { name: s?.name ?? "", type: s?.type ?? "" };
}

export function normalizeIssue(raw: any): FullIssue {
  return {
    id: raw.id ?? "",
    key: raw.identifier ?? "",
    title: raw.title ?? "",
    url: raw.url ?? "",
    description: raw.description ?? "",
    dueDate: raw.dueDate ?? null,
    state: st(raw.state),
    labels: nodes<any>(raw.labels).map((l) => l?.name).filter(Boolean),
    assigneeId: raw.assignee?.id ?? null,
    projectId: raw.project?.id ?? null,
    parentKey: raw.parent?.identifier ?? null,
    children: nodes<any>(raw.children).map((c) => ({ id: c.id ?? "", key: c.identifier ?? "", title: c.title ?? "", description: c.description ?? "", state: st(c.state) })),
    relations: nodes<any>(raw.relations).map((r) => ({ type: r.type ?? "", key: r.relatedIssue?.identifier ?? "" })),
    inverseRelations: nodes<any>(raw.inverseRelations).map((r) => ({ type: r.type ?? "", key: r.issue?.identifier ?? "", state: r.issue?.state ? st(r.issue.state) : null })),
    attachments: nodes<any>(raw.attachments).map((a) => ({ url: a.url ?? "", title: a.title ?? "" })),
  };
}

/** One GraphQL read through `ctx.linear`; null when the issue isn't there. */
export async function getIssueFull(ctx: Pick<ToolContext, "linear">, key: string): Promise<FullIssue | null> {
  const data = await ctx.linear(ISSUE_FULL_QUERY, { key });
  return data?.issue ? normalizeIssue(data.issue) : null;
}

// ---- Readers of the description lines (SYS §6.1, §6.2) ----

function lines(issue: Pick<FullIssue, "description">): string[] {
  return (issue.description ?? "").split(/\r?\n/);
}

/** The permalink after `Thread: `, or null. */
export function threadOf(issue: Pick<FullIssue, "description">): string | null {
  for (const l of lines(issue)) {
    const m = /^Thread:\s*(\S+)\s*$/.exec(l.trim());
    if (m) return unwrapLink(m[1]);
  }
  return null;
}

/** The third part of the `Source:` line (`<asker> · <date> · <source>`), or null. */
export function sourceOf(issue: Pick<FullIssue, "description">): string | null {
  for (const l of lines(issue)) {
    const t = l.trim();
    if (!t.startsWith("Source:")) continue;
    const parts = t.slice("Source:".length).trim().split(" · ");
    if (parts.length < 3) return null;
    const s = parts.slice(2).join(" · ").trim();
    return s || null;
  }
  return null;
}

/** The IDs of the `- OPS-…` lines between `Steps:` and `Read first:`. */
export function lightmapSteps(issue: Pick<FullIssue, "description">): string[] {
  const out: string[] = [];
  let inSteps = false;
  for (const l of lines(issue)) {
    const t = l.trim();
    if (/^Steps:/.test(t)) {
      inSteps = true;
      continue;
    }
    if (/^Read first:/.test(t)) break;
    if (!inSteps) continue;
    const m = /^[-*+]\s*(OPS-[A-Z0-9]+-\d+)\b/.exec(t);
    if (m) out.push(m[1]);
  }
  return out;
}

/** The title's text before ` · ` (the variant, for example `F1.2`). */
export function variantOf(issue: Pick<FullIssue, "title">): string {
  const i = issue.title.indexOf(" · ");
  return (i >= 0 ? issue.title.slice(0, i) : issue.title).trim();
}

export function isLater(issue: Pick<FullIssue, "labels">): boolean {
  return issue.labels.includes("Later");
}

/** `OPS-F1-10` → `F1-10`. */
export function shortId(stepId: string): string {
  return stepId.replace(/^OPS-/, "");
}

/** A blocking relation on this issue (another issue blocks it). */
export function hasBlocker(issue: Pick<FullIssue, "inverseRelations">): boolean {
  return issue.inverseRelations.some((r) => r.type === "blocks");
}

export const ISSUE_KEY = /^[A-Z][A-Z0-9]*-\d+$/;
