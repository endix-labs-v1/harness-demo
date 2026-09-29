// npm --prefix bots/runtime run eval:lighthouse (T6 Spec Req 22, TEST §2.3 E-LH).
// Replays each case twice to Lighthouse on config.model.bots, every write in dry run.
// Needs the plan login and Lighthouse's tokens (reads are real in dry run); never ANTHROPIC_API_KEY.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { refuseApiKey, runCli, startChecks } from "../../src/core/start";
import { botsDir } from "../../src/core/paths";
import { createBotLogger } from "../../src/core/log";
import { redact } from "../../src/core/redact";
import { readSteps } from "../../src/packet/build";
import { replayPacket, type ReplayFixture } from "../../src/replay/replay";
import { checkExpect, type Call, type Expect } from "./expect";

const HERE = resolve(botsDir(), "runtime", "evals", "lighthouse");

export interface EvalCase {
  bot?: "lighthouse";
  id: string;
  set: "R" | "demo" | "check" | "extra";
  packet: Record<string, unknown>;
  reads?: ReplayFixture["reads"];
  expect: Expect;
}

export function loadCases(dir = join(HERE, "cases")): EvalCase[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as EvalCase);
}

function hashObject(path: string): string {
  try {
    return execFileSync("git", ["hash-object", path], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function main(): Promise<number> {
  refuseApiKey();
  const start = await startChecks({ only: ["lighthouse"], dryRun: true });
  const values = [...Object.values(start.secrets), ...start.tokens.redactionValues()];
  const log = createBotLogger("lighthouse", { redactionValues: values });
  const cases = loadCases();
  const out: { id: string; set: string; runs: { pass: boolean; tool_calls: Call[] }[] }[] = [];
  for (const c of cases) {
    const runs: { pass: boolean; tool_calls: Call[] }[] = [];
    for (const n of [1, 2]) {
      const fixture: ReplayFixture = { bot: "lighthouse", packet: { ...c.packet, steps: readSteps() }, reads: c.reads };
      let calls: Call[] = [];
      let failures: string[];
      try {
        const r = await replayPacket("lighthouse", fixture, { dryRun: true, config: start.config, secrets: start.secrets, log });
        calls = r.toolCalls as Call[];
        failures = checkExpect(c.expect, calls);
      } catch (e) {
        failures = [`run failed: ${(e as Error).message}`];
      }
      runs.push({ pass: failures.length === 0, tool_calls: redact(calls, values) as Call[] });
      process.stdout.write(`${c.id} (${c.set}) run ${n}: ${failures.length ? `fail · ${redact(failures.join("; "), values)}` : "pass"}\n`);
    }
    out.push({ id: c.id, set: c.set, runs });
  }
  start.tokens.stop();
  const bothPass = (id: string) => out.find((c) => c.id === id)?.runs.every((r) => r.pass) ?? false;
  const count = (set: string, run: number) => out.filter((c) => c.set === set && c.runs[run]?.pass).length;
  const r1 = count("R", 0);
  const r2 = count("R", 1);
  const d1 = count("demo", 0);
  const d2 = count("demo", 1);
  const lh11 = bothPass("T-LH-11");
  const lh12 = bothPass("T-LH-12");
  const pass = lh11 && lh12 && r1 >= 14 && r2 >= 14 && d1 === 9 && d2 === 9;
  process.stdout.write(`T-LH-11 ${lh11 ? "pass" : "fail"}\n`);
  process.stdout.write(`T-LH-12 ${lh12 ? "pass" : "fail"}\n`);
  process.stdout.write(`E-LH R cases: ${r1}/16 run 1, ${r2}/16 run 2 (need 14)\n`);
  process.stdout.write(`E-LH demo cases: ${d1}/9 run 1, ${d2}/9 run 2 (need 9)\n`);
  process.stdout.write(`E-LH ${pass ? "pass" : "fail"}\n`);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const runsDir = join(HERE, "runs");
  mkdirSync(runsDir, { recursive: true });
  const file = join(runsDir, `${stamp}.json`);
  const record = {
    bot: "lighthouse",
    model: start.config.model.bots,
    steps_sha: hashObject(join(botsDir(), "data", "steps.json")),
    prompt_sha: hashObject(join(botsDir(), "lighthouse.md")),
    cases: out,
    pass,
  };
  writeFileSync(file, `${JSON.stringify(redact(record, values), null, 2)}\n`);
  process.stdout.write(`${file}\n`);
  return pass ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]).endsWith(join("evals", "lighthouse", "run.ts"))) void runCli(main);
