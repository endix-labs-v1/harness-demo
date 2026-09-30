import { z } from "zod";
import { defineTool, type ToolDef } from "./define";
import { readThread } from "../clients/slack";
import { findIssues, getIssue } from "../clients/linear";
import { notionRead, notionSearch } from "../clients/notion";
import { githubRead } from "../clients/github";
import { listIdeaThreads } from "./idea-threads";

export type SharedReadName = "read_thread" | "linear_get" | "linear_find" | "notion_search" | "notion_read" | "steps" | "github_read" | "list_idea_threads";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The shared reads of SYS §5.1 (Req 15). */
export const SHARED_READS: Record<SharedReadName, ToolDef<any>> = {
  read_thread: defineTool({
    name: "read_thread",
    description: "Read a Slack thread: pass a permalink, or both channel and ts. Returns the messages oldest first, with author, text and permalink.",
    input: { permalink: z.string().optional(), channel: z.string().optional(), ts: z.string().optional() },
    async handler(input, ctx) {
      if (input.permalink) return readThread(ctx, { permalink: input.permalink });
      if (input.channel && input.ts) return readThread(ctx, { channel: input.channel, ts: input.ts });
      return { error: "input: pass a permalink, or both channel and ts" };
    },
  }),
  linear_get: defineTool({
    name: "linear_get",
    description: "Read one Linear issue by key (END-123): title, state, labels, description, due date, assignee, parent, children, relations, attachments, project.",
    input: { key: z.string().regex(/^END-\d+$/) },
    async handler(input, ctx) {
      const issue = await getIssue(ctx, input.key);
      return issue ?? { key: input.key, error: "not found" };
    },
  }),
  linear_find: defineTool({
    name: "linear_find",
    description: "Find issues in the project Harness demo only (first 50), by label, state, due date on or before a day, or a title fragment.",
    input: {
      label: z.string().optional(),
      state: z.string().optional(),
      due_on_or_before: z.string().regex(DAY).optional(),
      title_contains: z.string().optional(),
    },
    async handler(input, ctx) {
      return { issues: await findIssues(ctx, input) };
    },
  }),
  notion_search: defineTool({
    name: "notion_search",
    description: "Search the demo Docs database: pages whose title or text holds any word of 3 letters or more. Returns id, title, status, type, owner, url.",
    input: { text: z.string() },
    async handler(input, ctx) {
      return notionSearch(ctx, input.text);
    },
  }),
  notion_read: defineTool({
    name: "notion_read",
    description: "Read one Notion page (ID or URL): properties and its content as markdown.",
    input: { page: z.string() },
    async handler(input, ctx) {
      return notionRead(ctx, input.page);
    },
  }),
  steps: defineTool({
    name: "steps",
    description: "The steps of one variant (for example F1.2) from the step catalogue.",
    input: { variant: z.string() },
    async handler(input, ctx) {
      const cat = ctx.packet.steps as { variants?: Record<string, unknown> } | undefined;
      const v = cat?.variants?.[input.variant];
      return v ?? { found: false, variant: input.variant };
    },
  }),
  github_read: defineTool({
    name: "github_read",
    description: "Read a file of the demo repo at a ref (default main): its text, the commit SHA, and a permalink template pinned to that SHA.",
    input: { path: z.string(), ref: z.string().optional() },
    async handler(input, ctx) {
      return githubRead(ctx, input.path, input.ref ?? "main");
    },
  }),
  list_idea_threads: defineTool({
    name: "list_idea_threads",
    description: "Top-level threads in #demo-ideas, newest first: root text, author, permalink, decision line, closing line, last activity.",
    input: { since: z.string().regex(DAY).optional() },
    async handler(input, ctx) {
      if (ctx.reads?.list_idea_threads) return ctx.reads.list_idea_threads;
      return { threads: await listIdeaThreads(ctx, { since: input.since }) };
    },
  }),
};


/** Linear stores a bare URL as `[url](<url>)`; return the first http(s) URL in `s`, or `s` as is. */
export function unwrapLink(s: string): string {
  const m = /https?:\/\/[^\s<>()\[\]]+/.exec(s);
  return m ? m[0] : s;
}
