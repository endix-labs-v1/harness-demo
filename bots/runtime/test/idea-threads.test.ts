import { describe, expect, it } from "vitest";
import { mockSlack, runTool } from "./helpers";

const link = "https://endix.slack.com/archives/C0C55EFGY5C/p1790100000000100";

describe("list_idea_threads (SYS §5.1)", () => {
  it("three idea threads: a Go: line, a closed Later: line, and one reopened after its Later: line", async () => {
    const slack = mockSlack();
    slack.fixtures.history = [
      { ts: "1790100000.000100", user: "U_HENRY", text: "Fee holiday for new users?" },
      { ts: "1790200000.000100", user: "U_HENRY", text: "A fee calculator page?" },
      { ts: "1790300000.000100", user: "U_HENRY", text: "Dark mode for the docs?" },
      { ts: "1790300001.000100", user: "U_HENRY", text: "joined", subtype: "channel_join" },
    ];
    slack.fixtures.replies["1790100000.000100"] = [
      { ts: "1790100000.000100", user: "U_HENRY", text: "Fee holiday for new users?" },
      { ts: "1790100001.000100", user: "U_QI", text: "Context: …" },
      { ts: "1790100002.000100", user: "U_HENRY", text: "Go: ship it for October" },
    ];
    slack.fixtures.replies["1790200000.000100"] = [
      { ts: "1790200000.000100", user: "U_HENRY", text: "A fee calculator page?" },
      { ts: "1790200001.000100", user: "U_HENRY", text: "Later: after launch, November 5" },
      { ts: "1790200002.000100", user: "U_QI", text: `Later: END-4 · revisit 2026-11-05 · Henry: ${link}` },
    ];
    slack.fixtures.replies["1790300000.000100"] = [
      { ts: "1790300000.000100", user: "U_HENRY", text: "Dark mode for the docs?" },
      { ts: "1790300001.000200", user: "U_HENRY", text: "Later: after launch" },
      { ts: "1790300002.000100", user: "U_QI", text: `Later: END-5 · revisit 2026-11-05 · Henry: ${link}` },
      { ts: "1790300003.000100", user: "U_CK", text: "Go, later or no? <@U_HENRY>" },
      { ts: "1790300004.000100", user: "U_QI", text: "Reopened for END-5: the docs changed since." },
    ];
    const r = await runTool("question-idea", "list_idea_threads", {}, { mocks: { slack } });
    expect(r.threads.map((t: any) => t.ts)).toEqual(["1790300000.000100", "1790200000.000100", "1790100000.000100"]);
    const [reopened, closed, go] = r.threads;
    expect(go).toMatchObject({ date: "2026-09-23", text: "Fee holiday for new users?", author: { name: "Henry", kind: "person" }, closing_line: null, last_reopen_ts: null, last_quiet_ping_ts: null, last_activity_ts: "1790100002.000100" });
    expect(go.decision_line).toMatchObject({ ts: "1790100002.000100", text: "Go: ship it for October" });
    expect(go.permalink).toBe("https://endix.slack.com/archives/C0C55EFGY5C/p1790100000000100");
    expect(closed.decision_line).toMatchObject({ ts: "1790200001.000100" });
    expect(closed.closing_line).toMatchObject({ ts: "1790200002.000100", text: `Later: END-4 · revisit 2026-11-05 · Henry: ${link}` });
    expect(reopened.last_reopen_ts).toBe("1790300004.000100");
    expect(reopened.last_quiet_ping_ts).toBe("1790300003.000100");
    expect(reopened.decision_line).toBeNull();
    expect(reopened.closing_line).toBeNull();
    expect(reopened.last_activity_ts).toBe("1790300004.000100");
    expect(reopened.last_activity).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
