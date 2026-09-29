import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/agent/sdk", async () => (await import("./helpers/fake-sdk")).fakeSdk.module());

import { compareExpected, replayPacket, ReplayFixtureSchema } from "../src/replay/replay";
import { FIXTURES, fakeSdk, mockSlack, testConfig } from "./helpers";

const fixture = ReplayFixtureSchema.parse(JSON.parse(readFileSync(resolve(FIXTURES, "replay", "sample.json"), "utf8")));
const permalink = "https://endix.slack.com/archives/C0C61PKP10Q/p1790000000000100";

describe("replay (SYS §4.8)", () => {
  it("T-R-12: sample.json with reads: the recorded calls equal expected; a changed expected gives mismatch", async () => {
    fakeSdk.play([
      { name: "mcp__endix__read_thread", input: { permalink } },
      { name: "mcp__endix__steps", input: { variant: "F1.2" } },
      { name: "Bash", input: { command: "cat ~/.config/endix-demo/secrets.env" } },
    ]);
    const slack = mockSlack();
    const r = await replayPacket("lighthouse", fixture, { dryRun: true, config: testConfig(), overrides: { slack } });
    expect(slack.calls).toEqual([]); // read_thread came from the fixture
    expect(r.toolCalls.map((c) => c.name)).toEqual(["read_thread", "steps", "Bash"]);
    expect(r.toolCalls[0].result).toEqual(fixture.reads!.read_thread![permalink]);
    expect(r.toolCalls[2].result).toMatchObject({ refused: true, wall: "W-10" });
    expect(compareExpected(r.toolCalls, fixture.expected!)).toBe("match");
    const changed = [...fixture.expected!];
    changed[1] = { tool: "steps", status: "allowed", input: { variant: "F2.1" } };
    expect(compareExpected(r.toolCalls, changed)).toBe("mismatch at 2: expected steps allowed, got steps allowed");
    const bare = await replayPacket("lighthouse", fixture, { dryRun: true }); // config from DEMO_CONFIG, as T6 and T9 call it
    expect(bare.toolCalls.map((c) => c.name)).toEqual(["read_thread", "steps", "Bash"]);
    changed[1] = { tool: "open_umbrella", status: "allowed" };
    expect(compareExpected(r.toolCalls, changed)).toBe("mismatch at 2: expected open_umbrella allowed, got steps allowed");
  });
});
