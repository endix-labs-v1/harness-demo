import { z } from "zod";
import type { WebClient } from "@slack/web-api";
import type { Client } from "@notionhq/client";
import type { BotDef, BotName } from "../bots/types";
import type { DemoConfig } from "../core/config";
import type { BotLogger } from "../core/log";
import { printRefusal } from "../core/log";
import { redact } from "../core/redact";
import type { ContextPacket, PacketEvent } from "../packet/build";
import type { RunSummary } from "../events/dispatch";
import type { GithubReader } from "../clients/github";
import type { FixtureReads } from "../replay/replay";
import { tool } from "../agent/sdk";

export type WallId = "W-10" | "W-11" | "W-12" | "W-13" | "W-14" | "W-15" | "W-16" | "W-17" | "W-18" | "W-19" | "W-20";
export interface Refusal {
  refused: true;
  wall: WallId;
  message: string;
}
export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string; // as SYS §5, snake_case
  description: string;
  input: S; // zod raw shape
  handler(input: z.infer<z.ZodObject<S>>, ctx: ToolContext): Promise<unknown>;
}
export interface ToolContext {
  bot: BotName;
  def: BotDef;
  runId: string;
  dryRun: boolean;
  event: PacketEvent;
  packet: ContextPacket;
  config: DemoConfig;
  slack: WebClient; // this bot's client (Req 18)
  linear(query: string, variables?: Record<string, unknown>): Promise<any>; // this bot's token (Req 19)
  notion?: Client; // this bot's @notionhq/client (Req 20)
  github?: GithubReader; // Req 21
  now(): Date;
  today(): string; // YYYY-MM-DD in Asia/Seoul
  log: BotLogger;
  enqueueSelf(e: SelfEvent): Promise<RunSummary>; // E3 for Lighthouse, E12 for the Question/idea agent
  reads?: FixtureReads; // set only by replayPacket (Req 24)
}
export interface SelfEvent {
  id: "E3" | "E12";
  channel: string /* channel ID */;
  ts: string;
  thread_ts: null;
  permalink: string;
  author: { name: "Lighthouse" | "Question/idea agent"; kind: "bot" };
  text: string;
}

export class DryRunWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DryRunWriteError";
  }
}

/** Thrown by the guarded Slack client (Req 18); the tool path returns it as its refusal. */
export class GuardRefusal extends Error {
  refusal: Refusal & { start?: string };
  constructor(refusal: Refusal & { start?: string }) {
    super(refusal.message);
    this.name = "GuardRefusal";
    this.refusal = refusal;
  }
}

export function defineTool<S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

export function refused(wall: WallId, message: string): Refusal {
  return { refused: true, wall, message };
}

export function wouldDo(what: string, extra: Record<string, unknown> = {}): { dry_run: true; would: string } & Record<string, unknown> {
  return { dry_run: true, would: what, ...extra };
}

export function isRefusal(v: unknown): v is Refusal {
  return !!v && typeof v === "object" && (v as Refusal).refused === true && typeof (v as Refusal).wall === "string";
}

export interface ToolCallRecord {
  name: string;
  input: unknown;
  result: unknown;
}

/** Tool results of each context's run, for RunSummary (Req 10) and replay (Req 24). */
const RECORDS = new WeakMap<object, ToolCallRecord[]>();

export function recordsOf(ctx: ToolContext): ToolCallRecord[] {
  let r = RECORDS.get(ctx);
  if (!r) {
    r = [];
    RECORDS.set(ctx, r);
  }
  return r;
}

export const SDK_PREFIX = "mcp__endix__";

/** The tool path without the SDK (Req 14): validate strictly, run, map refusals and errors. */
export async function callTool(t: ToolDef<any>, input: unknown, ctx: ToolContext): Promise<{ value: unknown; isError: boolean }> {
  const sdkName = `${SDK_PREFIX}${t.name}`;
  const values = ctx.log.redactionValues;
  let out: { value: unknown; isError: boolean };
  const parsed = z.object(t.input).strict().safeParse(input ?? {});
  if (!parsed.success) {
    out = { value: { error: `input: ${parsed.error.message}` }, isError: true };
  } else {
    try {
      const value = await t.handler(parsed.data, ctx);
      if (isRefusal(value)) {
        ctx.log.write({ kind: "refused", tool: sdkName, input, result: value, message: value.message });
        printRefusal(value.wall, ctx.bot, sdkName, value.message, values);
        out = { value, isError: true };
      } else {
        out = { value, isError: false };
      }
    } catch (e) {
      if (e instanceof GuardRefusal) {
        const value = e.refusal;
        ctx.log.write({ kind: "refused", tool: sdkName, input, result: value, message: value.message });
        printRefusal(value.wall, ctx.bot, sdkName, value.message, values);
        out = { value, isError: true };
      } else {
        out = { value: { error: redact((e as Error).message ?? String(e), values) }, isError: true };
      }
    }
  }
  recordsOf(ctx).push({ name: t.name, input, result: out.value });
  return out;
}

/** Wraps one ToolDef with the SDK's `tool(name, description, input, handler)`. */
export function toSdkTool(t: ToolDef<any>, ctx: ToolContext) {
  return tool(t.name, t.description, t.input, async (args: unknown) => {
    const r = await callTool(t, args, ctx);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(r.value) }],
      ...(r.isError ? { isError: true } : {}),
    };
  });
}
