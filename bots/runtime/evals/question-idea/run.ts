// npm run eval:question-idea (T5's script line): the Question/idea agent's bot eval (TEST §2.3, T9 Req 26).
// Packets replayed in dry run on config.model.bots, on the plan login; never ANTHROPIC_API_KEY.
// Case files: evals/question-idea/cases/*.json, `{ id, set, packet, reads?, expect }`, where `set` is
// "E-QI" (run twice) or "replay" (run once, before E-QI). `{questions}`, `{ideas}`, `{lighthouse}` and
// `{page:<key>}` in a case are filled from demo.config.json.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type DemoConfig } from "../../src/core/config";
import { botsDir } from "../../src/core/paths";
import { replayPacket, ReplayFixtureSchema } from "../../src/replay/replay";

type Expect = {
  move?: "questions" | "ideas";
  hand_to_lighthouse?: boolean;
  reply_starts?: string;
  reply_matches?: string;
  reply_contains?: string[];
  reply_exact?: string;
  ask_back?: boolean;
  no_view?: boolean;
  no_move?: boolean;
  no_tool_call?: boolean;
  any_of?: Expect[];
};
interface Case {
  id: string;
  set: "E-QI" | "replay";
  test?: string; // the TEST ID a replay case proves (T-QI-1 for T1 to T7)
  packet: Record<string, unknown>;
  reads?: Record<string, unknown>;
  expect: Expect;
}
type Call = { name: string; input: any; result: unknown };

const FILE = fileURLToPath(import.meta.url);
const HERE = dirname(FILE);
const WRITES = new Set(["post_reply", "move_to", "hand_to_lighthouse", "close_thread", "file_question", "close_question"]);
const ASK_BACK = /^Do you want to know .+, or are you about to change it\?$/;
/** E-QI's twelve, word for word (TEST §2.3); T1 to T7 come from the F4 flow page (not in this repo). */
export const E_QI_IDS = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "Q1", "Q2", "Q3", "Q4", "Q5"];

export function fill(raw: string, config: DemoConfig): string {
  const ch = config.slack.channels as Record<string, string>;
  const pages = ((config.notion as Record<string, unknown>).pages ?? {}) as Record<string, string>;
  return raw
    .replace(/\{(questions|ideas|lighthouse)\}/g, (_m, k: string) => ch[k] ?? "")
    .replace(/\{page:(\w+)\}/g, (_m, k: string) => {
      if (!pages[k]) throw new Error(`config notion.pages.${k} is empty`);
      return pages[k];
    });
}

export function check(e: Expect, calls: Call[]): string | null {
  const writes = calls.filter((c) => WRITES.has(c.name));
  const replies = writes.filter((c) => c.name === "post_reply").map((c) => String(c.input?.text ?? ""));
  if (e.any_of) return e.any_of.some((x) => check(x, calls) === null) ? null : "none of any_of";
  if (e.no_tool_call && writes.length) return `expected no write, got ${writes.map((w) => w.name).join(", ")}`;
  if (e.move && !writes.some((c) => c.name === "move_to" && c.input?.channel === e.move)) return `no move_to ${e.move}`;
  if (e.no_move && writes.some((c) => c.name === "move_to" || c.name === "hand_to_lighthouse")) return "moved or handed off";
  if (e.hand_to_lighthouse && !writes.some((c) => c.name === "hand_to_lighthouse")) return "no hand_to_lighthouse";
  if (e.ask_back && !replies.some((t) => ASK_BACK.test(t))) return "no ask-back reply";
  if (e.reply_starts && !replies.some((t) => t.startsWith(e.reply_starts!))) return `no reply starting "${e.reply_starts}"`;
  if (e.reply_matches && !replies.some((t) => new RegExp(e.reply_matches!, "m").test(t))) return `no reply matching /${e.reply_matches}/`;
  if (e.reply_contains && !replies.some((t) => e.reply_contains!.every((s) => t.includes(s)))) return `no reply containing ${JSON.stringify(e.reply_contains)}`;
  if (e.reply_exact && !replies.includes(e.reply_exact)) return "no reply with the exact text";
  if (e.no_view && replies.some((t) => t.split("\n").some((l) => l.startsWith("View:")))) return "a line starts View:";
  return null;
}

async function runCase(c: Case, config: DemoConfig): Promise<string | null> {
  const fixture = ReplayFixtureSchema.parse({ bot: "question-idea", packet: c.packet, reads: c.reads });
  const r = await replayPacket("question-idea", fixture, { dryRun: true, config });
  return check(c.expect, r.toolCalls as Call[]);
}

async function main(): Promise<number> {
  if (process.env.ANTHROPIC_API_KEY) {
    process.stderr.write("ANTHROPIC_API_KEY is set: unset it; the eval runs on the plan login (SEC §4).\n");
    return 1;
  }
  const config = loadConfig();
  const dir = join(HERE, "cases");
  const cases: Case[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    try {
      cases.push(JSON.parse(fill(readFileSync(join(dir, f), "utf8"), config)) as Case);
    } catch (e) {
      process.stdout.write(`${f}: not loaded: ${(e as Error).message}\n`);
    }
  }
  const byId = new Map(cases.map((c) => [c.id, c]));
  const results: { id: string; run: number; pass: boolean; why: string | null }[] = [];
  const once = async (c: Case, run: number) => {
    let why: string | null;
    try {
      why = await runCase(c, config);
    } catch (e) {
      why = `error: ${(e as Error).message}`;
    }
    results.push({ id: c.id, run, pass: why === null, why });
    process.stdout.write(`${c.id} run ${run}: ${why === null ? "pass" : `fail (${why})`}\n`);
    return why === null;
  };

  // The replay tests, once each, before E-QI.
  const t1 = await Promise.all(["T1", "T2", "T3", "T4", "T5", "T6", "T7"].map(async (id) => (byId.get(id) ? once(byId.get(id)!, 0) : false)));
  const nT1 = t1.filter(Boolean).length;
  const replay: Record<string, boolean> = { "T-QI-1": nT1 === 7 };
  for (const test of ["T-QI-2", "T-QI-3", "T-QI-4", "T-QI-9", "T-QI-10"]) {
    const c = cases.find((x) => x.set === "replay" && x.test === test);
    replay[test] = c ? await once(c, 0) : false;
  }
  const counts = [0, 0];
  for (const run of [1, 2]) {
    for (const id of E_QI_IDS) {
      const c = byId.get(id);
      if (!c) {
        process.stdout.write(`${id} run ${run}: fail (case missing)\n`);
        continue;
      }
      if (await once(c, run)) counts[run - 1] += 1;
    }
  }
  process.stdout.write(`T-QI-1 ${replay["T-QI-1"] ? "pass" : "fail"} (${nT1}/7)\n`);
  for (const t of ["T-QI-2", "T-QI-3", "T-QI-4", "T-QI-9", "T-QI-10"]) process.stdout.write(`${t} ${replay[t] ? "pass" : "fail"}\n`);
  const eqi = counts[0] >= 11 && counts[1] >= 11;
  process.stdout.write(`E-QI: ${counts[0]}/12 run 1, ${counts[1]}/12 run 2 (need 11)\nE-QI ${eqi ? "pass" : "fail"}\n`);
  const pass = eqi && Object.values(replay).every(Boolean);
  const prompt = readFileSync(join(botsDir(), "question-idea.md"), "utf8");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const runs = join(HERE, "runs");
  mkdirSync(runs, { recursive: true });
  const file = join(runs, `${stamp}.json`);
  writeFileSync(
    file,
    `${JSON.stringify({ bot: "question-idea", model: config.model.bots, prompt_sha: createHash("sha256").update(prompt).digest("hex"), cases: results, pass }, null, 2)}\n`,
  );
  process.stdout.write(`${file}\n`);
  return pass ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === FILE) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`${(e as Error).message}\n`);
      process.exit(1);
    },
  );
}
