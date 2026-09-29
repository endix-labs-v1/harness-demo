// npm run checker -- --once [--dry-run]
import { refuseApiKey, runCli, startChecks, StartError } from "../core/start";
import { createBotLogger } from "../core/log";
import { Deduper } from "../core/dedupe";
import { ThreadQueue } from "../core/queue";
import { stopRequested } from "../core/stop";
import { Dispatcher, e16Match, makeRunner } from "../events/dispatch";

async function main(): Promise<number> {
  refuseApiKey();
  const argv = process.argv.slice(2);
  const once = argv.includes("--once");
  const dryRun = argv.includes("--dry-run");
  for (const a of argv) if (a !== "--once" && a !== "--dry-run") throw new StartError(`Unknown argument "${a}". Use --once and --dry-run.`, 1);
  if (!once) throw new StartError("npm run checker needs --once (the schedule runs with npm run bots -- --with-schedule).", 1);
  const start = await startChecks({ only: ["checker"], dryRun });
  const values = [...Object.values(start.secrets), ...start.tokens.redactionValues()];
  const log = createBotLogger("checker", { redactionValues: values });
  let dispatcher: Dispatcher;
  const run = makeRunner({ config: start.config, secrets: start.secrets, tokens: start.tokens, dryRun, botIds: start.botIds, loggerFor: () => log, dispatcher: () => dispatcher });
  dispatcher = new Dispatcher({ deduper: new Deduper(), queue: new ThreadQueue(3), loggerFor: () => log, stopRequested, run });
  try {
    await dispatcher.enqueue(e16Match("manual"));
  } finally {
    start.tokens.stop();
  }
  return 0;
}

void runCli(main);
