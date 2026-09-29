import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDirFor, logsDir } from "./paths";
import { redact } from "./redact";
import { nowSeoul } from "./time";

export type LogKind = "run_start" | "tool_call" | "tool_result" | "refused" | "run_end" | "ignored";

export interface LogEntry {
  t: string;
  bot: string;
  run_id: string | null;
  event_ts: string | null;
  kind: LogKind;
  tool: string | null;
  input: unknown;
  result: unknown;
  message: string | null;
}

export interface BotLogger {
  bot: string;
  file: string;
  redactionValues: string[];
  write(entry: Partial<LogEntry> & { kind: LogKind }): LogEntry;
  /** A logger whose lines carry this run's ID and event ts. */
  forRun(runId: string, eventTs: string | null): BotLogger;
}

/** One JSON line per entry in `logs/<bot>.jsonl`, appended with one open, write and close (Req 3, 22). */
export function createBotLogger(
  bot: string,
  opts: { redactionValues?: string[]; runId?: string | null; eventTs?: string | null } = {},
): BotLogger {
  const redactionValues = opts.redactionValues ?? [];
  const file = join(logsDir(), `${bot}.jsonl`);
  const logger: BotLogger = {
    bot,
    file,
    redactionValues,
    write(partial) {
      const entry: LogEntry = {
        t: nowSeoul(),
        bot,
        run_id: partial.run_id ?? opts.runId ?? null,
        event_ts: partial.event_ts ?? opts.eventTs ?? null,
        kind: partial.kind,
        tool: partial.tool ?? null,
        input: partial.input ?? null,
        result: partial.result ?? null,
        message: partial.message ?? null,
      };
      const safe = redact(entry, redactionValues);
      ensureDirFor(file);
      appendFileSync(file, `${JSON.stringify(safe)}\n`, { flag: "a" });
      return safe;
    },
    forRun(runId, eventTs) {
      return createBotLogger(bot, { redactionValues, runId, eventTs });
    },
  };
  return logger;
}

/** The red console line for a wall's refusal (SYS §4.7). */
export function printRefusal(wall: string, bot: string, tool: string, message: string, redactionValues: string[] = []): void {
  const line = redact(`REFUSED ${wall} ${bot} ${tool}: ${message}`, redactionValues);
  process.stderr.write(`\x1b[31m${line}\x1b[0m\n`);
}
