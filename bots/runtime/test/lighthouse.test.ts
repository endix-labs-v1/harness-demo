// Lighthouse's write tools (T6 Spec Req 21, TEST §2.2 T-LH-1 to T-LH-11 tool part). Mocks only, no model.
// Fake issue keys are END-95xx (never a real key).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { botDef } from "../src/bots/registry";
import { createBotLogger } from "../src/core/log";
import { w12Message } from "../src/guard/person-line";
import type { ContextPacket } from "../src/packet/build";
import { makeContext } from "../src/tools/context";
import { callTool, type ToolContext } from "../src/tools/define";
import { allowedSteps, loadCatalogue } from "../src/tools/lighthouse/catalogue";
import { lighthouseWriteTools } from "../src/tools/lighthouse/index";
import { W17, W18, W19, w16 } from "../src/tools/lighthouse/texts";
import { FIXTURES, mockLinear, mockNotion, mockQueue, mockSlack, permalinkFor, testConfig, testPacket, type MockLinear, type MockQueue, type MockSlack } from "./helpers";

const LH = "C0C61PKP10Q";
const QS = "C0C61PKLZT2";
const IDEAS = "C0C55EFGY5C";
const THREAD_A = "https://endix.slack.com/archives/C0C61PKP10Q/p1790000000000100";
const FEE_MODEL = "Fee model (https://www.notion.so/3ea8f1ec11b4816d8adae5fa98d19815)";
const lhFix = (name: string) => resolve(FIXTURES, "lighthouse", name);
const readFix = (name: string) => readFileSync(lhFix(name), "utf8");
const jsonFix = (name: string) => JSON.parse(readFix(name));

interface Mocks {
  slack: MockSlack;
  linear: MockLinear;
  queue: MockQueue;
}

function mocks(): Mocks {
  return { slack: mockSlack(), linear: mockLinear(), queue: mockQueue() };
}

/** A Lighthouse context on the mocks, with today 2026-10-02 in Seoul. */
function lhContext(m: Mocks, opts: { dryRun?: boolean; packet?: ContextPacket } = {}): ToolContext {
  return makeContext(botDef("lighthouse"), opts.packet ?? testPacket("lighthouse"), {
    dryRun: opts.dryRun ?? false,
    runId: "lighthouse-test",
    secrets: {},
    config: testConfig(),
    log: createBotLogger("lighthouse"),
    enqueueSelf: m.queue.enqueueSelf,
    overrides: { slack: m.slack, linear: m.linear, notion: mockNotion(), now: () => new Date("2026-10-02T05:03:00Z") },
  });
}

async function call(ctx: ToolContext, name: string, input: unknown): Promise<any> {
  const t = lighthouseWriteTools.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return JSON.parse(JSON.stringify((await callTool(t, input, ctx)).value));
}

function loadThread(slack: MockSlack, name: string): { channel: string; root: string; permalink: string } {
  const f = jsonFix(name);
  slack.fixtures.replies[f.root_ts] = f.messages;
  return { channel: f.channel, root: f.root_ts, permalink: permalinkFor(f.channel, f.root_ts) };
}

const posts = (s: MockSlack) => s.calls.filter((c) => c.method === "chat.postMessage").map((c) => c.args);
const creates = (l: MockLinear) => l.calls.filter((c) => c.op === "IssueCreate");

function answerCreate(linear: MockLinear, key = "END-9512") {
  linear.on("IssueCreate", { issueCreate: { success: true, issue: { identifier: key, url: `https://linear.app/endix/issue/${key}/f12-change-the-fee`, project: { id: "cee0ce78-826e-4b88-9e81-631252326b6e" } } } });
}

const F12 = ["OPS-F1-09", "OPS-F1-10", "OPS-F1-12", "OPS-F1-13", "OPS-F1-14", "OPS-F0-41", "OPS-F0-42", "OPS-F0-43"];
const F12_INPUT = {
  variant: "F1.2",
  ask: "Change the fee on Fee model from 30 to 25 bps",
  asker: "Henry",
  thread_permalink: THREAD_A,
  lightmap: {
    task_row: "none in the demo (the flow's defaults)",
    steps: F12,
    read_first: [FEE_MODEL],
    outputs: ["the draft in this thread", "Fee model in Notion", "the carry-over list in this thread"],
    closes_when: "Fee model is Current with the change and its carry-over list is linked",
  },
};
const F7_LIGHTMAP = {
  task_row: "none in the demo (the flow's defaults)",
  steps: ["OPS-F7-01", "OPS-F7-02", "OPS-F7-03", "OPS-F7-05", "OPS-F7-06", "OPS-F7-07", "OPS-F7-12", "OPS-F7-13"],
  read_first: ["none"],
  outputs: ["this thread", "the task in Linear"],
  closes_when: "closed with Henry's Done: or Drop: line",
};
const f7 = (variant: string, when?: object) => ({
  variant,
  ask: "Get the Acme NDA signed",
  asker: "Henry",
  thread_permalink: THREAD_A,
  lightmap: variant === "F7.2" ? { ...F7_LIGHTMAP, steps: ["OPS-F7-01", "OPS-F7-02", "OPS-F7-03", "OPS-F7-08", "OPS-F7-09", "OPS-F7-12", "OPS-F7-13"] } : F7_LIGHTMAP,
  ...(when ? { when } : {}),
});

describe("Lighthouse catalogue (REF §3)", () => {
  it("T-LH-1: loadCatalogue parses; the thirteen variants in order with their flags", () => {
    const cat = loadCatalogue();
    expect(Object.keys(cat.variants)).toEqual(["F0.1", "F0.6", "F1.2", "F2.1", "F2.2", "F2.3", "F4", "F5.1", "F6", "F7.1", "F7.2", "F7.3", "F9.4"]);
    const flags = Object.fromEntries(Object.entries(cat.variants).map(([k, v]) => [k, [v.umbrella, v.sub_issues, v.includes]]));
    expect(flags).toEqual({
      "F0.1": [false, false, []],
      "F0.6": [false, false, []],
      "F1.2": [true, true, ["F0.6"]],
      "F2.1": [true, true, []],
      "F2.2": [true, true, []],
      "F2.3": [true, true, []],
      F4: [false, false, []],
      "F5.1": [true, true, []],
      F6: [false, false, []],
      "F7.1": [true, false, []],
      "F7.2": [true, false, []],
      "F7.3": [true, false, []],
      "F9.4": [true, true, []],
    });
    expect(allowedSteps(cat, "F1.2")).toEqual(["OPS-F1-09", "OPS-F1-10", "OPS-F1-11", "OPS-F1-12", "OPS-F1-13", "OPS-F1-14", "OPS-F0-41", "OPS-F0-42", "OPS-F0-43"]);
    expect(allowedSteps(cat, "F3.3")).toEqual([]);
  });
});

describe("open_umbrella (SYS §5.2, §6.1)", () => {
  it("T-LH-3: F1.2 for S1's A: one issueCreate in the project, label Lightmap, Todo, description and lightmap reply byte for byte", async () => {
    const m = mocks();
    answerCreate(m.linear);
    const r = await call(lhContext(m), "open_umbrella", F12_INPUT);
    const c = creates(m.linear);
    expect(c).toHaveLength(1);
    const input = c[0].variables.input as Record<string, unknown>;
    const cfg = testConfig();
    expect(input.title).toBe("F1.2 · Change the fee on Fee model from 30 to 25 bps");
    expect(input.labelIds).toEqual([cfg.linear.labels.Lightmap]);
    expect(input.stateId).toBe(cfg.linear.states.Todo);
    expect(input.projectId).toBe(cfg.linear.project_id);
    expect(input.teamId).toBe(cfg.linear.team_id);
    expect(input).not.toHaveProperty("assigneeId");
    expect(input).not.toHaveProperty("dueDate");
    expect(input.description).toBe(readFix("umbrella-F1.2.md"));
    expect(r.key).toBe("END-9512");
    expect(r.lightmap_reply).toBe(readFix("lightmap-reply-F1.2.txt"));
  });

  it("T-LH-3 (W-11): no input can name another project; unknown keys are an input error", async () => {
    const m = mocks();
    answerCreate(m.linear);
    const r = await call(lhContext(m), "open_umbrella", { ...F12_INPUT, projectId: "other-project" });
    expect(r.error).toMatch(/^input:/);
    expect(creates(m.linear)).toHaveLength(0);
  });

  it("T-LH-3 (dry run): no Linear call; key END-DRY-1 and its lightmap reply", async () => {
    const m = mocks();
    const ctx = lhContext(m, { dryRun: true });
    const r = await call(ctx, "open_umbrella", F12_INPUT);
    expect(m.linear.calls).toHaveLength(0);
    expect(r).toMatchObject({ dry_run: true, key: "END-DRY-1", url: "https://dry-run.invalid/END-DRY-1" });
    expect(r.lightmap_reply.split("\n")[0]).toBe("<https://dry-run.invalid/END-DRY-1|END-DRY-1> · F1.2 · Change the fee on Fee model from 30 to 25 bps");
    expect((await call(ctx, "open_umbrella", F12_INPUT)).key).toBe("END-DRY-2");
  });

  it("T-LH-4: a step not in the variant is W-16 with the exact text; no Linear call", async () => {
    const m = mocks();
    const r = await call(lhContext(m), "open_umbrella", {
      ...F12_INPUT,
      variant: "F2.1",
      ask: "Add totalWithFee to FeeModel",
      lightmap: { ...F12_INPUT.lightmap, steps: ["OPS-F2-01", "OPS-F2-99"] },
    });
    expect(r).toEqual({ refused: true, wall: "W-16", message: w16("OPS-F2-99", "F2.1") });
    expect(r.message).toBe("Refused by the harness (W-16, OPS-F0-24): OPS-F2-99 is not a step of F2.1. A lightmap quotes only steps on the flow page.");
    expect(m.linear.calls).toHaveLength(0);
  });

  it("T-LH-4: an unknown variant F3.3 with OPS-F3-01 is W-16", async () => {
    const m = mocks();
    const r = await call(lhContext(m), "open_umbrella", { ...F12_INPUT, variant: "F3.3", lightmap: { ...F12_INPUT.lightmap, steps: ["OPS-F3-01"] } });
    expect(r).toEqual({ refused: true, wall: "W-16", message: w16("OPS-F3-01", "F3.3") });
    expect(m.linear.calls).toHaveLength(0);
  });

  it("T-LH-5: F7.1 with a due date: labels [Lightmap, Later], no Waits on line; with a check date: Waits on after Source; F7.2 the same labels", async () => {
    const cfg = testConfig();
    const m = mocks();
    answerCreate(m.linear, "END-9514");
    await call(lhContext(m), "open_umbrella", f7("F7.1", { due_date: "2026-10-02" }));
    const a = creates(m.linear)[0].variables.input as any;
    expect(a.labelIds).toEqual([cfg.linear.labels.Lightmap, cfg.linear.labels.Later]);
    expect(a.description.split("\n").some((l: string) => l.startsWith("Waits on:"))).toBe(false);
    expect(a).not.toHaveProperty("dueDate");

    await call(lhContext(m), "open_umbrella", f7("F7.1", { check_date: "2026-10-09", waits_on: "Acme's legal reply" }));
    const b = creates(m.linear)[1].variables.input as any;
    expect(b.description.split("\n").slice(0, 3)).toEqual([`Thread: ${THREAD_A}`, "Source: Henry · 2026-10-02", "Waits on: Acme's legal reply"]);

    await call(lhContext(m), "open_umbrella", f7("F7.2", { due_date: "2026-11-01" }));
    expect((creates(m.linear)[2].variables.input as any).labelIds).toEqual([cfg.linear.labels.Lightmap, cfg.linear.labels.Later]);
  });

  it("T-LH-5: Source ends with the source only when handed on; Origin only for follow-ups; Rule in force only for F2.3", async () => {
    const m = mocks();
    answerCreate(m.linear, "END-9520");
    await call(lhContext(m), "open_umbrella", { ...F12_INPUT, source: "https://endix.slack.com/archives/C0C61PKP10Q/p1790000009000100", origin_key: "END-9512" });
    const d = (creates(m.linear)[0].variables.input as any).description as string;
    expect(d.split("\n").slice(0, 4)).toEqual([`Thread: ${THREAD_A}`, "Source: Henry · 2026-10-02 · https://endix.slack.com/archives/C0C61PKP10Q/p1790000009000100", "Origin: END-9512", ""]);
    const f23 = await call(lhContext(m, { dryRun: true }), "open_umbrella", {
      ...F12_INPUT,
      variant: "F2.3",
      ask: "Require NatSpec on every public function",
      rule_id: "CODE-NAT-02",
      lightmap: { ...F12_INPUT.lightmap, steps: ["OPS-F2-21", "OPS-F2-22", "OPS-F2-23"] },
    });
    expect(f23.lightmap_reply.split("\n").slice(1, 3)).toEqual(["Flow: F2.3 · Harness and infra · Task row: none in the demo (the flow's defaults)", "Rule in force: CODE-NAT-02"]);
    const noRule = await call(lhContext(m), "open_umbrella", { ...F12_INPUT, rule_id: "CODE-NAT-02" });
    expect(noRule.error).toMatch(/^input:/);
    const f0 = await call(lhContext(m), "open_umbrella", { ...F12_INPUT, variant: "F4" });
    expect(f0.error).toBe("F4 opens no umbrella (steps.json).");
  });

  it("T-LH-6: F7.1 with no when, two whens, or a check date without waits_on: exact W-17; no Linear call", async () => {
    for (const when of [undefined, { due_date: "2026-10-02", blocked_by: "END-9540" }, { check_date: "2026-10-09" }]) {
      const m = mocks();
      const r = await call(lhContext(m), "open_umbrella", f7("F7.1", when));
      expect(r).toEqual({ refused: true, wall: "W-17", message: W17 });
      expect(m.linear.calls).toHaveLength(0);
    }
    expect(W17).toBe('Refused by the harness (W-17, OPS-F7-14): an F7 task opens only with exactly one when: a due date, a blocking issue, a check date with what it waits on, or a repeat. Ask the asker "By when, or after what?".');
  });

  it("T-LH-7: source in #demo-ideas with no decision line, or a bot's Later: only, is W-18; Henry's Later line passes", async () => {
    const f73 = (source: string) => ({
      variant: "F7.3",
      ask: "Revisit: fee holiday in launch week",
      asker: "Henry",
      thread_permalink: THREAD_A,
      source,
      lightmap: { ...F7_LIGHTMAP, steps: ["OPS-F7-01", "OPS-F7-02", "OPS-F7-03", "OPS-F7-10", "OPS-F7-11", "OPS-F7-12", "OPS-F7-13"] },
      when: { due_date: "2026-11-01" },
    });
    for (const name of ["thread-idea-no-decision.json", "thread-idea-bot-later.json"]) {
      const m = mocks();
      const t = loadThread(m.slack, name);
      const r = await call(lhContext(m), "open_umbrella", f73(t.permalink));
      expect(r).toEqual({ refused: true, wall: "W-18", message: W18 });
      expect(m.linear.calls).toHaveLength(0);
    }
    const m = mocks();
    answerCreate(m.linear, "END-9560");
    const t = loadThread(m.slack, "thread-idea-later.json");
    const r = await call(lhContext(m), "open_umbrella", f73(t.permalink));
    expect(r.key).toBe("END-9560");
    expect(creates(m.linear)).toHaveLength(1);
  });

  it("T-LH-7: thread_permalink in #demo-ideas with no source is W-18", async () => {
    const m = mocks();
    const t = loadThread(m.slack, "thread-idea-no-decision.json");
    const r = await call(lhContext(m), "open_umbrella", { ...F12_INPUT, thread_permalink: t.permalink });
    expect(r).toEqual({ refused: true, wall: "W-18", message: W18 });
  });

  it("T-LH-7: the run's own event is an E5 in the idea thread; thread_permalink in #demo-lighthouse and no source: W-18", async () => {
    const m = mocks();
    const t = loadThread(m.slack, "thread-idea-no-decision.json");
    const ts = "1790000502.000100";
    const packet = testPacket("lighthouse", {
      event: { id: "E5", channel: "demo-ideas", ts, thread_ts: t.root, permalink: permalinkFor(IDEAS, ts, t.root), author: { name: "Henry", kind: "person" }, text: "<@U_LH> open an umbrella for this idea now." },
    });
    const r = await call(lhContext(m, { packet }), "open_umbrella", F12_INPUT);
    expect(r).toEqual({ refused: true, wall: "W-18", message: W18 });
    expect(m.linear.calls).toHaveLength(0);
  });

  it("T-LH-7 order: W-18 comes before W-17 and W-16", async () => {
    const m = mocks();
    const t = loadThread(m.slack, "thread-idea-no-decision.json");
    const r = await call(lhContext(m), "open_umbrella", { ...f7("F7.1"), source: t.permalink, lightmap: { ...F7_LIGHTMAP, steps: ["OPS-F7-99"] } });
    expect(r.wall).toBe("W-18");
    const r2 = await call(lhContext(m), "open_umbrella", { ...f7("F7.1"), lightmap: { ...F7_LIGHTMAP, steps: ["OPS-F7-99"] } });
    expect(r2.wall).toBe("W-17");
  });
});

describe("Lighthouse posts (SYS §5.2, DICT §2)", () => {
  it("T-LH-9: post_ask posts one top-level message in #demo-lighthouse and queues one E3 with its ts", async () => {
    const m = mocks();
    const r = await call(lhContext(m), "post_ask", { text: "From the task END-9514, asked by Henry: FAQ · Fees should say \"the NDA with Acme is signed\"", source_permalink: THREAD_A, asker: "Henry" });
    const p = posts(m.slack);
    expect(p).toHaveLength(1);
    expect(p[0].channel).toBe(LH);
    expect(p[0]).not.toHaveProperty("thread_ts");
    expect(m.queue.events).toHaveLength(1);
    expect(m.queue.events[0]).toMatchObject({ id: "E3", channel: LH, ts: r.ts, thread_ts: null, permalink: r.permalink, author: { name: "Lighthouse", kind: "bot" } });
    expect(m.queue.runs.lighthouse).toBe(1);
    expect(r).not.toHaveProperty("key");
  });

  it("T-LH-9: post_ask with wait: the key of the E3 run's open_umbrella, or null", async () => {
    const m = mocks();
    m.queue.setSummary({ runId: "mock", toolResults: [{ name: "open_umbrella", input: {}, result: { key: "END-9530", url: "https://linear.app/x", lightmap_reply: "…" } }] });
    const r = await call(lhContext(m), "post_ask", { text: "From the idea thread x, decided by Henry: y", source_permalink: THREAD_A, asker: "Henry", wait: true });
    expect(r.key).toBe("END-9530");
    const m2 = mocks();
    const r2 = await call(lhContext(m2), "post_ask", { text: "From the idea thread x, decided by Henry: y", source_permalink: THREAD_A, asker: "Henry", wait: true });
    expect(r2.key).toBeNull();
  });

  it("T-LH-9 (dry run): post_ask posts nothing and queues nothing; key null", async () => {
    const m = mocks();
    const r = await call(lhContext(m, { dryRun: true }), "post_ask", { text: "Revisit from x: y. Later line by Henry: z", source_permalink: THREAD_A, asker: "Henry", wait: true });
    expect(posts(m.slack)).toHaveLength(0);
    expect(m.queue.events).toHaveLength(0);
    expect(r).toMatchObject({ dry_run: true, permalink: "https://dry-run.invalid/lighthouse/1", key: null });
  });

  it("start_followup_thread: one top-level post with the exact Follow-up text; nothing queued", async () => {
    const m = mocks();
    const r = await call(lhContext(m), "start_followup_thread", { origin_key: "END-9512", page: "FAQ · Fees", line: "FAQ · Fees · changes · How much is the fee?: says 0.30%" });
    const p = posts(m.slack);
    expect(p).toHaveLength(1);
    expect(p[0].channel).toBe(LH);
    expect(p[0]).not.toHaveProperty("thread_ts");
    expect(p[0].text).toBe('Follow-up from END-9512, carry-over line: "FAQ · Fees · changes · How much is the fee?: says 0.30%"');
    expect(m.queue.events).toHaveLength(0);
    expect(r.page).toBe("FAQ · Fees");
  });

  it("T-LH-10: move_to questions and ideas: the exact Move text, top-level in the right channel", async () => {
    const m = mocks();
    await call(lhContext(m), "move_to", { channel: "questions", text: "does the fee round up or down?", source_permalink: "S", asker: "Henry" });
    await call(lhContext(m), "move_to", { channel: "ideas", text: "maybe a fee holiday in launch week?", source_permalink: "S", asker: "Henry" });
    const p = posts(m.slack);
    expect(p[0]).toMatchObject({ channel: QS, text: "Moved from S · asked by Henry\n> does the fee round up or down?" });
    expect(p[0]).not.toHaveProperty("thread_ts");
    expect(p[1].channel).toBe(IDEAS);
  });

  it("T-LH-11 (tool part): mention renders the task manager's user ID; post_reply refuses person lines with W-12", async () => {
    const m = mocks();
    await call(lhContext(m), "mention", { bot: "task-manager", thread: THREAD_A, step_id: "OPS-F0-07", text: "build the tree for END-9512" });
    expect(posts(m.slack)[0]).toMatchObject({ channel: LH, thread_ts: "1790000000.000100", text: "<@U_TM> OPS-F0-07 · build the tree for END-9512" });
    for (const [text, start] of [["OK", "OK"], ["Later: x", "Later:"], ["> go", "go"]]) {
      const r = await call(lhContext(m), "post_reply", { thread: THREAD_A, text });
      expect(r).toMatchObject({ refused: true, wall: "W-12", message: w12Message(start) });
    }
    expect(posts(m.slack)).toHaveLength(1);
  });

  it("post_reply posts in the thread of a reply's permalink; other channels are refused with the (proposed) error", async () => {
    const m = mocks();
    await call(lhContext(m), "post_reply", { thread: permalinkFor(LH, "1790000001.000200", "1790000000.000100"), text: "Refused: Refused by the harness (W-18, OPS-F6-10): …" });
    expect(posts(m.slack)[0]).toMatchObject({ channel: LH, thread_ts: "1790000000.000100" });
    const r = await call(lhContext(m), "post_reply", { thread: permalinkFor("C_BUILD_TEST", "1790000000.000100"), text: "hello" });
    expect(r).toEqual({ error: "Lighthouse posts only in #demo-lighthouse, #demo-questions and #demo-ideas." });
    expect(posts(m.slack)).toHaveLength(1);
  });

  it("dry run: a started thread's dry-run permalink is a thread for the next post", async () => {
    const m = mocks();
    const ctx = lhContext(m, { dryRun: true });
    const t = await call(ctx, "start_task_thread", { text: "Get the Acme NDA signed", source_permalink: THREAD_A });
    expect(t).toMatchObject({ dry_run: true, permalink: "https://dry-run.invalid/lighthouse/1" });
    const r = await call(ctx, "post_reply", { thread: t.permalink, text: "Before I open anything: Get the Acme NDA signed: by when, or after what?" });
    expect(r.dry_run).toBe(true);
    expect(posts(m.slack)).toHaveLength(0);
  });
});

describe("post_items_as_asks (W-19)", () => {
  const CALL_LOG = "https://www.notion.so/Henry-fee-launch-sync-3ea8f1ec11b481000000000000000001";

  it("T-LH-8: no person's OK after the list is W-19 exact; nothing posted", async () => {
    const m = mocks();
    const t = loadThread(m.slack, "thread-items-no-ok.json");
    const r = await call(lhContext(m), "post_items_as_asks", { thread: t.permalink, call_log_url: CALL_LOG, items: jsonFix("items-S4.json") });
    expect(r).toEqual({ refused: true, wall: "W-19", message: W19 });
    expect(posts(m.slack)).toHaveLength(0);
    expect(m.queue.events).toHaveLength(0);
  });

  it("T-LH-8: with Henry's OK: two asks queued as E3, item 3 to #demo-ideas, item 4 to #demo-questions, each ask with its own run's key", async () => {
    const m = mocks();
    const t = loadThread(m.slack, "thread-items-ok.json");
    let n = 0;
    m.queue.setSummary(() => {
      n += 1;
      return { runId: `mock-${n}`, toolResults: [{ name: "open_umbrella", input: {}, result: { key: n === 1 ? "END-9530" : "END-9531", url: "u", lightmap_reply: "r" } }] };
    });
    const r = await call(lhContext(m), "post_items_as_asks", { thread: t.permalink, call_log_url: CALL_LOG, items: jsonFix("items-S4.json") });
    const p = posts(m.slack);
    const lh = p.filter((x) => x.channel === LH);
    expect(lh).toHaveLength(2);
    expect(lh[0].text.startsWith(`From the call ${CALL_LOG}, item 1, asked by Henry and 서준: `)).toBe(true);
    expect(lh[1].text).toBe(`From the call ${CALL_LOG}, item 2, asked by Henry: Henry sends Acme the fee sheet by Friday`);
    expect(p.filter((x) => x.channel === QS)).toHaveLength(1);
    expect(p.filter((x) => x.channel === IDEAS)).toHaveLength(1);
    expect(p.find((x) => x.channel === IDEAS)!.text).toBe(`Moved from ${CALL_LOG} · asked by 서준 or Henry\n> a weekly fee report on X`);
    expect(m.queue.events).toHaveLength(2);
    expect(r.items.map((i: any) => [i.n, i.key ?? i.moved_to])).toEqual([
      [1, "END-9530"],
      [2, "END-9531"],
      [3, "ideas"],
      [4, "questions"],
    ]);
    expect(r.items[2].thread).toMatch(new RegExp(`/archives/${IDEAS}/p`));
    expect(r.items[3].thread).toMatch(new RegExp(`/archives/${QS}/p`));
  });

  it("T-LH-8 (dry run): W-19 still runs; nothing posted or queued; keys null", async () => {
    const m = mocks();
    const t = loadThread(m.slack, "thread-items-ok.json");
    const r = await call(lhContext(m, { dryRun: true }), "post_items_as_asks", { thread: t.permalink, call_log_url: CALL_LOG, items: jsonFix("items-S4.json") });
    expect(posts(m.slack)).toHaveLength(0);
    expect(m.queue.events).toHaveLength(0);
    expect(r.dry_run).toBe(true);
    expect(r.items.filter((i: any) => "key" in i).every((i: any) => i.key === null)).toBe(true);
  });
});

describe("Lighthouse's tools (SYS §5.2)", () => {
  it("the eight write tools in SYS §5.2 order, each description naming its wall", () => {
    expect(lighthouseWriteTools.map((t) => t.name)).toEqual(["post_reply", "move_to", "start_task_thread", "open_umbrella", "mention", "post_ask", "start_followup_thread", "post_items_as_asks"]);
    for (const t of lighthouseWriteTools) expect(t.description).toMatch(/W-1\d/);
  });
});
