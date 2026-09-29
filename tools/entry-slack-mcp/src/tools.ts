// The four tools of endix-entry-slack (SYS §5.7; T10 Spec Req 4 to 10).
// Order in every post tool: permalink → channel fence (W-01) → person-line guard on
// each free-text input and on the full text (W-12) → the one Slack write.
import { z } from "zod";
import type { EntryConfig } from "./env";
import { guardPersonLine } from "./guard";
import {
  authorOf,
  mentionText,
  parsePermalink,
  slackErrorCode,
  threadRoot,
  type Permalink,
  type SlackClient,
} from "./slack";

export interface Deps {
  slack: SlackClient;
  config: EntryConfig;
}

export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export const STEP_ID = /^OPS-[A-Z0-9]+-\d+$/;

/** Input shapes, registered with the MCP server and checked again inside each handler. */
export const inputShapes = {
  read_thread: {
    permalink: z.string().describe("Permalink of any message in the #demo-lighthouse thread"),
  },
  post_in_thread: {
    permalink: z.string().describe("Permalink of the umbrella's #demo-lighthouse thread (or any message in it)"),
    text: z.string().min(1).describe("The post, in its DICT §2 form. Write mentions as <@Henry>, <@Task manager>, <@Doc manager>, <@Lighthouse>"),
  },
  post_ask: {
    who_asked: z.string().min(1).describe("The person who asked (at this terminal, Henry)"),
    what_for: z.string().min(1).describe("The ask in one sentence, in their words"),
    links: z.array(z.string()).describe("Links to the ask's sources; an empty list when there are none"),
  },
  hand_off: {
    permalink: z.string().describe("Permalink of the umbrella's #demo-lighthouse thread"),
    manager: z.enum(["doc", "task"]).describe("doc: a Notion write (doc manager); task: a Linear write (task manager)"),
    step_id: z.string().regex(STEP_ID).describe("The full step ID, like OPS-F1-13"),
    what: z.string().min(1).describe("What to write"),
    where: z.string().min(1).describe("The page or issue, with its link"),
  },
};

export const descriptions = {
  read_thread:
    "Read a #demo-lighthouse thread: every message oldest first, with its author (Henry, a bot by name, or other) and permalink (OPS-F0-10).",
  post_in_thread:
    "Post in an umbrella's #demo-lighthouse thread as the Entry agent: a draft, an output link, a list (OPS-F0-12, OPS-F0-38). <@Henry>, <@Lighthouse>, <@Task manager>, <@Doc manager>, <@Question/idea agent> and <@Checker> become mentions. Refuses a person's line (W-12) and any channel but #demo-lighthouse (W-01).",
  post_ask:
    "An ask with no umbrella key (OPS-F0-02): posts a new #demo-lighthouse thread `Ask from {who_asked} via Claude Code: {what_for}`, `Agent: Claude Code in harness-demo`, `Links: …`. Lighthouse answers in that thread; this tool waits for nothing and returns no key.",
  hand_off:
    "Hand a Notion or Linear write to the doc manager or the task manager (OPS-A4-02, OPS-F0-38): posts `<@Doc manager> {step_id} · {what} · {where}` (or <@Task manager>) in the umbrella's thread. Then wait for the manager's reply with read_thread.",
};

type Result = Record<string, unknown>;

function reply(result: Result, isError = false): ToolResult {
  const out: ToolResult = { content: [{ type: "text", text: JSON.stringify(result) }] };
  if (isError) out.isError = true;
  return out;
}

const W01 = {
  refused: true,
  wall: "W-01",
  message:
    "Refused by the harness (W-01, OPS-A4-32): endix-entry-slack reads and posts only in #demo-lighthouse.",
};

type Parsed<T> = { ok: true; value: T } | { ok: false; out: ToolResult };

function parseInput<S extends z.ZodRawShape>(shape: S, input: unknown): Parsed<z.infer<z.ZodObject<S>>> {
  const r = z.object(shape).safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  const issues = r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
  return { ok: false, out: reply({ error: `invalid input: ${issues}` }, true) };
}

/** Permalink → its place, or the refusal/error to return. Only #demo-lighthouse passes (W-01). */
function fence(permalink: string, config: EntryConfig): { ok: true; p: Permalink } | { ok: false; out: ToolResult } {
  let p: Permalink;
  try {
    p = parsePermalink(permalink);
  } catch (err) {
    return { ok: false, out: reply({ error: (err as Error).message }, true) };
  }
  if (p.channel !== config.slack.channels.lighthouse) return { ok: false, out: reply(W01, true) };
  return { ok: true, p };
}

/** The first W-12 refusal among the texts, as the tool returns it. */
function guard(...texts: string[]): ToolResult | null {
  for (const t of texts) {
    const r = guardPersonLine(t);
    if (r) return reply({ refused: true, wall: "W-12", message: r.message }, true);
  }
  return null;
}

async function post(
  deps: Deps,
  channel: string,
  text: string,
  threadTs: string | null,
  warnings: string[] = [],
): Promise<ToolResult> {
  let ts: string;
  try {
    const res = await deps.slack.chat.postMessage({
      channel,
      text,
      ...(threadTs ? { thread_ts: threadTs } : {}),
      unfurl_links: false,
    });
    ts = res.ts ?? "";
  } catch (err) {
    return reply({ error: slackErrorCode(err) }, true);
  }
  const result: Result = { ok: true, ts, permalink: null };
  try {
    result.permalink = (await deps.slack.chat.getPermalink({ channel, message_ts: ts })).permalink ?? null;
  } catch (err) {
    // The post is made; say so rather than invite a second post.
    warnings = [...warnings, `posted, but chat.getPermalink failed: ${slackErrorCode(err)}`];
  }
  if (warnings.length) result.warnings = warnings;
  return reply(result);
}

export function createTools(deps: Deps) {
  const { config } = deps;

  async function read_thread(input: unknown): Promise<ToolResult> {
    const a = parseInput(inputShapes.read_thread, input);
    if (!a.ok) return a.out;
    const f = fence(a.value.permalink, config);
    if (!f.ok) return f.out;
    const channel = f.p.channel;
    try {
      const res = await deps.slack.conversations.replies({ channel, ts: threadRoot(f.p), limit: 100 });
      const msgs = [...(res.messages ?? [])].sort((x, y) => Number(x.ts ?? 0) - Number(y.ts ?? 0));
      const messages = [];
      for (const m of msgs) {
        const ts = m.ts ?? "";
        const link = await deps.slack.chat.getPermalink({ channel, message_ts: ts });
        messages.push({ ts, author: authorOf(m, config), text: m.text ?? "", permalink: link.permalink ?? null });
      }
      return reply({ messages });
    } catch (err) {
      return reply({ error: slackErrorCode(err) }, true);
    }
  }

  async function post_in_thread(input: unknown): Promise<ToolResult> {
    const a = parseInput(inputShapes.post_in_thread, input);
    if (!a.ok) return a.out;
    const f = fence(a.value.permalink, config);
    if (!f.ok) return f.out;
    const refusedInput = guard(a.value.text);
    if (refusedInput) return refusedInput;
    const { text, warnings } = mentionText(a.value.text, config);
    const refusedFull = guard(text);
    if (refusedFull) return refusedFull;
    return post(deps, f.p.channel, text, threadRoot(f.p), warnings);
  }

  async function post_ask(input: unknown): Promise<ToolResult> {
    const a = parseInput(inputShapes.post_ask, input);
    if (!a.ok) return a.out;
    const { who_asked, what_for, links } = a.value;
    const refusedInput = guard(what_for);
    if (refusedInput) return refusedInput;
    const text = [
      `Ask from ${who_asked} via Claude Code: ${what_for}`,
      "Agent: Claude Code in harness-demo",
      `Links: ${links.length ? links.join(", ") : "none"}`,
    ].join("\n");
    const refusedFull = guard(text);
    if (refusedFull) return refusedFull;
    return post(deps, config.slack.channels.lighthouse, text, null);
  }

  async function hand_off(input: unknown): Promise<ToolResult> {
    const a = parseInput(inputShapes.hand_off, input);
    if (!a.ok) return a.out;
    const { permalink, manager, step_id, what, where } = a.value;
    const f = fence(permalink, config);
    if (!f.ok) return f.out;
    const refusedInput = guard(what, where);
    if (refusedInput) return refusedInput;
    const key = manager === "doc" ? "doc_manager" : "task_manager";
    const id = config.slack.bots[key].user_id;
    if (!id) return reply({ error: `config slack.bots.${key}.user_id is empty (T2 fills it)` }, true);
    const text = `<@${id}> ${step_id} · ${what} · ${where}`;
    const refusedFull = guard(text);
    if (refusedFull) return refusedFull;
    return post(deps, f.p.channel, text, threadRoot(f.p));
  }

  return { read_thread, post_in_thread, post_ask, hand_off };
}

export type Tools = ReturnType<typeof createTools>;
