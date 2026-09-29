import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BOTS, botDef } from "../../src/bots/registry";
import { DemoConfigSchema, type DemoConfig } from "../../src/core/config";
import { createBotLogger } from "../../src/core/log";
import { guardSlack } from "../../src/clients/slack";
import type { RunSummary } from "../../src/events/dispatch";
import type { ContextPacket } from "../../src/packet/build";
import { readSteps } from "../../src/packet/build";
import { makeContext } from "../../src/tools/context";
import { callTool, type SelfEvent, type ToolContext } from "../../src/tools/define";
import { toolsFor } from "../../src/agent/run";

export const FIXTURES = resolve(__dirname, "..", "fixtures");

export function testConfig(): DemoConfig {
  return DemoConfigSchema.parse(JSON.parse(readFileSync(resolve(FIXTURES, "demo.config.json"), "utf8")));
}

/** Fake tokens are joined from parts at run time (WR BR-12). */
export function fakeToken(...parts: string[]): string {
  return parts.join("");
}

export interface Call {
  method: string;
  args: any;
}

export function permalinkFor(channel: string, ts: string, threadTs?: string): string {
  const p = `https://endix.slack.com/archives/${channel}/p${ts.replace(".", "")}`;
  return threadTs && threadTs !== ts ? `${p}?thread_ts=${threadTs}&cid=${channel}` : p;
}

/** A fake WebClient: records every call, answers from settable fixtures, keeps the W-12 guard. */
export function mockSlack() {
  const calls: Call[] = [];
  let n = 0;
  const fixtures = {
    /** thread root ts → messages (raw Slack shape: ts, user, bot_id, text, thread_ts) */
    replies: {} as Record<string, any[]>,
    history: [] as any[],
    auth: { ok: true, user_id: "U_LH", user: "lighthouse", bot_id: "B_LH" } as Record<string, unknown>,
  };
  const rec = (method: string, args: any) => calls.push({ method, args });
  const raw = {
    calls,
    fixtures,
    chat: {
      async postMessage(args: any) {
        rec("chat.postMessage", args);
        n += 1;
        return { ok: true, channel: args.channel, ts: `1790000${String(n).padStart(3, "0")}.000100` };
      },
      async update(args: any) {
        rec("chat.update", args);
        return { ok: true };
      },
      async delete(args: any) {
        rec("chat.delete", args);
        return { ok: true };
      },
      async getPermalink(args: any) {
        rec("chat.getPermalink", args);
        return { ok: true, permalink: permalinkFor(args.channel, args.message_ts) };
      },
    },
    reactions: {
      async add(args: any) {
        rec("reactions.add", args);
        return { ok: true };
      },
    },
    conversations: {
      async replies(args: any) {
        rec("conversations.replies", args);
        const all = fixtures.replies[args.ts] ?? Object.values(fixtures.replies).find((ms) => ms.some((m) => m.ts === args.ts)) ?? [];
        const msgs = args.latest ? all.filter((m) => m.ts === args.latest) : all;
        return { ok: true, messages: msgs };
      },
      async history(args: any) {
        rec("conversations.history", args);
        return { ok: true, messages: fixtures.history };
      },
    },
    auth: {
      async test() {
        rec("auth.test", {});
        return fixtures.auth;
      },
    },
  };
  return guardSlack(raw, { dryRun: false });
}
export type MockSlack = ReturnType<typeof mockSlack>;

export interface MockLinear {
  (query: string, variables?: Record<string, unknown>): Promise<any>;
  calls: { op: string; query: string; variables: Record<string, unknown> }[];
  on(op: string, answer: unknown): MockLinear;
}

/** A fake `linear(query, variables)` that records calls and answers by operation name. */
export function mockLinear(): MockLinear {
  const calls: MockLinear["calls"] = [];
  const answers = new Map<string, unknown>();
  const fn = async (query: string, variables: Record<string, unknown> = {}) => {
    const m = /^\s*(query|mutation)\s*(\w+)?/.exec(query);
    const op = m?.[2] ?? m?.[1] ?? "anonymous";
    calls.push({ op, query, variables });
    const a = answers.get(op);
    if (typeof a === "function") return (a as (v: Record<string, unknown>) => unknown)(variables);
    if (a instanceof Error) throw a;
    return a ?? null;
  };
  const mock = fn as MockLinear;
  mock.calls = calls;
  mock.on = (op, answer) => {
    answers.set(op, answer);
    return mock;
  };
  return mock;
}

/** A fake @notionhq/client with the methods of Req 20, recording calls. */
export function mockNotion() {
  const calls: Call[] = [];
  const fixtures = { pages: {} as Record<string, any>, markdown: {} as Record<string, string>, query: [] as any[], dataSource: {} as any };
  const rec = (method: string, args: any) => calls.push({ method, args });
  const ok = (method: string, value: any = { ok: true }) => async (args: any) => {
    rec(method, args);
    return value;
  };
  return {
    calls,
    fixtures,
    dataSources: {
      async query(args: any) {
        rec("dataSources.query", args);
        return { results: fixtures.query, has_more: false, next_cursor: null };
      },
      async retrieve(args: any) {
        rec("dataSources.retrieve", args);
        return fixtures.dataSource;
      },
      update: ok("dataSources.update"),
    },
    pages: {
      async retrieve(args: any) {
        rec("pages.retrieve", args);
        return fixtures.pages[args.page_id];
      },
      async retrieveMarkdown(args: any) {
        rec("pages.retrieveMarkdown", args);
        return { markdown: fixtures.markdown[args.page_id] ?? "" };
      },
      create: ok("pages.create", { id: "new-page" }),
      update: ok("pages.update"),
      updateMarkdown: ok("pages.updateMarkdown"),
      move: ok("pages.move"),
    },
    blocks: {
      update: ok("blocks.update"),
      delete: ok("blocks.delete"),
      children: { append: ok("blocks.children.append"), list: ok("blocks.children.list", { results: [], has_more: false }) },
    },
    users: { me: ok("users.me", { name: "Endix readers (demo)" }) },
  };
}
export type MockNotion = ReturnType<typeof mockNotion>;

/** Records enqueueSelf events (E3, E12) and counts runs per bot. */
export function mockQueue() {
  const events: SelfEvent[] = [];
  const runs: Record<string, number> = {};
  let summary: RunSummary | ((e: SelfEvent) => RunSummary) = { runId: "mock", toolResults: [] };
  return {
    events,
    runs,
    setSummary(s: RunSummary | ((e: SelfEvent) => RunSummary)) {
      summary = s;
    },
    async enqueueSelf(e: SelfEvent): Promise<RunSummary> {
      events.push(e);
      const bot = e.id === "E3" ? "lighthouse" : "question-idea";
      runs[bot] = (runs[bot] ?? 0) + 1;
      return typeof summary === "function" ? summary(e) : summary;
    },
  };
}
export type MockQueue = ReturnType<typeof mockQueue>;

export interface Mocks {
  slack?: MockSlack;
  linear?: MockLinear;
  notion?: MockNotion;
  queue?: MockQueue;
  github?: ToolContext["github"];
}

/** A small valid packet for tool tests. */
export function testPacket(bot: string, overrides: Partial<ContextPacket> = {}): ContextPacket {
  return {
    bot,
    now: "2026-10-02T14:03:00+09:00",
    event: {
      id: "E1",
      channel: "demo-lighthouse",
      ts: "1790000000.000100",
      thread_ts: null,
      permalink: permalinkFor("C0C61PKP10Q", "1790000000.000100"),
      author: { name: "Henry", kind: "person" },
      text: "hello",
    },
    thread: [],
    umbrellas: [],
    people: { Henry: { slack: "U_HENRY" } },
    steps: readSteps(),
    ...overrides,
  };
}

export function testContext(bot: string, opts: { mocks?: Mocks; dryRun?: boolean; packet?: ContextPacket } = {}): ToolContext {
  const def = botDef(bot);
  const m = opts.mocks ?? {};
  return makeContext(def, opts.packet ?? testPacket(bot), {
    dryRun: opts.dryRun ?? false,
    runId: `${bot}-test`,
    secrets: {},
    config: testConfig(),
    log: createBotLogger(bot),
    enqueueSelf: m.queue ? m.queue.enqueueSelf : undefined,
    overrides: { slack: m.slack ?? mockSlack(), linear: m.linear ?? mockLinear(), notion: m.notion ?? mockNotion(), github: m.github },
  });
}

/** Runs one of a bot's tools through `callTool` with the mocks; returns the parsed result. */
export async function runTool(bot: string, name: string, input: unknown, opts: { mocks?: Mocks; dryRun?: boolean; packet?: ContextPacket } = {}) {
  const def = BOTS[bot as keyof typeof BOTS];
  const t = toolsFor(def).find((x) => x.name === name);
  if (!t) throw new Error(`${bot} has no tool ${name}`);
  const r = await callTool(t, input, testContext(bot, opts));
  return JSON.parse(JSON.stringify(r.value));
}

export { fakeSdk, type ScriptCall } from "./fake-sdk";
