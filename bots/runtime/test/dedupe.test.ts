import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Deduper } from "../src/core/dedupe";
import { ThreadQueue } from "../src/core/queue";
import { createBotLogger } from "../src/core/log";
import { Dispatcher } from "../src/events/dispatch";
import type { EventMatch } from "../src/events/classify";

const match: EventMatch = { bot: "lighthouse", id: "E1", channel: "C0C61PKP10Q", role: "lighthouse", ts: "1790000000.000100", thread_ts: null, text: "hi", author: { name: "Henry", kind: "person" }, source: "slack" };

describe("dedupe (SYS §4.3 step 1)", () => {
  it("T-R-4: the same event twice gives one run; a new Deduper on the same seen.jsonl gives none", async () => {
    const seen = join(mkdtempSync(join(tmpdir(), "endix-seen-")), "seen.jsonl");
    let runs = 0;
    const make = () =>
      new Dispatcher({
        deduper: new Deduper(seen),
        queue: new ThreadQueue(3),
        loggerFor: (b) => createBotLogger(b),
        stopRequested: () => false,
        run: async () => {
          runs += 1;
          return { runId: "r", toolResults: [] };
        },
      });
    const d = make();
    await Promise.all([d.enqueue(match), d.enqueue({ ...match })]);
    expect(runs).toBe(1);
    await make().enqueue({ ...match });
    expect(runs).toBe(1);
    await make().enqueue({ ...match, bot: "question-idea", id: "E15" });
    expect(runs).toBe(2);
  });
});
