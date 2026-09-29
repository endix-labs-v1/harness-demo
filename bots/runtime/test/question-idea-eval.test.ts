// T9 Req 26: the eval runner's expectation checks and its case files, offline (no model).
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ReplayFixtureSchema } from "../src/replay/replay";
import { check, fill } from "../evals/question-idea/run";
import { testConfig } from "./helpers";

const CASES = resolve(__dirname, "..", "evals", "question-idea", "cases");

describe("eval:question-idea runner (offline parts)", () => {
  it("each case file fills from config and parses as a replay fixture", () => {
    const config = testConfig();
    (config.notion as any).pages = { ...(config.notion as any).pages, launch_plan: "3ea8f1ec11b4810000000000000000aa" };
    const files = readdirSync(CASES).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const f of files) {
      const c = JSON.parse(fill(readFileSync(join(CASES, f), "utf8"), config));
      expect(() => ReplayFixtureSchema.parse({ bot: "question-idea", packet: c.packet, reads: c.reads })).not.toThrow();
      expect(c.packet.now).toBe("2026-10-02T10:00:00+09:00");
      expect(JSON.stringify(c)).not.toMatch(/\{(questions|ideas|lighthouse|page:\w+)\}/);
    }
  });

  it("check(): move, hand-off, ask back, context without a view", () => {
    const reply = (text: string) => ({ name: "post_reply", input: { thread: "t", text }, result: {} });
    expect(check({ move: "ideas" }, [{ name: "move_to", input: { channel: "ideas" }, result: {} }])).toBeNull();
    expect(check({ move: "ideas" }, [{ name: "move_to", input: { channel: "questions" }, result: {} }])).toBe("no move_to ideas");
    expect(check({ hand_to_lighthouse: true }, [{ name: "hand_to_lighthouse", input: {}, result: {} }])).toBeNull();
    expect(check({ ask_back: true }, [reply("Do you want to know the fee today, or are you about to change it?")])).toBeNull();
    const ctx = "Context from the docs:\n- The fee is 25 bps (https://x)\nEarlier threads: none\nPages it would touch: https://x";
    const e = { reply_starts: "Context from the docs:", reply_matches: "^Earlier threads: [\\s\\S]*^Pages it would touch: ", no_view: true };
    expect(check(e, [reply(ctx)])).toBeNull();
    expect(check(e, [reply(`${ctx}\nView: do it.`)])).toBe("a line starts View:");
    expect(check({ no_tool_call: true }, [{ name: "notion_search", input: {}, result: {} }])).toBeNull();
  });
});
