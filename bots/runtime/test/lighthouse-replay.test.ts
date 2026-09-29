// Offline replay of the S3-01 and S1-02 eval cases (T6 Spec Req 22) with a scripted model
// (fakeSdk): the tools run in dry run, nothing is written, and the case's `expect` holds.
// The real model runs only in `npm run eval:lighthouse`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/agent/sdk", async () => (await import("./helpers/fake-sdk")).fakeSdk.module());

import { replayPacket } from "../src/replay/replay";
import { checkExpect } from "../evals/lighthouse/expect";
import type { EvalCase } from "../evals/lighthouse/run";
import { fakeSdk, mockLinear, mockSlack, testConfig } from "./helpers";

const CASES = resolve(__dirname, "..", "evals", "lighthouse", "cases");
const load = (id: string): EvalCase => JSON.parse(readFileSync(resolve(CASES, `${id}.json`), "utf8"));
const L = (name: string, input: Record<string, unknown>) => ({ name: `mcp__endix__${name}`, input });
const TASK_ROW = "none in the demo (the flow's defaults)";
const range = (f: string, a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => `OPS-${f}-${String(a + i).padStart(2, "0")}`);

async function replay(c: EvalCase) {
  const slack = mockSlack();
  const linear = mockLinear();
  const r = await replayPacket("lighthouse", { bot: "lighthouse", packet: c.packet, reads: c.reads }, { dryRun: true, config: testConfig(), overrides: { slack, linear } });
  return { ...r, slack, linear };
}

describe("Lighthouse replay fixtures (E-LH cases, scripted model)", () => {
  it("S3-01: open F2.1 with OPS-F2-01 to 16, lightmap reply, OPS-F0-07 mention; nothing written", async () => {
    const c = load("S3-01");
    const ask = c.packet.event as { permalink: string };
    fakeSdk.play([
      L("open_umbrella", {
        variant: "F2.1",
        ask: "Add totalWithFee to FeeModel",
        asker: "Henry",
        thread_permalink: ask.permalink,
        lightmap: { task_row: TASK_ROW, steps: range("F2", 1, 16), read_first: ["src/FeeModel.sol; Code doc · FeeModel"], outputs: ["Discussion in Proposals", "GitHub Issue", "branch and PR", "Code doc · FeeModel in Notion", "this thread"], closes_when: "the PR is merged, the Code doc follows it and the cleanup PR is merged" },
      }),
      L("post_reply", { thread: ask.permalink, text: "<https://dry-run.invalid/END-DRY-1|END-DRY-1> · F2.1 · Add totalWithFee to FeeModel" }),
      L("mention", { bot: "task-manager", thread: ask.permalink, step_id: "OPS-F0-07", text: "build the tree for END-DRY-1" }),
    ]);
    const r = await replay(c);
    expect(r.slack.calls.filter((x) => x.method === "chat.postMessage")).toEqual([]);
    expect(r.linear.calls).toEqual([]);
    const open = r.toolCalls[0].result as any;
    expect(open).toMatchObject({ dry_run: true, key: "END-DRY-1" });
    expect(open.lightmap_reply.split("\n")[0]).toBe("<https://dry-run.invalid/END-DRY-1|END-DRY-1> · F2.1 · Add totalWithFee to FeeModel");
    expect(open.lightmap_reply).toContain("\n- OPS-F2-16 · ");
    expect((r.toolCalls[2].result as any).would).toContain("<@U_TM> OPS-F0-07 · build the tree for END-DRY-1");
    expect(checkExpect(c.expect, r.toolCalls)).toEqual([]);
  });

  it("S3-01: a made-up step is refused W-16 and the case fails", async () => {
    const c = load("S3-01");
    const ask = c.packet.event as { permalink: string };
    fakeSdk.play([
      L("open_umbrella", {
        variant: "F2.1",
        ask: "Add totalWithFee to FeeModel",
        asker: "Henry",
        thread_permalink: ask.permalink,
        lightmap: { task_row: TASK_ROW, steps: [...range("F2", 1, 16), "OPS-F2-99"], read_first: ["x"], outputs: ["y"], closes_when: "z" },
      }),
    ]);
    const r = await replay(c);
    expect(r.toolCalls[0].result).toMatchObject({ refused: true, wall: "W-16" });
    expect(checkExpect(c.expect, r.toolCalls)).not.toEqual([]);
  });

  it("S1-02 and T-LH-11's split pattern: four pieces, each to its place, in dry run", async () => {
    const c = load("S1-02");
    const ask = (c.packet.event as { permalink: string }).permalink;
    const task = "https://dry-run.invalid/lighthouse/1";
    fakeSdk.play([
      L("open_umbrella", {
        variant: "F1.2",
        ask: "Change the fee on Fee model from 30 to 25 bps",
        asker: "Henry",
        thread_permalink: ask,
        lightmap: { task_row: TASK_ROW, steps: ["OPS-F1-09", "OPS-F1-10", "OPS-F1-12", "OPS-F1-13", "OPS-F1-14", "OPS-F0-41", "OPS-F0-42", "OPS-F0-43"], read_first: ["Fee model"], outputs: ["the draft in this thread", "Fee model in Notion", "the carry-over list in this thread"], closes_when: "Fee model is Current with the change and its carry-over list is linked" },
      }),
      L("post_reply", { thread: ask, text: "<https://dry-run.invalid/END-DRY-1|END-DRY-1> · F1.2 · Change the fee on Fee model from 30 to 25 bps" }),
      L("mention", { bot: "task-manager", thread: ask, step_id: "OPS-F0-07", text: "build the tree for END-DRY-1" }),
      L("start_task_thread", { text: "Get the Acme NDA signed", source_permalink: ask }),
      L("open_umbrella", {
        variant: "F7.1",
        ask: "Get the Acme NDA signed",
        asker: "Henry",
        thread_permalink: task,
        when: { due_date: "2026-10-02" },
        lightmap: { task_row: TASK_ROW, steps: ["OPS-F7-01", "OPS-F7-02", "OPS-F7-03", "OPS-F7-05", "OPS-F7-06", "OPS-F7-07", "OPS-F7-12", "OPS-F7-13"], read_first: ["none"], outputs: ["this thread", "the task in Linear"], closes_when: "closed with Henry's Done: or Drop: line" },
      }),
      L("post_reply", { thread: task, text: "<https://dry-run.invalid/END-DRY-2|END-DRY-2> · F7.1 · Get the Acme NDA signed" }),
      L("mention", { bot: "task-manager", thread: task, step_id: "OPS-F7-02", text: "make END-DRY-2 the task: owner Henry, due 2026-10-02" }),
      L("move_to", { channel: "questions", text: "does the fee round up or down?", source_permalink: ask, asker: "Henry" }),
      L("move_to", { channel: "ideas", text: "maybe a fee holiday in launch week?", source_permalink: ask, asker: "Henry" }),
      L("post_reply", {
        thread: ask,
        text: [
          "This ask has 4 pieces:",
          "1. Change the fee on the Fee model page from 30 to 25 bps → F1.2 · END-DRY-1",
          "2. Get the Acme NDA signed today → its own task thread",
          "3. does the fee round up or down? → moved to #demo-questions",
          "4. maybe a fee holiday in launch week? → moved to #demo-ideas",
        ].join("\n"),
      }),
    ]);
    const r = await replay(c);
    expect(r.slack.calls.filter((x) => x.method === "chat.postMessage")).toEqual([]);
    expect(r.linear.calls).toEqual([]);
    expect(r.selfEvents).toEqual([]);
    const errors = r.toolCalls.filter((x) => (x.result as any)?.error || (x.result as any)?.refused);
    expect(errors).toEqual([]);
    expect(checkExpect(c.expect, r.toolCalls)).toEqual([]);
    expect(checkExpect(load("T-LH-11").expect, r.toolCalls)).toEqual([]);
  });

  it("every case file is a valid replay fixture for `npm run replay`", () => {
    for (const id of ["S1-02", "S3-01", "S5-01", "S6-02", "T-LH-11", "T-LH-12", "X-S4-03"]) {
      const c = load(id);
      expect(c.bot).toBe("lighthouse");
      expect(c.packet).not.toHaveProperty("steps");
      expect(JSON.stringify(c)).not.toMatch(/xox[bpa]-|lin_(api|oauth)_|secre[t]_|nt[n]_/);
    }
  });
});
