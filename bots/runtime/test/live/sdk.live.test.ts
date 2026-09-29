// L-1, L-2 (Req 31): the real Agent SDK on the plan login. Runs only with ENDIX_LIVE_SDK=1
// (vitest.config.ts excludes test/live otherwise). No Slack, Linear or Notion call: mocks only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BOTS } from "../../src/bots/registry";
import { runBot, buildOptions } from "../../src/agent/run";
import { makeCanUseTool, w10 } from "../../src/agent/permissions";
import { makeAuditHook } from "../../src/agent/audit";
import { createBotLogger } from "../../src/core/log";
import { query } from "../../src/agent/sdk";
import { packetPrompt } from "../../src/packet/build";
import { testContext, testPacket } from "../helpers";

describe.skipIf(process.env.ENDIX_LIVE_SDK !== "1")("live Agent SDK (plan login)", () => {
  it("L-1: init lists every mcp__endix__ tool of the bot; any other tool is denied by canUseTool and the audit hook", async () => {
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    const packet = testPacket("lighthouse", { event: { ...testPacket("lighthouse").event, text: "Call the steps tool for F1.2, then stop." } });
    const ctx = testContext("lighthouse", { dryRun: true, packet });
    const options = buildOptions(BOTS.lighthouse, ctx);
    let tools: string[] = [];
    for await (const m of query({ prompt: packetPrompt(packet), options: { ...options, maxTurns: 1 } })) {
      const msg = m as { type: string; subtype?: string; tools?: string[] };
      if (msg.type === "system" && msg.subtype === "init") tools = msg.tools ?? [];
    }
    const own = (options.allowedTools ?? []) as string[];
    for (const t of own) expect(tools).toContain(t);
    const others = tools.filter((t) => !own.includes(t));
    console.log(`L-1 other tools listed with tools: []: ${JSON.stringify(others)}`);
    const allowed = new Set(own);
    const log = createBotLogger("lighthouse");
    const can = makeCanUseTool(BOTS.lighthouse, allowed, log);
    const hook = makeAuditHook(BOTS.lighthouse, allowed, log);
    for (const t of others) {
      expect(await can(t, {}, { signal: new AbortController().signal, toolUseID: "t", requestId: "r" } as never)).toEqual({ behavior: "deny", message: w10(BOTS.lighthouse, t) });
      expect(await hook({ hook_event_name: "PreToolUse", tool_name: t, tool_input: {} } as never, undefined, { signal: new AbortController().signal, toolUseID: "t", requestId: "r" } as never)).toMatchObject({
        hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: w10(BOTS.lighthouse, t) },
      });
    }
  }, 180_000);

  it("L-2: the log holds run_start, a tool_call and tool_result for mcp__endix__steps, and run_end with subtype success", async () => {
    const packet = testPacket("lighthouse", { event: { ...testPacket("lighthouse").event, text: "Call the steps tool for F1.2, then stop." } });
    const ctx = testContext("lighthouse", { dryRun: true, packet });
    const start = readFileSync(ctx.log.file, { encoding: "utf8", flag: "a+" }).length;
    await runBot(BOTS.lighthouse, packet, ctx);
    const lines = readFileSync(ctx.log.file, "utf8").slice(start).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0].kind).toBe("run_start");
    expect(lines.some((l) => l.kind === "tool_call" && l.tool === "mcp__endix__steps")).toBe(true);
    expect(lines.some((l) => l.kind === "tool_result" && l.tool === "mcp__endix__steps")).toBe(true);
    const end = lines[lines.length - 1];
    expect(end.kind).toBe("run_end");
    expect(end.result.subtype).toBe("success");
  }, 300_000);
});
