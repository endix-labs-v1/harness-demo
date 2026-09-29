import { describe, expect, it } from "vitest";
import { classify, applyTestChannel, type SlackMessage } from "../src/events/classify";
import { EVENT_PRECEDENCE, EVENT_TABLE } from "../src/events/table";
import { Dispatcher, e16Match, selfMatch, type RunSummary } from "../src/events/dispatch";
import { Deduper } from "../src/core/dedupe";
import { ThreadQueue } from "../src/core/queue";
import { createBotLogger } from "../src/core/log";
import { BOTS } from "../src/bots/registry";
import { buildPacket } from "../src/packet/build";
import type { EventMatch } from "../src/events/classify";
import { mockSlack, testConfig } from "./helpers";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const config = testConfig();
const LH = config.slack.channels.lighthouse;
const Q = config.slack.channels.questions;
const I = config.slack.channels.ideas;
const BT = config.slack.channels.build_test;

type TM = { ts: string; user: string; text: string };
const threads: Record<string, TM[]> = {};
const labels: Record<string, string[]> = { "END-540": ["Lightmap", "Later"], "END-541": ["Lightmap"] };
let n = 0;
function thread(channel: string, msgs: Omit<TM, "ts">[]): string {
  n += 1;
  const root = `17900${String(n).padStart(5, "0")}.000100`;
  threads[`${channel}|${root}`] = msgs.map((m, i) => ({ ts: `17900${String(n).padStart(5, "0")}.00${String(i + 1).padStart(2, "0")}00`, ...m }));
  threads[`${channel}|${root}`][0].ts = root;
  return root;
}

const NAMES: Record<string, string> = { U_HENRY: "Henry", U_LH: "Lighthouse", U_TM: "Task manager", U_DM: "Doc manager", U_QI: "Question/idea agent", U_CK: "Checker", U_EA: "Entry agent" };

async function wake(msg: SlackMessage, cfg = config): Promise<Record<string, string>> {
  const matches = await classify(msg, {
    config: cfg,
    threadOf: async (_bot, channel, ts) =>
      (threads[`${channel}|${ts}`] ?? []).map((m) => ({ ts: m.ts, author: { name: NAMES[m.user] ?? m.user, kind: m.user === "U_HENRY" ? "person" : "bot" }, text: m.text })),
    issueLabels: async (key) => labels[key] ?? [],
  });
  return Object.fromEntries(matches.map((m) => [m.bot, m.id]));
}

const top = (channel: string, user: string, text: string, extra: Partial<SlackMessage> = {}): SlackMessage => ({ channel, ts: `1790${String(++n).padStart(6, "0")}.000100`, user, text, ...extra });
const reply = (channel: string, root: string, user: string, text: string): SlackMessage => ({ channel, ts: `${root.split(".")[0]}.009900`, thread_ts: root, user, text });

describe("event table (SYS §4.2)", () => {
  it("T-R-14: the table has the 17 rows in order and EVENT_PRECEDENCE is SYS §4.2's order", () => {
    expect(EVENT_TABLE.map((r) => r.id)).toEqual(["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E9", "E10", "E11", "E12", "E13", "E14", "E15", "E16", "E17"]);
    expect(EVENT_PRECEDENCE).toEqual(["E1", "E2", "E3", "E4", "E17", "E5", "E6", "E7", "E8", "E9", "E10", "E11", "E12", "E14", "E15", "E13", "E16"]);
  });

  it("T-R-14: each Slack row wakes its bot with that row's ID", async () => {
    expect(await wake(top(LH, "U_HENRY", "Update the fee page"))).toEqual({ lighthouse: "E1" });
    expect(await wake(top(LH, "U_EA", "OPS-F0-02 · Henry asks: update the fee page"))).toEqual({ lighthouse: "E2" });
    const askBack = thread(LH, [
      { user: "U_HENRY", text: "Remind me to book the venue" },
      { user: "U_LH", text: "Before I open anything: book the venue: by when, or after what?" },
    ]);
    expect(await wake(reply(LH, askBack, "U_HENRY", "by Friday"))).toEqual({ lighthouse: "E4" });
    expect(await wake(top(Q, "U_HENRY", "<@U_LH> can you look?"))).toEqual({ lighthouse: "E5", "question-idea": "E12" });
    const f5 = thread(LH, [
      { user: "U_EA", text: "OPS-F5-01 · Call held" },
      { user: "U_LH", text: "END-600 · F5.1 · Recorded call: fee sync. Lightmap below." },
      { user: "U_EA", text: 'OPS-F5-02 · Items from "Fee sync": 1. Decision …' },
    ]);
    expect(await wake(reply(LH, f5, "U_HENRY", "OK"))).toEqual({ lighthouse: "E6" });
    const idea = thread(I, [{ user: "U_HENRY", text: "What if we had a fee holiday?" }]);
    expect(await wake(reply(I, idea, "U_HENRY", "Go: ship the fee holiday"))).toEqual({ lighthouse: "E7", "question-idea": "E13" });
    const q = thread(Q, [
      { user: "U_HENRY", text: "How are fees rounded?" },
      { user: "U_LH", text: "Proposed flows: 1. F1.2 · Change a page" },
    ]);
    expect(await wake(reply(Q, q, "U_HENRY", "go"))).toEqual({ lighthouse: "E8", "question-idea": "E13" });
    expect(await wake(top(LH, "U_LH", "END-512 · F1.2 · x <@U_TM> OPS-F0-07 · build the tree"))).toEqual({ "task-manager": "E9" });
    const later = thread(LH, [
      { user: "U_HENRY", text: "Remind me to send the deck" },
      { user: "U_LH", text: "END-540 · F7.1 · Send the deck. Due 2026-10-05." },
    ]);
    expect(await wake(reply(LH, later, "U_HENRY", "Done: sent"))).toEqual({ "task-manager": "E10" });
    expect(await wake(top(LH, "U_LH", "<@U_DM> OPS-F1-13 · apply the change"))).toEqual({ "doc-manager": "E11" });
    expect(await wake(top(I, "U_HENRY", "A fee holiday for new users?"))).toEqual({ "question-idea": "E12" });
    expect(await wake(top(I, "U_LH", "Moved from #demo-lighthouse: a fee holiday"))).toEqual({ "question-idea": "E12" });
    const q2 = thread(Q, [{ user: "U_HENRY", text: "How are fees rounded?" }]);
    expect(await wake(reply(Q, q2, "U_HENRY", "And for refunds?"))).toEqual({ "question-idea": "E13" });
    const idea2 = thread(I, [{ user: "U_HENRY", text: "A fee holiday?" }]);
    expect(await wake(reply(I, idea2, "U_HENRY", "No: not now"))).toEqual({ "question-idea": "E14" });
    const revisit = thread(LH, [{ user: "U_LH", text: "END-542 · F7.3 · Revisit: a fee holiday." }]);
    expect(await wake(reply(LH, revisit, "U_TM", "<@U_QI> OPS-F7-10 · reopen the idea"))).toEqual({ "question-idea": "E15" });
  });

  it("T-R-14: several rows of one bot: SYS §4.2's order picks the event", async () => {
    const t = thread(LH, [
      { user: "U_HENRY", text: "Remind me to send the deck" },
      { user: "U_LH", text: "END-540 · F7.1 · Send the deck." },
    ]);
    expect((await wake(reply(LH, t, "U_TM", "<@U_LH> OPS-F7-07 · END-540 closed; Done line names FAQ · Fees")))["lighthouse"]).toBe("E17");
    expect((await wake(reply(LH, t, "U_CK", "<@U_LH> OPS-F7-08 · END-540 is due: re-stamp it")))["lighthouse"]).toBe("E17");
    expect((await wake(reply(LH, t, "U_TM", "<@U_LH> please look")))["lighthouse"]).toBe("E5");
    const idea = thread(I, [{ user: "U_HENRY", text: "A fee holiday?" }]);
    expect((await wake(reply(I, idea, "U_HENRY", "No: not now")))["question-idea"]).toBe("E14");
    expect((await wake(reply(I, idea, "U_HENRY", "<@U_QI> what's your view?")))["question-idea"]).toBe("E15");
    expect((await wake(top(Q, "U_HENRY", "<@U_QI> how are fees rounded?")))["question-idea"]).toBe("E12");
    const q = thread(Q, [
      { user: "U_HENRY", text: "How are fees rounded?" },
      { user: "U_LH", text: "Proposed flows: 1. F1.2" },
    ]);
    expect(await wake(reply(Q, q, "U_HENRY", "Answer: yes"))).toEqual({ lighthouse: "E8", "question-idea": "E13" });
  });

  it("T-R-14: the ten non-events wake nobody", async () => {
    const dot = thread(LH, [
      { user: "U_HENRY", text: "Update the fee page" },
      { user: "U_LH", text: "END-512 · F1.2 · Update the fee page. Lightmap below." },
    ]);
    const lightmapOnly = thread(LH, [
      { user: "U_HENRY", text: "Update the FAQ" },
      { user: "U_LH", text: "END-541 · F1.2 · Update the FAQ." },
    ]);
    const qThread = thread(Q, [{ user: "U_HENRY", text: "How are fees rounded?" }]);
    const nonEvents: SlackMessage[] = [
      top(LH, "U_LH", "END-512 · F1.2 · Update the fee page"),
      top(LH, "U_HENRY", "edited", { subtype: "message_changed" }),
      top(LH, "U_HENRY", "", { subtype: "message_deleted" }),
      top(LH, "U_HENRY", "<@U_HENRY> has joined the channel", { subtype: "channel_join" }),
      top(BT, "U_HENRY", "<@U_LH> <@U_QI> hello"),
      reply(LH, dot, "U_HENRY", "thanks"),
      top(LH, "", "PR merged", { user: null, bot_id: "B_ACTIONS", subtype: "bot_message" }),
      top(LH, "U_DM", "OPS-F1-13 · page updated"),
      reply(LH, lightmapOnly, "U_HENRY", "Done: sent"),
      reply(Q, qThread, "U_LH", "Proposed flows: 1. F1.2"),
    ];
    expect(nonEvents).toHaveLength(10);
    for (const m of nonEvents) expect(await wake(m), JSON.stringify(m)).toEqual({});
  });

  it("Henry's line posted through the Demo reset app (app_id, bot_id, bot_profile) is a person's line", async () => {
    const msg = { ...top(LH, "U_HENRY", "Update the fee page"), bot_id: "B_RESET", app_id: "A_RESET", bot_profile: { name: "Demo reset" } } as SlackMessage;
    expect(await wake(msg)).toEqual({ lighthouse: "E1" });
  });

  it("--test-channel: #demo-build-test plays #demo-lighthouse and the real channel wakes nobody", async () => {
    const cfg = applyTestChannel(config);
    expect(await wake(top(BT, "U_HENRY", "Update the fee page"), cfg)).toEqual({ lighthouse: "E1" });
    expect(await wake(top(LH, "U_HENRY", "Update the fee page"), cfg)).toEqual({});
    expect(await wake(top(BT, "U_HENRY", "Update the fee page"))).toEqual({});
  });

  function dispatcher(ran: EventMatch[]) {
    const home = mkdtempSync(join(tmpdir(), "endix-disp-"));
    return new Dispatcher({
      deduper: new Deduper(join(home, "seen.jsonl")),
      queue: new ThreadQueue(3),
      loggerFor: (b) => createBotLogger(b),
      stopRequested: () => false,
      run: async (m): Promise<RunSummary> => {
        ran.push(m);
        return { runId: `${m.bot}-run`, toolResults: [] };
      },
    });
  }

  it("T-R-14: E3 through Lighthouse's enqueueSelf, E16 through the --once path", async () => {
    const ran: EventMatch[] = [];
    const d = dispatcher(ran);
    await d.enqueue(selfMatch(BOTS.lighthouse, config, { id: "E3", channel: LH, ts: "1790000100.000100", thread_ts: null, permalink: "https://endix.slack.com/archives/C0C61PKP10Q/p1790000100000100", author: { name: "Lighthouse", kind: "bot" }, text: "Ask: book the venue" }));
    await d.enqueue(e16Match("manual"));
    expect(ran.map((m) => [m.bot, m.id])).toEqual([["lighthouse", "E3"], ["checker", "E16"]]);
    const packet = await buildPacket(e16Match("manual"), { def: BOTS.checker, config, slack: mockSlack() as any });
    expect(packet.event).toEqual({ id: "E16", channel: null, ts: null, thread_ts: null, permalink: null, author: { name: "npm run checker", kind: "manual" }, text: "Checker pass" });
  });

  it("enqueueSelf: the Question/idea agent's E12 runs it; E3 from the Question/idea agent throws", async () => {
    const ran: EventMatch[] = [];
    const d = dispatcher(ran);
    const e12 = { id: "E12" as const, channel: I, ts: "1790000200.000100", thread_ts: null, permalink: "https://endix.slack.com/archives/C0C55EFGY5C/p1790000200000100", author: { name: "Question/idea agent" as const, kind: "bot" as const }, text: "Moved here" };
    const s = await d.enqueue(selfMatch(BOTS["question-idea"], config, e12));
    expect(s.runId).toBe("question-idea-run");
    expect(ran.map((m) => [m.bot, m.id])).toEqual([["question-idea", "E12"]]);
    expect(() => selfMatch(BOTS["question-idea"], config, { ...e12, id: "E3", channel: LH, author: { name: "Question/idea agent", kind: "bot" } })).toThrow(
      `enqueueSelf: E3 in ${LH} is not an event of Question/idea agent.`,
    );
  });
});
