import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { ensureDirFor, seenFile } from "./paths";
import { nowSeoul } from "./time";

/** Dedupe on `<bot>|<channel>|<ts>`, in memory and in seen.jsonl, so a restart doesn't replay (SYS §4.3). */
export class Deduper {
  private seen = new Set<string>();
  constructor(private file: string = seenFile()) {
    if (existsSync(file)) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line) as { bot: string; channel: string; ts: string };
          this.seen.add(`${e.bot}|${e.channel}|${e.ts}`);
        } catch {
          /* a torn line is skipped */
        }
      }
    }
  }

  /** True the first time an event is seen (and records it); false for a duplicate. */
  first(bot: string, channel: string, ts: string): boolean {
    const key = `${bot}|${channel}|${ts}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    ensureDirFor(this.file);
    appendFileSync(this.file, `${JSON.stringify({ bot, channel, ts, t: nowSeoul() })}\n`, { flag: "a" });
    return true;
  }
}
