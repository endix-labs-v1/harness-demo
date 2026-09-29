import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { BotDef } from "../bots/types";
import { botsDir, ensureDirFor, logsDir, runsDir } from "../core/paths";
import { redact } from "../core/redact";
import { compactSeoul } from "../core/time";
import type { RunSummary } from "../events/dispatch";
import type { ContextPacket } from "../packet/build";
import { packetPrompt } from "../packet/build";
import { recordsOf, SDK_PREFIX, toSdkTool, type ToolContext, type ToolDef } from "../tools/define";
import { SHARED_READS } from "../tools/shared";
import { makeAuditHook } from "./audit";
import { makeCanUseTool } from "./permissions";
import { createSdkMcpServer, query } from "./sdk";

/** The built-in tools, listed again in case an option name differs (SYS §4.5). */
export const DISALLOWED_TOOLS = ["Bash", "BashOutput", "KillShell", "Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "WebFetch", "WebSearch", "Task", "NotebookEdit", "TodoWrite"];

/** The bot's reads from SHARED_READS, then its writes (Req 12). */
export function toolsFor(def: BotDef): ToolDef<any>[] {
  return [...def.reads.map((n) => SHARED_READS[n]), ...def.writes];
}

export function newRunId(bot: string, now: Date = new Date()): string {
  return `${bot}-${compactSeoul(now)}-${randomBytes(2).toString("hex")}`;
}

export function runDirFor(runId: string): string {
  return join(runsDir(), runId);
}

/** SYS §4.5's options, exactly; prompt files are read at each run. */
export function buildOptions(def: BotDef, ctx: ToolContext): Options {
  const tools = toolsFor(def);
  const allowedTools = tools.map((t) => `${SDK_PREFIX}${t.name}`);
  const allowed = new Set(allowedTools);
  const auditHook = makeAuditHook(def, allowed, ctx.log);
  return {
    systemPrompt: readFileSync(join(botsDir(), def.promptFile), "utf8") + "\n\n" + readFileSync(join(botsDir(), "data", "shared-rules.md"), "utf8"),
    tools: [],
    model: ctx.config.model.bots,
    mcpServers: { endix: createSdkMcpServer({ name: "endix", version: "1.0.0", tools: tools.map((t) => toSdkTool(t, ctx)) }) },
    allowedTools,
    disallowedTools: DISALLOWED_TOOLS,
    canUseTool: makeCanUseTool(def, allowed, ctx.log),
    hooks: { PreToolUse: [{ hooks: [auditHook] }], PostToolUse: [{ hooks: [auditHook] }] },
    settingSources: [],
    cwd: runDirFor(ctx.runId),
    maxTurns: 12,
    permissionMode: "default",
  };
}

/** Stores `{bot, packet}`, redacted: the replay fixture format (Req 11, 24). */
export function storePacket(bot: string, runId: string, packet: ContextPacket, redactionValues: string[]): string {
  const file = join(logsDir(), "packets", bot, `${runId}.json`);
  ensureDirFor(file);
  writeFileSync(file, `${JSON.stringify(redact({ bot, packet }, redactionValues), null, 2)}\n`);
  return file;
}

/**
 * One run (SYS §4.3 step 5): iterates the messages to the end and never posts the
 * model's text anywhere; only tool calls write.
 */
export async function runBot(def: BotDef, packet: ContextPacket, ctx: ToolContext): Promise<RunSummary> {
  const dir = runDirFor(ctx.runId);
  mkdirSync(dir, { recursive: true });
  // A W-10 denial never reaches the tool path: record it in the run's results too.
  const log = ctx.log;
  ctx.log = {
    ...log,
    write(e) {
      const line = log.write(e);
      const r = e.result as { wall?: string } | null | undefined;
      if (e.kind === "refused" && r?.wall === "W-10") {
        recordsOf(ctx).push({ name: String(e.tool ?? "").replace(SDK_PREFIX, ""), input: e.input ?? null, result: e.result });
      }
      return line;
    },
  };
  ctx.log.write({ kind: "run_start", input: { event: packet.event } });
  let result: { subtype: string | null; num_turns: number | null; is_error: boolean | null } = { subtype: null, num_turns: null, is_error: null };
  try {
    const options = buildOptions(def, ctx);
    for await (const m of query({ prompt: packetPrompt(packet), options })) {
      const msg = m as { type?: string; subtype?: string; num_turns?: number; is_error?: boolean };
      if (msg.type === "result") result = { subtype: msg.subtype ?? null, num_turns: msg.num_turns ?? null, is_error: msg.is_error ?? null };
    }
  } finally {
    ctx.log.write({ kind: "run_end", result });
    rmSync(dir, { recursive: true, force: true });
  }
  return { runId: ctx.runId, toolResults: recordsOf(ctx).map((r) => ({ ...r })) };
}
