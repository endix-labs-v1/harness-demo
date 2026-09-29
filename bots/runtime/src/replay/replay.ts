import { z } from "zod";
import { botDef } from "../bots/registry";
import { loadConfig, type DemoConfig } from "../core/config";
import type { BotLogger } from "../core/log";
import type { Secrets } from "../core/secrets";
import { runBot, newRunId } from "../agent/run";
import { NOT_RUN } from "../events/dispatch";
import { readSteps, type ContextPacket } from "../packet/build";
import { makeContext, type ContextOptions } from "../tools/context";
import type { SelfEvent } from "../tools/define";

export const ReplayFixtureSchema = z.object({
  bot: z.string(),
  packet: z.looseObject({}),
  reads: z
    .object({
      read_thread: z.record(z.string(), z.object({ messages: z.array(z.any()) })).optional(),
      notion_read: z.record(z.string(), z.any()).optional(),
      linear_get: z.record(z.string(), z.any()).optional(),
      list_idea_threads: z.object({ threads: z.array(z.any()) }).optional(),
    })
    .optional(),
  expected: z
    .array(z.object({ tool: z.string(), status: z.enum(["allowed", "refused"]), input: z.record(z.string(), z.unknown()).optional() }))
    .optional(),
});
export type ReplayFixture = z.infer<typeof ReplayFixtureSchema>;
export type FixtureReads = NonNullable<ReplayFixture["reads"]>;

export interface ReplayOptions {
  dryRun: true;
  /** Defaults to demo.config.json (DEMO_CONFIG), as T6's and T9's eval runners call it. */
  config?: DemoConfig;
  secrets?: Secrets;
  log?: BotLogger;
  overrides?: ContextOptions["overrides"];
}

/** A stored packet fed to one bot with its tools in dry run (SYS §4.8, Req 24). */
export async function replayPacket(bot: string, fixture: ReplayFixture, opts: ReplayOptions) {
  const def = botDef(bot);
  const packet = { ...(fixture.packet as ContextPacket) };
  if (packet.steps === undefined) packet.steps = readSteps();
  const selfEvents: SelfEvent[] = [];
  const runId = newRunId(def.name);
  const ctx = makeContext(def, packet, {
    dryRun: true,
    runId,
    secrets: opts.secrets ?? {},
    config: opts.config ?? loadConfig(),
    reads: fixture.reads,
    log: opts.log,
    overrides: opts.overrides,
    enqueueSelf: async (e) => {
      selfEvents.push(e);
      return { ...NOT_RUN };
    },
  });
  const summary = await runBot(def, packet, ctx);
  return { toolCalls: summary.toolResults, selfEvents, runId };
}

export function statusOf(result: unknown): "allowed" | "refused" {
  return result && typeof result === "object" && (result as { refused?: boolean }).refused === true ? "refused" : "allowed";
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** `match`, or `mismatch at <n>: …` (Req 24). */
export function compareExpected(toolCalls: { name: string; input: unknown; result: unknown }[], expected: NonNullable<ReplayFixture["expected"]>): string {
  const n = Math.max(toolCalls.length, expected.length);
  for (let i = 0; i < n; i++) {
    const got = toolCalls[i];
    const want = expected[i];
    const gotS = got ? `${got.name} ${statusOf(got.result)}` : "nothing";
    const wantS = want ? `${want.tool} ${want.status}` : "nothing";
    let ok = !!got && !!want && got.name === want.tool && statusOf(got.result) === want.status;
    if (ok && want!.input) {
      const input = (got!.input ?? {}) as Record<string, unknown>;
      ok = Object.entries(want!.input).every(([k, v]) => deepEqual(input[k], v));
    }
    if (!ok) return `mismatch at ${i + 1}: expected ${wantS}, got ${gotS}`;
  }
  return "match";
}
