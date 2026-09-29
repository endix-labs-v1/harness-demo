import type { WebClient } from "@slack/web-api";
import type { Client } from "@notionhq/client";
import type { BotDef } from "../bots/types";
import type { DemoConfig } from "../core/config";
import { createBotLogger, type BotLogger } from "../core/log";
import type { Secrets } from "../core/secrets";
import { todaySeoul } from "../core/time";
import { guardSlack, makeSlack } from "../clients/slack";
import { makeLinear, type LinearFn, type LinearTokens } from "../clients/linear";
import { guardNotion, makeNotion } from "../clients/notion";
import { makeGithub, type GithubReader } from "../clients/github";
import type { ContextPacket } from "../packet/build";
import type { RunSummary } from "../events/dispatch";
import type { FixtureReads } from "../replay/replay";
import { DryRunWriteError, type SelfEvent, type ToolContext } from "./define";

export interface ContextOptions {
  dryRun: boolean;
  runId: string;
  secrets: Secrets;
  config: DemoConfig;
  reads?: FixtureReads;
  tokens?: LinearTokens;
  log?: BotLogger;
  enqueueSelf?: (e: SelfEvent) => Promise<RunSummary>;
  overrides?: Partial<{
    slack: WebClient | object;
    linear: LinearFn;
    notion: Client | object;
    github: GithubReader;
    now: () => Date;
  }>;
}

/** The ToolContext of one run (Req 14); `overrides` replaces any client (test helpers). */
export function makeContext(def: BotDef, packet: ContextPacket, opts: ContextOptions): ToolContext {
  const { dryRun, secrets, config } = opts;
  const o = opts.overrides ?? {};
  const slack = (o.slack ? guardSlack(o.slack as object, { dryRun }) : makeSlack(secrets[def.secrets.slackBot] ?? "", { dryRun })) as WebClient;
  const linearKey = def.secrets.linear ?? def.secrets.linearReader;
  const linear: LinearFn = o.linear
    ? async (q, v) => {
        if (dryRun && /^\s*mutation\b/.test(q)) throw new DryRunWriteError("dry run: linear mutation blocked");
        return o.linear!(q, v);
      }
    : linearKey
      ? makeLinear(def.name, secrets, config, { dryRun, tokens: opts.tokens })
      : async () => {
          throw new Error(`${def.displayName} has no Linear token.`);
        };
  const notion = o.notion
    ? (guardNotion(o.notion as object, { dryRun }) as Client)
    : def.secrets.notion && secrets[def.secrets.notion]
      ? makeNotion(secrets[def.secrets.notion], { dryRun })
      : undefined;
  const github = o.github ?? (def.secrets.github && secrets[def.secrets.github] ? makeGithub(secrets[def.secrets.github], config.github.repo) : undefined);
  const now = o.now ?? (() => new Date());
  const log = (opts.log ?? createBotLogger(def.name, { redactionValues: Object.values(secrets) })).forRun(opts.runId, packet.event.ts);
  return {
    bot: def.name,
    def,
    runId: opts.runId,
    dryRun,
    event: packet.event,
    packet,
    config,
    slack,
    linear,
    notion,
    github,
    now,
    today: () => todaySeoul(now()),
    log,
    enqueueSelf:
      opts.enqueueSelf ??
      (async () => {
        throw new Error("enqueueSelf is not wired in this context.");
      }),
    reads: opts.reads,
  };
}
