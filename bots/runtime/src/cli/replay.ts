// npm run replay -- <fixture.json>
import { readFileSync } from "node:fs";
import { refuseApiKey, runCli, startChecks, StartError } from "../core/start";
import { botDef } from "../bots/registry";
import { createBotLogger } from "../core/log";
import { redact } from "../core/redact";
import { compareExpected, replayPacket, ReplayFixtureSchema, statusOf } from "../replay/replay";

async function main(): Promise<number> {
  refuseApiKey();
  const file = process.argv[2];
  if (!file) throw new StartError("Usage: npm run replay -- <fixture.json>", 1);
  const fixture = ReplayFixtureSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  const def = botDef(fixture.bot);
  const start = await startChecks({ only: [def.name], dryRun: true });
  const values = [...Object.values(start.secrets), ...start.tokens.redactionValues()];
  const log = createBotLogger(def.name, { redactionValues: values });
  const r = await replayPacket(def.name, fixture, { dryRun: true, config: start.config, secrets: start.secrets, log });
  start.tokens.stop();
  r.toolCalls.forEach((c, i) => process.stdout.write(`${i + 1}. ${c.name} ${statusOf(c.result)} ${redact(JSON.stringify(c.input), values)}\n`));
  if (fixture.expected) {
    const verdict = compareExpected(r.toolCalls, fixture.expected);
    process.stdout.write(`${verdict}\n`);
    return verdict === "match" ? 0 : 1;
  }
  return 0;
}

void runCli(main);
