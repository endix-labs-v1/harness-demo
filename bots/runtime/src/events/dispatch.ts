import type { BotDef } from "../bots/types";
import type { DemoConfig } from "../core/config";
import type { Deduper } from "../core/dedupe";
import type { BotLogger } from "../core/log";
import type { ThreadQueue } from "../core/queue";
import type { SelfEvent } from "../tools/define";
import { roleOf, type EventMatch } from "./classify";
import { BOTS } from "../bots/registry";
import type { Secrets as SecretsT } from "../core/secrets";
import type { LinearTokens } from "../clients/linear";
import { makeLinear } from "../clients/linear";
import { makeSlack } from "../clients/slack";
import { buildPacket } from "../packet/build";
import { makeContext } from "../tools/context";
import { newRunId, runBot, storePacket } from "../agent/run";

export interface RunSummary {
  runId: string;
  toolResults: { name: string; input: unknown; result: unknown }[];
}

export const NOT_RUN: RunSummary = { runId: "not-run", toolResults: [] };

export interface DispatcherDeps {
  deduper: Deduper;
  queue: ThreadQueue;
  loggerFor(bot: string): BotLogger;
  stopRequested(): boolean;
  /** Build the packet, run the bot, log run_end (SYS §4.3 steps 4 to 6). */
  run(match: EventMatch): Promise<RunSummary>;
}

/** From event to run (SYS §4.3, Req 10). */
export class Dispatcher {
  constructor(private deps: DispatcherDeps) {}

  enqueue(match: EventMatch): Promise<RunSummary> {
    if (match.channel && match.ts && !this.deps.deduper.first(match.bot, match.channel, match.ts)) {
      return Promise.resolve({ ...NOT_RUN }); // a duplicate: no log line
    }
    if (this.deps.stopRequested()) {
      this.deps.loggerFor(match.bot).write({ kind: "ignored", event_ts: match.ts, message: "STOP file present" });
      return Promise.resolve({ ...NOT_RUN });
    }
    const key = match.id === "E16" ? "checker|E16" : `${match.bot}|${match.channel}|${match.thread_ts ?? match.ts}`;
    return this.deps.queue.run(match.bot, key, () => this.deps.run(match));
  }

  stats(bot: string) {
    return this.deps.queue.stats(bot);
  }
}

/** The E16 match of `npm run checker -- --once` (manual) or the schedule (Req 25). */
export function e16Match(source: "manual" | "schedule"): EventMatch {
  return {
    bot: "checker",
    id: "E16",
    channel: null,
    role: null,
    ts: null,
    thread_ts: null,
    text: "Checker pass",
    author: source === "schedule" ? { name: "schedule", kind: "schedule" } : { name: "npm run checker", kind: "manual" },
    source,
  };
}

/** A self-queued event as a match (Req 14): E3 from Lighthouse, E12 from the Question/idea agent only. */
export function selfMatch(def: BotDef, config: DemoConfig, e: SelfEvent): EventMatch {
  const ch = config.slack.channels;
  const ok =
    (e.id === "E3" && def.name === "lighthouse" && !!ch.lighthouse && e.channel === ch.lighthouse) ||
    (e.id === "E12" && def.name === "question-idea" && ((!!ch.questions && e.channel === ch.questions) || (!!ch.ideas && e.channel === ch.ideas)));
  if (!ok) throw new Error(`enqueueSelf: ${e.id} in ${e.channel} is not an event of ${def.displayName}.`);
  return {
    bot: def.name,
    id: e.id,
    channel: e.channel,
    role: roleOf(config, e.channel),
    ts: e.ts,
    thread_ts: null,
    text: e.text,
    author: { ...e.author },
    source: "self",
    permalink: e.permalink,
  };
}

// ---- The real pipeline: packet, context, run (SYS §4.3 steps 4 to 6) ----


export interface RunnerDeps {
  config: DemoConfig;
  secrets: SecretsT;
  tokens: LinearTokens;
  dryRun: boolean;
  botIds: Record<string, string>;
  loggerFor(bot: string): BotLogger;
  dispatcher(): Dispatcher;
}

export function makeRunner(deps: RunnerDeps): (match: EventMatch) => Promise<RunSummary> {
  return async (match) => {
    const def = BOTS[match.bot];
    const runId = newRunId(def.name);
    const slack = makeSlack(deps.secrets[def.secrets.slackBot] ?? "", { dryRun: deps.dryRun });
    const linearKey = def.secrets.linear ?? def.secrets.linearReader;
    const linear = linearKey ? makeLinear(def.name, deps.secrets, deps.config, { dryRun: true, tokens: deps.tokens }) : undefined;
    const packet = await buildPacket(match, { def, config: deps.config, slack, linear, botIds: deps.botIds });
    const ctx = makeContext(def, packet, {
      dryRun: deps.dryRun,
      runId,
      secrets: deps.secrets,
      config: deps.config,
      tokens: deps.tokens,
      log: deps.loggerFor(def.name),
      overrides: { slack },
      enqueueSelf: (e) => deps.dispatcher().enqueue(selfMatch(def, deps.config, e)),
    });
    if (def.packetExtras) {
      const extras = await def.packetExtras(packet, ctx);
      for (const [k, v] of Object.entries(extras)) if (!(k in packet)) (packet as Record<string, unknown>)[k] = v;
    }
    storePacket(def.name, runId, packet, deps.loggerFor(def.name).redactionValues);
    return runBot(def, packet, ctx);
  };
}
