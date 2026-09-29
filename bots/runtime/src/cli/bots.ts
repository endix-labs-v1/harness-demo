// npm run bots [-- --only lighthouse,task-manager] [--dry-run] [--with-schedule] [--test-channel]
import { refuseApiKey, parseOnly, runCli, startChecks, StartError } from "../core/start";
import { BOTS } from "../bots/registry";
import type { BotName } from "../bots/types";
import { createBotLogger, type BotLogger } from "../core/log";
import { Deduper } from "../core/dedupe";
import { ThreadQueue } from "../core/queue";
import { stopRequested } from "../core/stop";
import { startHeartbeat } from "../core/heartbeat";
import { Dispatcher, e16Match, makeRunner } from "../events/dispatch";
import { applyTestChannel } from "../events/classify";
import { startSlackApp } from "../events/slack-app";
import { parseDaily, scheduleChecker } from "../events/schedule";
import { getIssue, makeLinear } from "../clients/linear";

export function parseBotsArgs(argv: string[]) {
  const out = { only: undefined as string | undefined, dryRun: false, withSchedule: false, testChannel: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--only") out.only = argv[++i] ?? "";
    else if (a.startsWith("--only=")) out.only = a.slice(7);
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--with-schedule") out.withSchedule = true;
    else if (a === "--test-channel") out.testChannel = true;
    else throw new StartError(`Unknown argument "${a}". Use --only, --dry-run, --with-schedule, --test-channel.`, 1);
  }
  return out;
}

async function main(): Promise<number | void> {
  refuseApiKey();
  const args = process.argv.slice(2);
  const opts = parseBotsArgs(args);
  const only: BotName[] = parseOnly(opts.only);
  const start = await startChecks({ only, dryRun: opts.dryRun });
  const config = opts.testChannel ? applyTestChannel(start.config) : start.config;
  if (opts.testChannel) process.stderr.write("--test-channel: #demo-build-test plays #demo-lighthouse; the real #demo-lighthouse wakes nobody.\n");
  if (opts.withSchedule && only.includes("checker")) parseDaily(config.checker.schedule);
  const values = [...Object.values(start.secrets), ...start.tokens.redactionValues()];
  const loggers = new Map<string, BotLogger>();
  const loggerFor = (bot: string) => {
    let l = loggers.get(bot);
    if (!l) loggers.set(bot, (l = createBotLogger(bot, { redactionValues: values })));
    return l;
  };
  const queue = new ThreadQueue(3);
  let dispatcher: Dispatcher;
  const run = makeRunner({ config, secrets: start.secrets, tokens: start.tokens, dryRun: opts.dryRun, botIds: start.botIds, loggerFor, dispatcher: () => dispatcher });
  dispatcher = new Dispatcher({ deduper: new Deduper(), queue, loggerFor, stopRequested, run });

  const connected = new Map<string, boolean | null>();
  for (const b of only) connected.set(b, BOTS[b].socketMode ? false : null);
  const tmLinear = makeLinear("task-manager", start.secrets, config, { dryRun: true, tokens: start.tokens });
  const issueLabels = async (key: string) => {
    const issue = await getIssue({ linear: tmLinear }, key).catch(() => null);
    return (issue?.labels?.nodes ?? []).map((l: { name: string }) => l.name);
  };
  const apps: Array<{ stop(): Promise<unknown> }> = [];
  for (const b of only) {
    const def = BOTS[b];
    if (!def.socketMode) continue;
    apps.push(
      await startSlackApp(def, {
        botToken: start.secrets[def.secrets.slackBot],
        appToken: start.secrets[def.secrets.slackApp!],
        config,
        botIds: start.botIds,
        dispatcher,
        redactionValues: values,
        issueLabels,
        onConnected: (v) => connected.set(b, v),
      }),
    );
  }
  const schedule =
    opts.withSchedule && only.includes("checker")
      ? scheduleChecker(config.checker.schedule, config.timezone, () =>
          dispatcher.enqueue(e16Match("schedule")),
        )
      : null;
  const heartbeat = startHeartbeat(args, { bots: only, connected: (b) => connected.get(b) ?? null, stats: (b) => queue.stats(b) });
  process.stdout.write(`bots running${opts.dryRun ? " (dry run)" : ""}: ${only.join(", ")}\n`);

  await new Promise<void>((resolve) => {
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      schedule?.stop();
      for (const app of apps) await app.stop().catch(() => undefined);
      await queue.drain(30_000);
      start.tokens.stop();
      heartbeat.stop();
      resolve();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
  return 0;
}

void runCli(main);
