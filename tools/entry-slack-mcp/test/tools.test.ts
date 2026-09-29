// T-EA-2, T-EA-3, T-EA-4 (TEST §2.2) and the unnamed tool checks, on a fake WebClient:
// nothing here reaches Slack.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig, type EntryConfig } from "../src/env";
import { parsePermalink, type SlackMessage } from "../src/slack";
import { createTools, type ToolResult } from "../src/tools";

const here = fileURLToPath(new URL(".", import.meta.url));
const FIXTURE = `${here}fixtures/demo.config.json`;
const PERSON_LINES = fileURLToPath(new URL("../../../bots/runtime/test/fixtures/person-lines.json", import.meta.url));

const LH = "C0C61PKP10Q"; // #demo-lighthouse in the fixture
const QUESTIONS = "C0C61PKLZT2"; // #demo-questions
const THREAD = `https://endix-demo.slack.com/archives/${LH}/p1759370000000100`;
const REPLY_IN_THREAD = `https://endix-demo.slack.com/archives/${LH}/p1759370000000400?thread_ts=1759370000.000100&cid=${LH}`;
const QUESTION_THREAD = `https://endix-demo.slack.com/archives/${QUESTIONS}/p1759370000000100`;
const NOTION = "https://www.notion.so/3ea8f1ec11b4816d8adae5fa98d19815";

const W12 = (start: string) =>
  `Refused by the harness (W-12, OPS-F2-33, OPS-F4-10, OPS-F5-11, OPS-F6-11, OPS-F7-16): only Henry or 서준 post "${start}". Ask them in the thread.`;

type Call = { method: string; args: Record<string, unknown> };

function fakeSlack(opts: { replies?: SlackMessage[]; postError?: string } = {}) {
  const calls: Call[] = [];
  let n = 300;
  const slack = {
    conversations: {
      async replies(args: Record<string, unknown>) {
        calls.push({ method: "conversations.replies", args });
        return { ok: true, messages: opts.replies ?? [] };
      },
    },
    chat: {
      async postMessage(args: Record<string, unknown>) {
        calls.push({ method: "chat.postMessage", args });
        if (opts.postError) throw Object.assign(new Error("An API error occurred"), { code: "slack_webapi_platform_error", data: { ok: false, error: opts.postError } });
        return { ok: true, ts: `1759370000.000${n++}` };
      },
      async getPermalink(args: { channel: string; message_ts: string }) {
        calls.push({ method: "chat.getPermalink", args });
        return { ok: true, permalink: `https://endix-demo.slack.com/archives/${args.channel}/p${args.message_ts.replace(".", "")}` };
      },
    },
  };
  return { slack, calls, posts: () => calls.filter((c) => c.method === "chat.postMessage") };
}

function config(patch?: (c: EntryConfig) => void): EntryConfig {
  const c = loadConfig(FIXTURE);
  patch?.(c);
  return c;
}

function tools(opts?: Parameters<typeof fakeSlack>[0], patch?: (c: EntryConfig) => void) {
  const fake = fakeSlack(opts);
  return { ...fake, t: createTools({ slack: fake.slack, config: config(patch) }) };
}

const json = (r: ToolResult) => JSON.parse(r.content[0].text);

describe("endix-entry-slack tools", () => {
  it("T-EA-2 post_in_thread with a #demo-questions permalink returns the W-01 refusal and calls nothing", async () => {
    const { t, calls } = tools();
    const r = await t.post_in_thread({ permalink: QUESTION_THREAD, text: "OPS-F1-10 · Draft for Fee model" });
    expect(r.isError).toBe(true);
    expect(json(r)).toEqual({
      refused: true,
      wall: "W-01",
      message: "Refused by the harness (W-01, OPS-A4-32): endix-entry-slack reads and posts only in #demo-lighthouse.",
    });
    expect(calls).toEqual([]);
  });

  it("T-EA-2 the channel fence holds for read_thread and hand_off too", async () => {
    const { t, calls } = tools();
    expect(json(await t.read_thread({ permalink: QUESTION_THREAD })).wall).toBe("W-01");
    const r = await t.hand_off({ permalink: QUESTION_THREAD, manager: "doc", step_id: "OPS-F1-13", what: "x", where: NOTION });
    expect(json(r).wall).toBe("W-01");
    expect(calls).toEqual([]);
  });

  it("T-EA-3 hand_off posts the exact DICT §2 line to the doc manager and the task manager, in the thread", async () => {
    const { t, posts } = tools();
    const doc = await t.hand_off({ permalink: THREAD, manager: "doc", step_id: "OPS-F1-13", what: "apply the draft above to Fee model", where: NOTION });
    expect(doc.isError).toBeUndefined();
    expect(json(doc)).toEqual({
      ok: true,
      ts: "1759370000.000300",
      permalink: "https://endix-demo.slack.com/archives/C0C61PKP10Q/p1759370000000300",
    });
    const task = await t.hand_off({ permalink: REPLY_IN_THREAD, manager: "task", step_id: "OPS-F2-07", what: "set END-908 to In Progress", where: "END-908 https://linear.app/endix/issue/END-908" });
    expect(json(task).ok).toBe(true);
    expect(posts().map((p) => p.args)).toEqual([
      { channel: LH, text: `<@U_DM> OPS-F1-13 · apply the draft above to Fee model · ${NOTION}`, thread_ts: "1759370000.000100", unfurl_links: false },
      { channel: LH, text: "<@U_TM> OPS-F2-07 · set END-908 to In Progress · END-908 https://linear.app/endix/issue/END-908", thread_ts: "1759370000.000100", unfurl_links: false },
    ]);
  });

  it("T-EA-3 post_in_thread renders <@Task manager> and replies in the permalink's thread", async () => {
    const { t, posts } = tools();
    const r = await t.post_in_thread({ permalink: THREAD, text: `<@Task manager> OPS-F1-10 · Change in the thread: ${REPLY_IN_THREAD}` });
    expect(json(r).ok).toBe(true);
    expect(posts()[0].args).toEqual({
      channel: LH,
      text: `<@U_TM> OPS-F1-10 · Change in the thread: ${REPLY_IN_THREAD}`,
      thread_ts: "1759370000.000100",
      unfurl_links: false,
    });
  });

  it("T-EA-4 a person line in each free-text input of each post tool is refused with the exact W-12 text; nothing is posted", async () => {
    const { t, calls } = tools();
    const cases: [ToolResult, string][] = [
      [await t.post_in_thread({ permalink: THREAD, text: "OK" }), "OK"],
      [await t.post_ask({ who_asked: "Henry", what_for: "Done: sent", links: [] }), "Done:"],
      [await t.hand_off({ permalink: THREAD, manager: "task", step_id: "OPS-F2-04", what: "go", where: "END-905" }), "go"],
      [await t.hand_off({ permalink: THREAD, manager: "doc", step_id: "OPS-F1-13", what: "apply the draft", where: "Later: after launch" }), "Later:"],
    ];
    for (const [r, start] of cases) {
      expect(r.isError).toBe(true);
      expect(json(r)).toEqual({ refused: true, wall: "W-12", message: W12(start) });
    }
    expect(calls).toEqual([]);
  });

  it("T-EA-4 a closing line is refused too: endix-entry-slack has no closing tool", async () => {
    const { t, calls } = tools();
    const r = await t.post_in_thread({ permalink: THREAD, text: "Answered: see the Fee model page" });
    expect(json(r)).toEqual({ refused: true, wall: "W-12", message: W12("Answered:") });
    expect(calls).toEqual([]);
  });

  it("T-EA-4 the outputs of a person's step pass the guard and are posted (DICT §2)", async () => {
    const { t, posts } = tools();
    const go = "https://github.com/endix-labs-v1/harness-demo/discussions/1#discussioncomment-1";
    const pr = "https://github.com/endix-labs-v1/harness-demo/pull/2";
    expect(json(await t.post_in_thread({ permalink: THREAD, text: `<@Task manager> OPS-F2-04 · go by Henry: ${go}` })).ok).toBe(true);
    expect(json(await t.post_in_thread({ permalink: THREAD, text: `<@Task manager> OPS-F2-09 · approved by Seojun (demo): ${pr}` })).ok).toBe(true);
    expect(posts().map((p) => p.args.text)).toEqual([
      `<@U_TM> OPS-F2-04 · go by Henry: ${go}`,
      `<@U_TM> OPS-F2-09 · approved by Seojun (demo): ${pr}`,
    ]);
  });

  it.skipIf(!existsSync(PERSON_LINES))("T-EA-4 T-G-1's 40 strings through post_in_thread give T-G-1's results", async () => {
    const raw = JSON.parse(readFileSync(PERSON_LINES, "utf8"));
    const rows: { text: string; refused: boolean }[] = (Array.isArray(raw) ? raw : raw.cases ?? raw.strings ?? []).map(
      (r: Record<string, unknown>) => ({ text: String(r.text ?? r.input ?? r.string), refused: Boolean(r.refused) }),
    );
    expect(rows.length).toBe(40);
    for (const row of rows) {
      const { t, posts } = tools();
      const r = json(await t.post_in_thread({ permalink: THREAD, text: row.text }));
      expect({ text: row.text, refused: r.refused === true }).toEqual({ text: row.text, refused: row.refused });
      expect(posts().length).toBe(row.refused ? 0 : 1);
    }
  });

  it("post_ask posts DICT §2's three lines as a new #demo-lighthouse thread", async () => {
    const { t, posts } = tools();
    const r = await t.post_ask({ who_asked: "Henry", what_for: 'fix the typo "recieve" in docs/usage.md and push it', links: [] });
    expect(json(r)).toEqual({ ok: true, ts: "1759370000.000300", permalink: "https://endix-demo.slack.com/archives/C0C61PKP10Q/p1759370000000300" });
    expect(posts()[0].args).toEqual({
      channel: LH,
      text: 'Ask from Henry via Claude Code: fix the typo "recieve" in docs/usage.md and push it\nAgent: Claude Code in harness-demo\nLinks: none',
      unfurl_links: false,
    });
    await t.post_ask({ who_asked: "Henry", what_for: "change the fee", links: ["https://a.example/1", "https://a.example/2"] });
    expect(String(posts()[1].args.text).split("\n")[2]).toBe("Links: https://a.example/1, https://a.example/2");
  });

  it("post_ask takes exactly who_asked, what_for and links (no wait input)", async () => {
    const { t, calls } = tools();
    const r = await t.post_ask({ who_asked: "Henry", what_for: "x" });
    expect(r.isError).toBe(true);
    expect(json(r).error).toMatch(/^invalid input: links/);
    expect(calls).toEqual([]);
  });

  it("post_in_thread warns for a mention whose ID is empty in config and leaves it as written", async () => {
    const { t, posts } = tools({}, (c) => (c.people.henry.slack_user_id = ""));
    const r = json(await t.post_in_thread({ permalink: THREAD, text: "OPS-F1-10 · Draft for Fee model\n<@Henry> please OK or send back." }));
    expect(r.warnings).toEqual(["no Slack user ID for Henry in config"]);
    expect(posts()[0].args.text).toBe("OPS-F1-10 · Draft for Fee model\n<@Henry> please OK or send back.");
  });

  it("hand_off with an empty manager ID returns the config error and posts nothing", async () => {
    const { t, calls } = tools({}, (c) => (c.slack.bots.doc_manager.user_id = ""));
    const r = await t.hand_off({ permalink: THREAD, manager: "doc", step_id: "OPS-F1-13", what: "apply", where: NOTION });
    expect(json(r)).toEqual({ error: "config slack.bots.doc_manager.user_id is empty (T2 fills it)" });
    expect(calls).toEqual([]);
  });

  it("hand_off refuses a step ID that isn't a full OPS ID", async () => {
    const { t, calls } = tools();
    const r = await t.hand_off({ permalink: THREAD, manager: "doc", step_id: "F1-13", what: "apply", where: NOTION });
    expect(json(r).error).toMatch(/^invalid input: step_id/);
    expect(calls).toEqual([]);
  });

  it("a Slack API error comes back as its code", async () => {
    const { t } = tools({ postError: "not_in_channel" });
    const r = await t.post_in_thread({ permalink: THREAD, text: "OPS-F2-12 · no doc change: a test" });
    expect(r.isError).toBe(true);
    expect(json(r)).toEqual({ error: "not_in_channel" });
  });

  it("read_thread returns the thread oldest first with author kinds and permalinks", async () => {
    const { t, calls } = tools({
      replies: [
        { ts: "1759370000.000200", user: "U_LH", text: "END-901 · F1.2 · …" },
        { ts: "1759370000.000100", user: "U_HENRY", text: "Change the fee on the FAQ · Fees page to 0.25%." },
        { ts: "1759370000.000300", bot_id: "B_ACTIONS", text: "Discussion opened" },
        { ts: "1759370000.000400", user: "U_SOMEONE", text: "hi" },
      ],
    });
    const r = json(await t.read_thread({ permalink: REPLY_IN_THREAD }));
    expect(calls[0]).toEqual({ method: "conversations.replies", args: { channel: LH, ts: "1759370000.000100", limit: 100 } });
    expect(r.messages.map((m: { ts: string; author: unknown }) => [m.ts, m.author])).toEqual([
      ["1759370000.000100", { name: "Henry", kind: "person" }],
      ["1759370000.000200", { name: "Lighthouse", kind: "bot" }],
      ["1759370000.000300", { name: "Endix Actions", kind: "bot" }],
      ["1759370000.000400", { name: "U_SOMEONE", kind: "other" }],
    ]);
    expect(r.messages[0].permalink).toBe("https://endix-demo.slack.com/archives/C0C61PKP10Q/p1759370000000100");
  });

  it("parsePermalink reads a thread reply's permalink and refuses anything else", () => {
    expect(parsePermalink(REPLY_IN_THREAD)).toEqual({ channel: LH, ts: "1759370000.000400", threadTs: "1759370000.000100" });
    expect(parsePermalink(THREAD)).toEqual({ channel: LH, ts: "1759370000.000100", threadTs: null });
    expect(() => parsePermalink("https://example.com/x")).toThrow("Not a Slack permalink: https://example.com/x");
  });
});
