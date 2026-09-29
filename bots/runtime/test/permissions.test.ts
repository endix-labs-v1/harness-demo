import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/agent/sdk", async () => (await import("./helpers/fake-sdk")).fakeSdk.module());

import { BOTS } from "../src/bots/registry";
import { DISALLOWED_TOOLS, runBot } from "../src/agent/run";
import { makeCanUseTool, w10 } from "../src/agent/permissions";
import { createBotLogger } from "../src/core/log";
import { fakeSdk, testContext, testPacket } from "./helpers";

function lines(bot: string) {
  const log = createBotLogger(bot);
  try {
    return readFileSync(log.file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

describe("deny by default (W-10)", () => {
  it("T-R-5: Bash is denied with the W-10 text and one refused line; the options hold tools: [] and DISALLOWED_TOOLS", async () => {
    const before = lines("lighthouse").length;
    fakeSdk.play([{ name: "Bash", input: { command: "ls" } }]);
    const ctx = testContext("lighthouse");
    const summary = await runBot(BOTS.lighthouse, testPacket("lighthouse"), ctx);
    const after = lines("lighthouse").slice(before);
    const refusedLines = after.filter((l) => l.kind === "refused");
    expect(refusedLines).toHaveLength(1);
    expect(refusedLines[0].message).toBe("Refused by the harness (W-10, OPS-A4-10): Lighthouse has no tool Bash. Use only your tools.");
    expect(refusedLines[0].tool).toBe("Bash");
    expect(after.map((l) => l.kind)).toEqual(["run_start", "tool_call", "refused", "run_end"]);
    expect(summary.toolResults).toEqual([{ name: "Bash", input: { command: "ls" }, result: { refused: true, wall: "W-10", message: w10(BOTS.lighthouse, "Bash") } }]);

    const direct = await makeCanUseTool(BOTS.lighthouse, new Set(["mcp__endix__steps"]), createBotLogger("lighthouse"))("Bash", {}, { signal: new AbortController().signal, toolUseID: "t", requestId: "r" } as never);
    expect(direct).toEqual({ behavior: "deny", message: w10(BOTS.lighthouse, "Bash") });

    const o = fakeSdk.state.lastOptions;
    expect(o.tools).toEqual([]);
    expect(o.disallowedTools).toEqual(DISALLOWED_TOOLS);
    expect(DISALLOWED_TOOLS).toEqual(["Bash", "BashOutput", "KillShell", "Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "WebFetch", "WebSearch", "Task", "NotebookEdit", "TodoWrite"]);
    expect(o.settingSources).toEqual([]);
    expect(o.model).toBe("sonnet");
    expect(o.maxTurns).toBe(12);
    expect(o.permissionMode).toBe("default");
    expect(o.allowedTools).toEqual(["read_thread", "linear_get", "linear_find", "notion_search", "notion_read", "steps"].map((n) => `mcp__endix__${n}`));
    expect(o.systemPrompt).toContain("# Shared rules (every bot)");
  });

  it("T-R-6: Lighthouse calling mcp__endix__close is denied with W-10; its own steps tool runs", async () => {
    const before = lines("lighthouse").length;
    fakeSdk.play([
      { name: "mcp__endix__close", input: { key: "END-1" } },
      { name: "mcp__endix__steps", input: { variant: "F1.2" } },
    ]);
    const summary = await runBot(BOTS.lighthouse, testPacket("lighthouse"), testContext("lighthouse"));
    const after = lines("lighthouse").slice(before);
    const refusedLines = after.filter((l) => l.kind === "refused");
    expect(refusedLines).toHaveLength(1);
    expect(refusedLines[0].message).toBe("Refused by the harness (W-10, OPS-A4-10): Lighthouse has no tool mcp__endix__close. Use only your tools.");
    expect(summary.toolResults[0]).toMatchObject({ name: "close", result: { refused: true, wall: "W-10" } });
    expect(summary.toolResults[1]).toMatchObject({ name: "steps", input: { variant: "F1.2" } });
    expect((summary.toolResults[1].result as { name: string }).name).toBe("Change a page");
    expect(after.filter((l) => l.kind === "tool_result").map((l) => l.tool)).toEqual(["mcp__endix__steps"]);
  });
});
