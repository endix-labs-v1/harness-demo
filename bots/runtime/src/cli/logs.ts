// npm run logs -- --bot <bot> [--refused]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { botDef } from "../bots/registry";
import { logsDir } from "../core/paths";
import { runCli, StartError } from "../core/start";

export function formatLogLine(e: { t: string; kind: string; tool: string | null; message: string | null; result: unknown }): string {
  const summary = e.message ?? (e.result === null || e.result === undefined ? "" : JSON.stringify(e.result).slice(0, 120));
  return `${e.t} ${e.kind} ${e.tool ?? "-"} ${summary}`;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--bot");
  const bot = i >= 0 ? argv[i + 1] : undefined;
  if (!bot) throw new StartError("Usage: npm run logs -- --bot <bot> [--refused]", 1);
  try {
    botDef(bot);
  } catch (e) {
    throw new StartError((e as Error).message, 1);
  }
  const refusedOnly = argv.includes("--refused");
  const file = join(logsDir(), `${bot}.jsonl`);
  if (!existsSync(file)) return 0;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const e = JSON.parse(line);
    if (refusedOnly && e.kind !== "refused") continue;
    process.stdout.write(`${formatLogLine(e)}\n`);
  }
  return 0;
}

void runCli(main);
