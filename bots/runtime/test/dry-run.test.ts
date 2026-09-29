import { describe, expect, it } from "vitest";
import { z } from "zod";
import { callTool, defineTool, wouldDo } from "../src/tools/define";
import { mockLinear, mockNotion, mockSlack, testContext } from "./helpers";

describe("dry run (SYS §4.8)", () => {
  it("T-R-11: a tool returning wouldDo sends nothing; one that forgets is blocked at each client; reads still go", async () => {
    const slack = mockSlack();
    const linear = mockLinear().on("Issue", { issue: { identifier: "END-1" } });
    const notion = mockNotion();
    const ctx = testContext("lighthouse", { dryRun: true, mocks: { slack, linear, notion } });

    const polite = defineTool({
      name: "test_post",
      description: "",
      input: { text: z.string() },
      async handler(input, c) {
        await c.slack.conversations.replies({ channel: "C0C61PKP10Q", ts: "1790000000.000100" });
        if (c.dryRun) return wouldDo(`post: ${input.text}`);
        return { posted: true };
      },
    });
    expect((await callTool(polite, { text: "hi" }, ctx)).value).toEqual({ dry_run: true, would: "post: hi" });

    const careless = (what: "slack" | "linear" | "notion") =>
      defineTool({
        name: `test_${what}`,
        description: "",
        input: {},
        async handler(_i, c) {
          if (what === "slack") await c.slack.chat.postMessage({ channel: "C0C61PKP10Q", text: "hello" });
          if (what === "linear") {
            await c.linear(`query Issue($key: String!) { issue(id: $key) { id } }`, { key: "END-1" });
            await c.linear(`mutation Close { issueUpdate(id: "x", input: {}) { success } }`);
          }
          if (what === "notion") await (c.notion as any).pages.update({ page_id: "p" });
          return { ok: true };
        },
      });
    expect((await callTool(careless("slack"), {}, ctx)).value).toEqual({ error: "dry run: chat.postMessage blocked" });
    expect((await callTool(careless("linear"), {}, ctx)).value).toEqual({ error: "dry run: linear mutation blocked" });
    expect((await callTool(careless("notion"), {}, ctx)).value).toEqual({ error: "dry run: pages.update blocked" });

    expect(slack.calls.map((c) => c.method)).toEqual(["conversations.replies"]);
    expect(linear.calls.map((c) => c.op)).toEqual(["Issue"]);
    expect(notion.calls).toEqual([]);
  });
});
