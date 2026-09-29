// T9: the checker's tools and pass (TEST §2.2 T-CK-1 to T-CK-7, and the packetExtras check).
// Today is 2026-10-02 (Asia/Seoul). Fixtures are inline: fake keys END-9xxx only.
import { describe, expect, it } from "vitest";
import { BOTS } from "../src/bots/registry";
import { makeCanUseTool, w10 } from "../src/agent/permissions";
import { toolsFor } from "../src/agent/run";
import { createBotLogger } from "../src/core/log";
import { makeContext } from "../src/tools/context";
import { callTool, SDK_PREFIX, type ToolContext } from "../src/tools/define";
import { checkerPacketExtras, checkerWriteTools, findings } from "../src/tools/checker/index";
import { mockLinear, mockNotion, mockSlack, permalinkFor, testConfig, testPacket, type MockLinear, type MockSlack } from "./helpers";

const cfg = testConfig();
const L = cfg.slack.channels.lighthouse;
const I = cfg.slack.channels.ideas;
const PROJECT = cfg.linear.project_id;
const NOW = new Date("2026-10-02T09:00:00+09:00");
const DAY = 24 * 60 * 60;
/** A Slack ts `days` before NOW, plus `s` seconds. */
const tsAgo = (days: number, s = 0) => `${Math.floor(NOW.getTime() / 1000) - Math.round(days * DAY) + s}.000100`;

function ctxFor(slack: MockSlack, linear: MockLinear, dryRun = false): ToolContext {
  return makeContext(BOTS.checker, testPacket("checker"), {
    dryRun,
    runId: "checker-test",
    secrets: {},
    config: cfg,
    log: createBotLogger("checker"),
    overrides: { slack, linear, notion: mockNotion(), now: () => NOW },
  });
}

async function call(ctx: ToolContext, name: string, input: unknown) {
  const t = checkerWriteTools.find((x) => x.name === name)!;
  const r = await callTool(t, input, ctx);
  return JSON.parse(JSON.stringify(r.value));
}

const posts = (slack: MockSlack) => slack.calls.filter((c) => c.method === "chat.postMessage").map((c) => c.args);

/** What Slack then holds: the Checker's post in its thread, stamped today (so the once-a-day read sees it). */
function keepPosts(slack: MockSlack) {
  let n = 0;
  for (const p of posts(slack)) {
    const list = slack.fixtures.replies[p.thread_ts] ?? (slack.fixtures.replies[p.thread_ts] = [{ ts: p.thread_ts, user: "U_LH", text: "root" }]);
    const ts = tsAgo(0, -600 + n++);
    if (!list.some((m) => m.user === "U_CK" && m.text === p.text)) list.push({ ts, user: "U_CK", text: p.text, thread_ts: p.thread_ts });
  }
}

const issue = (key: string, title: string, due: string | null, description: string, state = "Todo", extra: Record<string, unknown> = {}) => ({
  identifier: key,
  title,
  description,
  dueDate: due,
  state: { name: state, type: state === "Canceled" ? "canceled" : state === "Done" ? "completed" : "unstarted" },
  labels: { nodes: [{ name: "Lightmap" }, { name: "Later" }] },
  assignee: { name: "Henry" },
  project: { id: PROJECT },
  inverseRelations: { nodes: [] },
  ...extra,
});

const B_ROOT = tsAgo(0, -7000);
const B_THREAD = permalinkFor(L, B_ROOT);
const B = issue("END-9101", "F7.1 · Get the Acme NDA signed", "2026-10-02", `Thread: ${B_THREAD}\nSource: Henry · 2026-10-02`);
const J = issue("END-9102", "F7.1 · Book the venue for the fee AMA", "2026-10-12", `Thread: ${permalinkFor(L, tsAgo(0, -6900))}\nSource: Henry · 2026-10-02`);
const CANCELED = issue("END-9100", "F7.1 · Old errand", "2026-09-30", `Thread: ${permalinkFor(L, tsAgo(3))}`, "Canceled");

function mocks(later: unknown[], itemLists: unknown[] = []) {
  const slack = mockSlack();
  slack.fixtures.replies[B_ROOT] = [{ ts: B_ROOT, user: "U_LH", text: "Task from …: Get the Acme NDA signed" }];
  const linear = mockLinear()
    .on("CheckerLaterTasks", { issues: { nodes: later } })
    .on("CheckerItemLists", { issues: { nodes: itemLists } });
  return { slack, linear };
}

describe("the checker's pass and ping (W-50)", () => {
  it("T-CK-1: only B is due; ping posts the Due line in B's thread; a Waits on task gives check_date", async () => {
    const m = mocks([B, J, CANCELED]);
    const ctx = ctxFor(m.slack, m.linear);
    expect(await findings(ctx)).toEqual([{ kind: "due", task_key: "END-9101", title: "F7.1 · Get the Acme NDA signed", thread: B_THREAD, owner: "Henry" }]);
    const r = await call(ctx, "ping", { thread: B_THREAD, kind: "due", subject: "F7.1 · Get the Acme NDA signed", owner: "Henry" });
    expect(r.line).toBe("Due: F7.1 · Get the Acme NDA signed · <@U_HENRY>");
    expect(posts(m.slack)).toEqual([{ channel: L, thread_ts: B_ROOT, text: "Due: F7.1 · Get the Acme NDA signed · <@U_HENRY>", unfurl_links: false }]);

    const auditRoot = tsAgo(0, -5000);
    const audit = issue("END-9105", "F7.1 · Sign off the Acme audit", "2026-10-02", `Thread: ${permalinkFor(L, auditRoot)}\nSource: Henry · 2026-10-01\nWaits on: Acme's audit report`);
    const m2 = mocks([audit]);
    const ctx2 = ctxFor(m2.slack, m2.linear);
    const f = await findings(ctx2);
    expect(f).toEqual([{ kind: "check_date", task_key: "END-9105", event: "Acme's audit report", thread: permalinkFor(L, auditRoot), owner: "Henry" }]);
    await call(ctx2, "ping", { thread: permalinkFor(L, auditRoot), kind: "check_date", subject: "Acme's audit report", owner: "Henry" });
    expect(posts(m2.slack).map((p) => p.text)).toEqual(["Has Acme's audit report happened? <@U_HENRY>"]);
  });

  it("T-CK-2: B's thread already holds today's Due line: skipped, no post; the pass run twice in one day posts one line", async () => {
    const m = mocks([B]);
    m.slack.fixtures.replies[B_ROOT].push({ ts: tsAgo(0, -60), user: "U_CK", text: "Due: F7.1 · Get the Acme NDA signed · <@U_HENRY>", thread_ts: B_ROOT });
    const ctx = ctxFor(m.slack, m.linear);
    expect(await call(ctx, "ping", { thread: B_THREAD, kind: "due", subject: "F7.1 · Get the Acme NDA signed", owner: "Henry" })).toEqual({ skipped: true, reason: "already posted today" });
    expect(posts(m.slack)).toEqual([]);

    const fresh = mocks([B]);
    const fctx = ctxFor(fresh.slack, fresh.linear);
    for (let run = 0; run < 2; run++) {
      for (const f of await findings(fctx)) {
        if (f.kind === "due") await call(fctx, "ping", { thread: f.thread, kind: "due", subject: f.title, owner: f.owner });
      }
      keepPosts(fresh.slack);
    }
    expect(posts(fresh.slack)).toHaveLength(1);
  });

  it("an F7.1 task not yet due by date is due once the issue that blocks it is Done (OPS-F7-03)", async () => {
    const blocked = issue("END-9106", "F7.1 · Send the signed NDA", null, `Thread: ${permalinkFor(L, tsAgo(1))}`, "Todo", {
      inverseRelations: { nodes: [{ type: "blocks", issue: { identifier: "END-9101", state: { name: "Done", type: "completed" } } }] },
    });
    const waiting = issue("END-9107", "F7.1 · Countersign", null, `Thread: ${permalinkFor(L, tsAgo(1, 5))}`, "Todo", {
      inverseRelations: { nodes: [{ type: "blocks", issue: { identifier: "END-9101", state: { name: "Todo", type: "unstarted" } } }] },
    });
    const m = mocks([waiting, blocked]);
    expect((await findings(ctxFor(m.slack, m.linear))).map((f) => ("task_key" in f ? f.task_key : null))).toEqual(["END-9106"]);
  });
});

describe("hand_on (W-50)", () => {
  const ideaThread = permalinkFor(I, tsAgo(1));
  it("T-CK-3: K, an F7.3 revisit due today, is handed to the question/idea agent in K's thread", async () => {
    const kRoot = tsAgo(0, -4000);
    const K = issue("END-9103", "F7.3 · Revisit: fee holiday in launch week", "2026-10-02", `Thread: ${permalinkFor(L, kRoot)}\nSource: Henry · 2026-10-02 · ${ideaThread}`);
    const m = mocks([K]);
    const ctx = ctxFor(m.slack, m.linear);
    const f = await findings(ctx);
    expect(f).toEqual([{ kind: "hand_on", to: "question-idea", step_id: "OPS-F7-10", task_key: "END-9103", thread: permalinkFor(L, kRoot), idea_thread: ideaThread }]);
    const r = await call(ctx, "hand_on", { thread: permalinkFor(L, kRoot), to: "question-idea", step_id: "OPS-F7-10", task_key: "END-9103", text: ideaThread });
    expect(r.line).toBe(`<@U_QI> OPS-F7-10 · END-9103 is due: reopen ${ideaThread}`);
    expect(posts(m.slack)).toEqual([{ channel: L, thread_ts: kRoot, text: `<@U_QI> OPS-F7-10 · END-9103 is due: reopen ${ideaThread}`, unfurl_links: false }]);
    keepPosts(m.slack);
    expect(await call(ctx, "hand_on", { thread: permalinkFor(L, kRoot), to: "question-idea", step_id: "OPS-F7-10", task_key: "END-9103", text: ideaThread })).toEqual({ skipped: true, reason: "already posted today" });
  });

  it("T-CK-4: an F7.2 task due today is handed to Lighthouse to re-stamp", async () => {
    const root = tsAgo(0, -3000);
    const later = issue("END-9104", "F7.2 · Ship the fee calculator", "2026-10-01", `Thread: ${permalinkFor(L, root)}\nSource: Henry · 2026-09-20`);
    const m = mocks([later]);
    const ctx = ctxFor(m.slack, m.linear);
    expect(await findings(ctx)).toEqual([{ kind: "hand_on", to: "lighthouse", step_id: "OPS-F7-08", task_key: "END-9104", thread: permalinkFor(L, root) }]);
    await call(ctx, "hand_on", { thread: permalinkFor(L, root), to: "lighthouse", step_id: "OPS-F7-08", task_key: "END-9104" });
    expect(posts(m.slack).map((p) => p.text)).toEqual(["<@U_LH> OPS-F7-08 · END-9104 is due: re-stamp it"]);
    expect(await call(ctx, "hand_on", { thread: permalinkFor(L, root), to: "lighthouse", step_id: "OPS-F7-10", task_key: "END-9104" })).toEqual({
      error: "hand_on to lighthouse is OPS-F7-08; to question-idea is OPS-F7-10.",
    });
  });
});

describe("quiet ideas and item lists waiting for an OK (W-51)", () => {
  it("T-CK-5: only the 15-day-old thread with no reply is quiet; ping asks Go, later or no? in it", async () => {
    const m = mocks([]);
    const quiet = tsAgo(15);
    const young = tsAgo(13);
    const parked = tsAgo(20);
    const asked = tsAgo(15, 30);
    m.slack.fixtures.history = [
      { ts: quiet, user: "U_LH", text: "Moved from … · asked by Henry\n> a fee rebate for early users?" },
      { ts: young, user: "U_HENRY", text: "A fee calculator page?" },
      { ts: parked, user: "U_HENRY", text: "Dark mode for the docs?" },
      { ts: asked, user: "U_HENRY", text: "Referral fees?" },
    ];
    m.slack.fixtures.replies[parked] = [
      { ts: parked, user: "U_HENRY", text: "Dark mode for the docs?" },
      { ts: tsAgo(16), user: "U_HENRY", text: "Later: after launch; revisit on November 5, 2026.", thread_ts: parked },
    ];
    m.slack.fixtures.replies[asked] = [
      { ts: asked, user: "U_HENRY", text: "Referral fees?" },
      { ts: tsAgo(3), user: "U_CK", text: "Go, later or no? <@U_HENRY>", thread_ts: asked },
    ];
    const ctx = ctxFor(m.slack, m.linear);
    expect(await findings(ctx)).toEqual([{ kind: "quiet_idea", thread: permalinkFor(I, quiet) }]);
    const r = await call(ctx, "ping", { thread: permalinkFor(I, quiet), kind: "quiet_idea" });
    expect(r.line).toBe("Go, later or no? <@U_HENRY>");
    expect(posts(m.slack)).toEqual([{ channel: I, thread_ts: quiet, text: "Go, later or no? <@U_HENRY>", unfurl_links: false }]);
    expect(await call(ctx, "ping", { thread: B_THREAD, kind: "quiet_idea" })).toEqual({
      error: "quiet_idea pings a #demo-ideas thread; due, check_date and waiting_ok ping a #demo-lighthouse thread.",
    });
  });

  const G_ROOT = tsAgo(0, -20000);
  const G_THREAD = permalinkFor(L, G_ROOT);
  const G = {
    identifier: "END-9108",
    title: "F5.1 · Henry + 서준: fee launch sync",
    description: `Thread: ${G_THREAD}\nSource: Henry · 2026-10-02`,
    state: { name: "In Progress", type: "started" },
    project: { id: PROJECT },
  };
  function itemThread(after: { user: string; text: string }[]) {
    const m = mocks([], [G]);
    m.slack.fixtures.replies[G_ROOT] = [
      { ts: G_ROOT, user: "U_LH", text: "END-9108 · F5.1 · Henry + 서준: fee launch sync" },
      { ts: tsAgo(0, -19000), user: "U_EA", text: 'OPS-F5-02 · Items from "Henry + 서준: fee launch sync":\n1. Decision · Launch at 25 bps · Henry · line 12: "25 it is"', thread_ts: G_ROOT },
      ...after.map((a, i) => ({ ts: tsAgo(0, -18000 + i), user: a.user, text: a.text, thread_ts: G_ROOT })),
    ];
    return m;
  }

  it("T-CK-7: an item list with no person's OK after it waits; ping waiting_ok once a day; Henry's OK clears it, the Entry agent's doesn't", async () => {
    const m = itemThread([]);
    const ctx = ctxFor(m.slack, m.linear);
    expect(await findings(ctx)).toEqual([{ kind: "waiting_ok", task_key: "END-9108", thread: G_THREAD }]);
    const line = "The item list above waits for an OK from someone who was on the call. <@U_HENRY>";
    expect((await call(ctx, "ping", { thread: G_THREAD, kind: "waiting_ok" })).line).toBe(line);
    expect(posts(m.slack)).toEqual([{ channel: L, thread_ts: G_ROOT, text: line, unfurl_links: false }]);
    keepPosts(m.slack);
    expect(await call(ctx, "ping", { thread: G_THREAD, kind: "waiting_ok" })).toEqual({ skipped: true, reason: "already posted today" });
    expect(posts(m.slack)).toHaveLength(1);

    const ok = itemThread([{ user: "U_HENRY", text: "OK" }]);
    expect(await findings(ctxFor(ok.slack, ok.linear))).toEqual([]);
    const botOk = itemThread([{ user: "U_EA", text: "OK" }]);
    expect(await findings(ctxFor(botOk.slack, botOk.linear))).toEqual([{ kind: "waiting_ok", task_key: "END-9108", thread: G_THREAD }]);
  });
});

describe("the checker's tools and packet", () => {
  it("T-CK-6: canUseTool allows ping, hand_on and the reads; denies post_reply, move_to, close_thread and Bash with W-10", async () => {
    const allowed = new Set(toolsFor(BOTS.checker).map((t) => `${SDK_PREFIX}${t.name}`));
    const can = makeCanUseTool(BOTS.checker, allowed, createBotLogger("checker"));
    const opts = { signal: new AbortController().signal, toolUseID: "t", requestId: "r" } as never;
    const reads = ["read_thread", "linear_get", "linear_find", "notion_search", "notion_read", "github_read", "list_idea_threads"];
    for (const n of ["ping", "hand_on", ...reads]) expect(await can(`${SDK_PREFIX}${n}`, {}, opts)).toEqual({ behavior: "allow" });
    for (const n of ["mcp__endix__post_reply", "mcp__endix__move_to", "mcp__endix__close_thread", "Bash"]) {
      expect(await can(n, {}, opts)).toEqual({ behavior: "deny", message: w10(BOTS.checker, n) });
    }
    expect(w10(BOTS.checker, "Bash")).toBe("Refused by the harness (W-10, OPS-A4-10): Checker has no tool Bash. Use only your tools.");
    expect(checkerWriteTools.map((t) => t.name)).toEqual(["ping", "hand_on"]);
  });

  it("checkerPacketExtras on the T-CK-1 mocks returns { findings } equal to findings(ctx)", async () => {
    const m = mocks([B, J, CANCELED]);
    const ctx = ctxFor(m.slack, m.linear);
    expect(await checkerPacketExtras(testPacket("checker"), ctx)).toEqual({ findings: await findings(ctx) });
    expect(BOTS.checker.packetExtras).toBe(checkerPacketExtras);
  });

  it("the pass writes nothing, and ping in dry run posts nothing", async () => {
    const m = mocks([B]);
    const ctx = ctxFor(m.slack, m.linear, true);
    await findings(ctx);
    expect(m.linear.calls.filter((c) => /^\s*mutation/.test(c.query))).toEqual([]);
    const r = await call(ctx, "ping", { thread: B_THREAD, kind: "due", subject: "F7.1 · Get the Acme NDA signed", owner: "Henry" });
    expect(r.dry_run).toBe(true);
    expect(posts(m.slack)).toEqual([]);
  });
});
