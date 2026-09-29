import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/agent/sdk", async () => (await import("./helpers/fake-sdk")).fakeSdk.module());

import { Deduper } from "../src/core/dedupe";
import { ThreadQueue } from "../src/core/queue";
import { createBotLogger } from "../src/core/log";
import { stopFile } from "../src/core/paths";
import { stopRequested } from "../src/core/stop";
import { Dispatcher } from "../src/events/dispatch";
import { runBot } from "../src/agent/run";
import { BOTS } from "../src/bots/registry";
import { fakeSdk, testContext, testPacket } from "./helpers";

describe("STOP file (SEC §7)", () => {
  it("T-R-8: with STOP present the event is logged ignored and the fake query is never called", async () => {
    mkdirSync(dirname(stopFile()), { recursive: true });
    writeFileSync(stopFile(), "");
    fakeSdk.play([{ name: "mcp__endix__steps", input: { variant: "F1.2" } }]);
    const log = createBotLogger("lighthouse");
    const d = new Dispatcher({
      deduper: new Deduper(join(tmpdir(), `seen-${process.pid}-${Date.now()}.jsonl`)),
      queue: new ThreadQueue(3),
      loggerFor: () => log,
      stopRequested,
      run: async () => runBot(BOTS.lighthouse, testPacket("lighthouse"), testContext("lighthouse")),
    });
    const r = await d.enqueue({ bot: "lighthouse", id: "E1", channel: "C0C61PKP10Q", role: "lighthouse", ts: "1790000555.000100", thread_ts: null, text: "hi", author: { name: "Henry", kind: "person" }, source: "slack" });
    expect(r.runId).toBe("not-run");
    expect(fakeSdk.state.queryCalls).toBe(0);
    const last = readFileSync(log.file, "utf8").trim().split("\n").map((l) => JSON.parse(l)).pop();
    expect(last).toMatchObject({ kind: "ignored", message: "STOP file present", event_ts: "1790000555.000100" });
    rmSync(stopFile());
  });
});
