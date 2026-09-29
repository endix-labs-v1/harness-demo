import { describe, expect, it } from "vitest";
import { ThreadQueue } from "../src/core/queue";

function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

describe("per-thread queue (SYS §4.3 step 3)", () => {
  it("T-R-9: one thread runs one at a time; two threads run in parallel; a fourth thread waits while three run", async () => {
    const q = new ThreadQueue(3);
    const log: string[] = [];
    const g1 = gate();
    const a = q.run("lighthouse", "t1", async () => {
      log.push("a start");
      await g1.p;
      log.push("a end");
    });
    const b = q.run("lighthouse", "t1", async () => {
      log.push("b start");
    });
    await tick();
    expect(log).toEqual(["a start"]);
    expect(q.stats("lighthouse")).toEqual({ queued: 1, running: 1 });
    g1.open();
    await Promise.all([a, b]);
    expect(log).toEqual(["a start", "a end", "b start"]);

    const gates = [gate(), gate(), gate()];
    const started: string[] = [];
    const runs = gates.map((g, i) =>
      q.run("lighthouse", `p${i}`, async () => {
        started.push(`p${i}`);
        await g.p;
      }),
    );
    const fourth = q.run("lighthouse", "p3", async () => {
      started.push("p3");
    });
    await tick();
    expect(started).toEqual(["p0", "p1", "p2"]);
    expect(q.stats("lighthouse")).toEqual({ queued: 1, running: 3 });
    const other = q.run("task-manager", "x", async () => {
      started.push("tm");
    });
    await other;
    expect(started).toContain("tm");
    gates[0].open();
    await runs[0];
    await fourth;
    expect(started).toEqual(["p0", "p1", "p2", "tm", "p3"]);
    gates[1].open();
    gates[2].open();
    await Promise.all(runs);
    expect(q.stats("lighthouse")).toEqual({ queued: 0, running: 0 });
  });
});
