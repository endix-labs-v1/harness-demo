// T9: the question/idea agent's tools (TEST §2.2 T-QI-5 to T-QI-8, and the unnamed unit tests).
// Fixtures are inline: fake keys END-9xxx only (never a real Linear key).
import { describe, expect, it } from "vitest";
import { w12Message } from "../src/guard/person-line";
import { mockLinear, mockNotion, mockQueue, mockSlack, permalinkFor, runTool, testConfig } from "./helpers";

const cfg = testConfig();
const Q = cfg.slack.channels.questions;
const I = cfg.slack.channels.ideas;
const L = cfg.slack.channels.lighthouse;
const PROJECT = cfg.linear.project_id;

const posts = (slack: ReturnType<typeof mockSlack>) => slack.calls.filter((c) => c.method === "chat.postMessage").map((c) => c.args);

describe("W-20 through T5's Current-only reads", () => {
  const id = (n: number) => `3ea8f1ec11b4816d8adae5fa98d1${String(n).padStart(4, "0")}`;
  const dashed = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  const page = (n: number, title: string, status: string) => ({
    id: dashed(id(n)),
    url: `https://www.notion.so/${id(n)}`,
    properties: { Name: { type: "title", title: [{ plain_text: title }] }, Status: { type: "status", status: { name: status } } },
  });
  function docsMixed() {
    const notion = mockNotion();
    const pages = [page(1, "Fee model", "Current"), page(2, "Fee draft", "Draft"), page(3, "Old fees", "Retired")];
    notion.fixtures.query = pages;
    for (const p of pages) {
      notion.fixtures.pages[p.id] = p;
      notion.fixtures.markdown[p.id] = `# ${p.properties.Name.title[0].plain_text}\nThe fee is rounded down.`;
    }
    return notion;
  }

  it("T-QI-5: the search for fee returns only Fee model; Draft and Retired reads are refused with W-20 and read no body; Lighthouse sees all three", async () => {
    const notion = docsMixed();
    const found = await runTool("question-idea", "notion_search", { text: "fee" }, { mocks: { notion } });
    expect(found.pages.map((p: any) => p.title)).toEqual(["Fee model"]);

    const draft = await runTool("question-idea", "notion_read", { page: id(2) }, { mocks: { notion } });
    expect(draft).toEqual({ refused: true, wall: "W-20", message: "Refused by the harness (W-20, OPS-F4-09): Fee draft is Draft; answers come from Current pages only." });
    const old = await runTool("question-idea", "notion_read", { page: id(3) }, { mocks: { notion } });
    expect(old.message).toBe("Refused by the harness (W-20, OPS-F4-09): Old fees is Retired; answers come from Current pages only.");
    expect(notion.calls.filter((c) => c.method === "pages.retrieveMarkdown")).toEqual([]);

    const current = await runTool("question-idea", "notion_read", { page: id(1) }, { mocks: { notion } });
    expect(current.title).toBe("Fee model");

    const lh = docsMixed();
    const all = await runTool("lighthouse", "notion_search", { text: "fee" }, { mocks: { notion: lh } });
    expect(all.pages.map((p: any) => p.title)).toEqual(["Fee model", "Fee draft", "Old fees"]);
    for (const n of [2, 3]) expect((await runTool("lighthouse", "notion_read", { page: id(n) }, { mocks: { notion: lh } })).refused).toBeUndefined();
  });
});

describe("file_question and close_question (SYS §5.5, §6.3)", () => {
  const root = "1790000100.000100";
  const thread = permalinkFor(Q, root);

  it("T-QI-6: one issueCreate as SYS §6.3's open question; again: existing, no create", async () => {
    const created: any[] = [];
    const linear = mockLinear()
      .on("OpenQuestionByThread", () => ({ issues: { nodes: created } }))
      .on("CreateOpenQuestion", (v: any) => {
        created.push({ identifier: "END-9001", url: "https://linear.app/endix/issue/END-9001", description: v.input.description, state: { name: "In Review" }, project: { id: v.input.projectId } });
        return { issueCreate: { success: true, issue: { identifier: "END-9001", url: "https://linear.app/endix/issue/END-9001" } } };
      });
    const slack = mockSlack();
    const first = await runTool("question-idea", "file_question", { thread, question: "do issuers pay the trade fee too?" }, { mocks: { linear, slack } });
    expect(first).toEqual({ key: "END-9001", url: "https://linear.app/endix/issue/END-9001", existing: false });
    const creates = linear.calls.filter((c) => c.op === "CreateOpenQuestion");
    expect(creates).toHaveLength(1);
    expect(creates[0].variables.input).toEqual({
      teamId: cfg.linear.team_id,
      projectId: PROJECT,
      title: "Open question: do issuers pay the trade fee too?",
      description: `Thread: ${thread}`,
      labelIds: [cfg.linear.labels.Question],
      stateId: cfg.linear.states["In Review"],
    });

    const again = await runTool("question-idea", "file_question", { thread, question: "do issuers pay the trade fee too?" }, { mocks: { linear, slack } });
    expect(again).toEqual({ key: "END-9001", url: "https://linear.app/endix/issue/END-9001", existing: true });
    expect(linear.calls.filter((c) => c.op === "CreateOpenQuestion")).toHaveLength(1);
  });

  function questionMocks(answerUser: string) {
    const slack = mockSlack();
    const answerTs = "1790000200.000100";
    slack.fixtures.replies[root] = [
      { ts: root, user: "U_LH", text: "Moved from … · asked by Henry\n> do issuers pay the trade fee too?" },
      { ts: answerTs, user: answerUser, text: "Answer: issuers pay no trade fee.", thread_ts: root },
    ];
    const linear = mockLinear()
      .on("FenceProject", { issue: { project: { id: PROJECT } } })
      .on("Issue", { issue: { id: "uuid-9002", identifier: "END-9002", labels: { nodes: [{ name: "Question" }] }, description: `Thread: ${thread}`, project: { id: PROJECT } } })
      .on("CloseQuestionComment", { commentCreate: { success: true } })
      .on("CloseQuestionDone", { issueUpdate: { success: true } });
    return { slack, linear, answer: permalinkFor(Q, answerTs, root) };
  }
  const docs = "https://www.notion.so/3ea8f1ec11b48149babfd4814aec71fd";

  it("T-QI-7: Henry's Answer line: one comment quoting it with Docs:, then Done; the agent's own Answer line: W-12, no write", async () => {
    const m = questionMocks("U_HENRY");
    const r = await runTool("question-idea", "close_question", { issue: "END-9002", answer_permalink: m.answer, docs_link: docs }, { mocks: { slack: m.slack, linear: m.linear } });
    const body = `Answer · Henry: "Answer: issuers pay no trade fee." · ${m.answer}\nDocs: ${docs}`;
    expect(r).toEqual({ key: "END-9002", state: "Done", comment: body });
    const writes = m.linear.calls.filter((c) => /^\s*mutation/.test(c.query));
    expect(writes.map((c) => c.op)).toEqual(["CloseQuestionComment", "CloseQuestionDone"]);
    expect(writes[0].variables).toEqual({ input: { issueId: "uuid-9002", body } });
    expect(writes[1].variables).toEqual({ id: "uuid-9002", input: { stateId: cfg.linear.states.Done } });

    const own = questionMocks("U_QI");
    const refusedR = await runTool("question-idea", "close_question", { issue: "END-9002", answer_permalink: own.answer, docs_link: docs }, { mocks: { slack: own.slack, linear: own.linear } });
    expect(refusedR).toEqual({ refused: true, wall: "W-12", message: w12Message("Answer:") });
    expect(own.linear.calls.filter((c) => /^\s*mutation/.test(c.query))).toEqual([]);
  });
});

describe("close_thread (SYS §5.5, DICT §4)", () => {
  const root = "1790000300.000100";
  const idea = permalinkFor(I, root);
  function ideaThread() {
    const slack = mockSlack();
    slack.fixtures.replies[root] = [
      { ts: root, user: "U_LH", text: "Moved from … · asked by Henry\n> maybe a fee holiday in launch week?" },
      { ts: "1790000301.000100", user: "U_LH", text: "Later: END-520 · revisit 2026-11-01", thread_ts: root },
      { ts: "1790000302.000100", user: "U_HENRY", text: "Later: after launch, once we have a month of volume; revisit on November 1, 2026.", thread_ts: root },
      { ts: "1790000303.000100", user: "U_HENRY", text: "No: 25 bps is already our launch price, so no holiday.", thread_ts: root },
    ];
    return slack;
  }
  const bots = permalinkFor(I, "1790000301.000100", root);
  const later = permalinkFor(I, "1790000302.000100", root);
  const no = permalinkFor(I, "1790000303.000100", root);
  const laterRefusal = { refused: true, wall: "W-12", message: w12Message("Later:") };

  it("T-QI-8: Later needs a person's Later: line; the closing line passes only through close_thread; Dropped and Led to", async () => {
    const slack = ideaThread();
    const input = { thread: idea, kind: "Later", body: "END-520 · revisit 2026-11-01" };
    expect(await runTool("question-idea", "close_thread", input, { mocks: { slack } })).toEqual(laterRefusal);
    expect(await runTool("question-idea", "close_thread", { ...input, person_line_permalink: bots }, { mocks: { slack } })).toEqual(laterRefusal);
    expect(posts(slack)).toEqual([]);

    const ok = await runTool("question-idea", "close_thread", { ...input, person_line_permalink: later }, { mocks: { slack } });
    const line = `Later: END-520 · revisit 2026-11-01 · Henry: ${later}`;
    expect(ok.line).toBe(line);
    expect(posts(slack)).toEqual([{ channel: I, thread_ts: root, text: line, unfurl_links: false }]);

    const viaReply = await runTool("question-idea", "post_reply", { thread: idea, text: line }, { mocks: { slack } });
    expect(viaReply).toMatchObject(laterRefusal);
    expect(posts(slack)).toHaveLength(1);

    const dropped = await runTool("question-idea", "close_thread", { thread: idea, kind: "Dropped", body: "25 bps is already the launch price", person_line_permalink: no }, { mocks: { slack } });
    expect(dropped.line).toBe(`Dropped: 25 bps is already the launch price · Henry: ${no}`);
    const droppedWrong = await runTool("question-idea", "close_thread", { thread: idea, kind: "Dropped", body: "no", person_line_permalink: later }, { mocks: { slack } });
    expect(droppedWrong).toEqual({ refused: true, wall: "W-12", message: w12Message("No:") });

    const ledTo = await runTool("question-idea", "close_thread", { thread: idea, kind: "Led to", body: "END-1, END-2" }, { mocks: { slack } });
    expect(ledTo.line).toBe("Led to: END-1, END-2");
    expect(posts(slack).map((p) => p.text)).toEqual([line, `Dropped: 25 bps is already the launch price · Henry: ${no}`, "Led to: END-1, END-2"]);
  });

  it("close_thread Answered closes a question thread with the page link (S1-12); a question kind in an idea thread is an error", async () => {
    const slack = mockSlack();
    const qRoot = "1790000400.000100";
    const r = await runTool("question-idea", "close_thread", { thread: permalinkFor(Q, qRoot), kind: "Answered", body: "https://www.notion.so/3ea8f1ec11b4816d8adae5fa98d19815" }, { mocks: { slack } });
    expect(r.line).toBe("Answered: https://www.notion.so/3ea8f1ec11b4816d8adae5fa98d19815");
    expect(posts(slack)).toEqual([{ channel: Q, thread_ts: qRoot, text: r.line, unfurl_links: false }]);
    const wrong = await runTool("question-idea", "close_thread", { thread: idea, kind: "Answered", body: "x" }, { mocks: { slack } });
    expect(wrong.error).toMatch(/^Answered, Led to and Parked close a #demo-questions thread/);
  });
});

describe("move_to, hand_to_lighthouse, post_reply", () => {
  const source = permalinkFor(L, "1790000500.000100");

  it("move_to ideas posts the Move text and queues E12 to itself; dry run: no post, no event", async () => {
    const slack = mockSlack();
    const queue = mockQueue();
    const r = await runTool("question-idea", "move_to", { channel: "ideas", text: "maybe a fee holiday in launch week?", source_permalink: source, asker: "Henry" }, { mocks: { slack, queue } });
    const text = `Moved from ${source} · asked by Henry\n> maybe a fee holiday in launch week?`;
    expect(posts(slack)).toEqual([{ channel: I, text, unfurl_links: false }]);
    expect(r).toEqual({ permalink: permalinkFor(I, r.ts), ts: r.ts });
    expect(queue.events).toEqual([{ id: "E12", channel: I, ts: r.ts, thread_ts: null, permalink: r.permalink, author: { name: "Question/idea agent", kind: "bot" }, text }]);

    const drySlack = mockSlack();
    const dryQueue = mockQueue();
    const dry = await runTool("question-idea", "move_to", { channel: "ideas", text: "x", source_permalink: source, asker: "Henry" }, { mocks: { slack: drySlack, queue: dryQueue }, dryRun: true });
    expect(dry).toMatchObject({ dry_run: true, permalink: "https://dry-run.invalid/ideas/1" });
    expect(posts(drySlack)).toEqual([]);
    expect(dryQueue.events).toEqual([]);
  });

  it("hand_to_lighthouse posts DICT §2's ask top-level in #demo-lighthouse", async () => {
    const slack = mockSlack();
    const from = permalinkFor(Q, "1790000600.000100");
    await runTool("question-idea", "hand_to_lighthouse", { text: "change the fee to 25 bps", source_permalink: from, asker: "Henry" }, { mocks: { slack } });
    expect(posts(slack)).toEqual([{ channel: L, text: `Ask from Henry via the question/idea agent: change the fee to 25 bps · ${from}`, unfurl_links: false }]);
  });

  it("post_reply in #demo-lighthouse: only mentions and Refused: lines; elsewhere an error", async () => {
    const slack = mockSlack();
    const task = permalinkFor(L, "1790000700.000100");
    expect(await runTool("question-idea", "post_reply", { thread: task, text: "Due soon" }, { mocks: { slack } })).toEqual({
      error: "In #demo-lighthouse the question/idea agent posts only mentions and refusal lines.",
    });
    const reopen = permalinkFor(I, "1790000300.000100");
    const r = await runTool("question-idea", "post_reply", { thread: task, text: `<@Task manager> OPS-F7-11 · close END-520 with Reopened: ${reopen}` }, { mocks: { slack } });
    expect(r.ts).toBeTruthy();
    expect(posts(slack)).toEqual([{ channel: L, thread_ts: "1790000700.000100", text: `<@U_TM> OPS-F7-11 · close END-520 with Reopened: ${reopen}`, unfurl_links: false }]);
    expect(await runTool("question-idea", "post_reply", { thread: permalinkFor(cfg.slack.channels.no_bots, "1790000800.000100"), text: "hi" }, { mocks: { slack } })).toEqual({
      error: "The question/idea agent posts only in #demo-questions, #demo-ideas and #demo-lighthouse.",
    });
  });

  it("the tools are SYS §5.5's six, in order", async () => {
    const { questionIdeaWriteTools } = await import("../src/tools/question-idea/index");
    expect(questionIdeaWriteTools.map((t) => t.name)).toEqual(["post_reply", "move_to", "hand_to_lighthouse", "close_thread", "file_question", "close_question"]);
  });
});
