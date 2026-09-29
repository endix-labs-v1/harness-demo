import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startHeartbeat } from "../src/core/heartbeat";
import { heartbeatFile } from "../src/core/paths";
import { ThreadQueue } from "../src/core/queue";

const T = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/;
afterEach(() => vi.useRealTimers());

describe("heartbeat (SYS §4.1)", () => {
  it("keys, every 10 s, queued and running, the checker's null, the last write on stop, no .tmp left", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-02T05:03:10Z") });
    const args = ["--only", "lighthouse,checker", "--with-schedule"];
    const q = new ThreadQueue(3);
    let release!: () => void;
    const inFlight = q.run("lighthouse", "lighthouse|C|1", () => new Promise<void>((r) => (release = r)));
    const waiting = q.run("lighthouse", "lighthouse|C|1", async () => undefined);
    await vi.advanceTimersByTimeAsync(0);
    const hb = startHeartbeat(args, { bots: ["lighthouse", "checker"], connected: (b) => (b === "checker" ? null : true), stats: (b) => q.stats(b) });
    const read = () => JSON.parse(readFileSync(heartbeatFile(), "utf8"));
    const first = read();
    expect(Object.keys(first)).toEqual(["t", "pid", "cwd", "args", "bots"]);
    expect(first.pid).toBe(process.pid);
    expect(first.cwd).toBe(process.cwd());
    expect(first.args).toEqual(args);
    expect(first.t).toBe("2026-10-02T14:03:10+09:00");
    expect(first.bots).toEqual({ lighthouse: { connected: true, queued: 1, running: 1 }, checker: { connected: null, queued: 0, running: 0 } });
    await vi.advanceTimersByTimeAsync(10_000);
    const second = read();
    expect(second.t).toMatch(T);
    expect(second.t).toBe("2026-10-02T14:03:20+09:00");
    release();
    await inFlight;
    await waiting;
    hb.stop();
    const last = read();
    expect(last.bots).toEqual({ lighthouse: { connected: false, queued: 0, running: 0 }, checker: { connected: false, queued: 0, running: 0 } });
    expect(readdirSync(dirname(heartbeatFile())).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("checker --once leaves an existing heartbeat unchanged", () => {
    const home = mkdtempSync(join(tmpdir(), "endix-hb-"));
    const file = join(home, "heartbeat.json");
    writeFileSync(file, '{"t":"x"}\n');
    const root = resolve(__dirname, "..");
    const env: NodeJS.ProcessEnv = { ...process.env, ENDIX_HOME: home, ENDIX_SECRETS: join(home, "missing.env") };
    delete env.ANTHROPIC_API_KEY;
    const r = spawnSync(join(root, "node_modules", ".bin", "tsx"), ["src/cli/checker.ts", "--once", "--dry-run"], { cwd: root, env, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toBe('{"t":"x"}\n');
  });
});
