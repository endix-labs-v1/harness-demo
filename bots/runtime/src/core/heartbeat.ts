import { renameSync, writeFileSync } from "node:fs";
import { heartbeatFile, ensureDirFor } from "./paths";
import { nowSeoul } from "./time";

export interface Heartbeat {
  t: string;
  pid: number;
  cwd: string;
  args: string[];
  bots: Record<string, { connected: boolean | null; queued: number; running: number }>;
}

/** Written to heartbeat.json.tmp, then renamed, so a reader never sees half a file (Req 32). */
export function writeHeartbeat(hb: Heartbeat, file: string = heartbeatFile()): void {
  ensureDirFor(file);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(hb)}\n`);
  renameSync(tmp, file);
}

export interface HeartbeatSource {
  bots: string[];
  connected(bot: string): boolean | null;
  stats(bot: string): { queued: number; running: number };
}

/** Once at start, then every 10 s; `stop()` writes the last one with every `connected` false. */
export function startHeartbeat(args: string[], source: HeartbeatSource, file: string = heartbeatFile()) {
  const snapshot = (final: boolean): Heartbeat => {
    const bots: Heartbeat["bots"] = {};
    for (const b of source.bots) bots[b] = { connected: final ? false : source.connected(b), ...source.stats(b) };
    return { t: nowSeoul(), pid: process.pid, cwd: process.cwd(), args: [...args], bots };
  };
  writeHeartbeat(snapshot(false), file);
  const timer = setInterval(() => writeHeartbeat(snapshot(false), file), 10_000);
  timer.unref?.();
  return {
    stop(): void {
      clearInterval(timer);
      writeHeartbeat(snapshot(true), file);
    },
  };
}
