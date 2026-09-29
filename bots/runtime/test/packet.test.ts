import { describe, expect, it } from "vitest";
import { BOTS } from "../src/bots/registry";
import { buildPacket, ContextPacketSchema, packetPrompt } from "../src/packet/build";
import type { EventMatch } from "../src/events/classify";
import { mockLinear, mockNotion, mockSlack, runTool, testConfig } from "./helpers";

const config = testConfig();
const LH = config.slack.channels.lighthouse;

function slackWithThread() {
  const slack = mockSlack();
  slack.fixtures.replies["1790000000.000100"] = [
    { ts: "1790000000.000100", user: "U_HENRY", text: "Update the fee page" },
    { ts: "1790000000.000200", user: "U_LH", text: "END-512 · F1.2 · Update the fee page. Lightmap below." },
    { ts: "1790000000.000300", user: "U_HENRY", text: "Also END-999?" },
  ];
  return slack;
}

function linearWithIssue() {
  return mockLinear().on("Issue", (v: Record<string, unknown>) =>
    v.key === "END-512"
      ? {
          issue: {
            identifier: "END-512",
            title: "F1.2 · Update the fee page",
            state: { name: "Todo" },
            labels: { nodes: [{ name: "Lightmap" }] },
            description: "## Lightmap",
            url: "https://linear.app/endix/issue/END-512",
            dueDate: null,
            assignee: { name: "Henry" },
            children: { nodes: [{ identifier: "END-513", title: "F1-10 · Draft", state: { name: "Todo" } }] },
          },
        }
      : { issue: null },
  );
}

describe("context packet (SYS §4.4)", () => {
  it("T-R-10: validates; has event, thread, umbrellas with children, people, steps; the prompt's first line is exact", async () => {
    const match: EventMatch = { bot: "lighthouse", id: "E4", channel: LH, role: "lighthouse", ts: "1790000000.000300", thread_ts: "1790000000.000100", text: "Also END-999?", author: { name: "Henry", kind: "person" }, source: "slack" };
    const packet = await buildPacket(match, { def: BOTS.lighthouse, config, slack: mockSlack() && (slackWithThread() as any), linear: linearWithIssue() });
    expect(ContextPacketSchema.safeParse(packet).success).toBe(true);
    expect(packet.bot).toBe("lighthouse");
    expect(packet.now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
    expect(packet.event).toMatchObject({ id: "E4", channel: "demo-lighthouse", ts: "1790000000.000300", thread_ts: "1790000000.000100", author: { name: "Henry", kind: "person" } });
    expect(packet.event.permalink).toBe("https://endix.slack.com/archives/C0C61PKP10Q/p1790000000000300");
    expect(packet.thread.map((m) => m.author.name)).toEqual(["Henry", "Lighthouse", "Henry"]);
    expect(packet.umbrellas).toEqual([
      { key: "END-999", error: "not found" },
      { key: "END-512", title: "F1.2 · Update the fee page", state: "Todo", labels: ["Lightmap"], description: "## Lightmap", url: "https://linear.app/endix/issue/END-512", due_date: null, assignee: "Henry", children: [{ key: "END-513", title: "F1-10 · Draft", state: "Todo" }] },
    ]);
    expect(packet.people).toEqual({ Henry: { slack: "U_HENRY" } });
    expect((packet.steps as { variants: Record<string, unknown> }).variants["F1.2"]).toBeTruthy();
    const prompt = packetPrompt(packet);
    expect(prompt.split("\n")[0]).toBe("Event for lighthouse. Act only through your tools.");
    expect(prompt.split("\n")[1]).toBe("");
    expect(prompt.split("\n")[2]).toBe("```json");
    expect(prompt.endsWith("\n```")).toBe(true);
  });

  it("shared reads run against the mocks with the Req 15 shapes; an unknown input key is an input error", async () => {
    const slack = slackWithThread();
    expect(await runTool("lighthouse", "read_thread", { channel: LH, ts: "1790000000.000100" }, { mocks: { slack } })).toMatchObject({ messages: [{ author: { name: "Henry", kind: "person" } }, {}, {}] });
    expect(await runTool("lighthouse", "linear_get", { key: "END-512" }, { mocks: { linear: linearWithIssue() } })).toMatchObject({ identifier: "END-512" });
    const lf = mockLinear().on("FindIssues", { issues: { nodes: [{ identifier: "END-540" }] } });
    expect(await runTool("lighthouse", "linear_find", { label: "Later" }, { mocks: { linear: lf } })).toEqual({ issues: [{ identifier: "END-540" }] });
    expect(lf.calls[0].variables).toMatchObject({ filter: { project: { id: { eq: config.linear.project_id } } } });
    expect(await runTool("lighthouse", "steps", { variant: "F9.9" })).toEqual({ found: false, variant: "F9.9" });
    expect(await runTool("lighthouse", "steps", { variant: "F1.2", extra: 1 })).toMatchObject({ error: expect.stringMatching(/^input: /) });
    const notion = mockNotion();
    notion.fixtures.query = [
      { id: "p1", url: "https://www.notion.so/p1", properties: { Name: { type: "title", title: [{ plain_text: "Fee model" }] }, Status: { type: "status", status: { name: "Current" } }, Type: { type: "select", select: { name: "Doc" } }, Owner: { type: "people", people: [{ name: "Henry" }] } } },
      { id: "p2", url: "https://www.notion.so/p2", properties: { Name: { type: "title", title: [{ plain_text: "Launch plan" }] }, Status: { type: "status", status: { name: "Draft" } } } },
    ];
    expect(await runTool("lighthouse", "notion_search", { text: "fee" }, { mocks: { notion } })).toEqual({ pages: [{ id: "p1", title: "Fee model", status: "Current", type: "Doc", owner: ["Henry"], url: "https://www.notion.so/p1" }] });
    const pid = "3ea8f1ec-11b4-816d-8ada-e5fa98d19815";
    notion.fixtures.pages[pid] = { id: pid, url: "https://www.notion.so/x", properties: { Name: { type: "title", title: [{ plain_text: "Launch plan" }] }, Status: { type: "status", status: { name: "Draft" } } } };
    notion.fixtures.markdown[pid] = "# Launch";
    expect(await runTool("lighthouse", "notion_read", { page: "3ea8f1ec11b4816d8adae5fa98d19815" }, { mocks: { notion } })).toMatchObject({ title: "Launch plan", markdown: "# Launch" });
    expect(await runTool("question-idea", "notion_read", { page: pid }, { mocks: { notion } })).toEqual({
      refused: true,
      wall: "W-20",
      message: "Refused by the harness (W-20, OPS-F4-09): Launch plan is Draft; answers come from Current pages only.",
    });
    expect(await runTool("question-idea", "github_read", { path: "src/FeeModel.sol" })).toEqual({ error: "GITHUB_READ_TOKEN is not set yet (PPL §2.6)." });
  });
});
