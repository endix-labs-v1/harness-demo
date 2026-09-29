import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { botsDir } from "../src/core/paths";
import { FIXTURES } from "./helpers";

type Step = { id: string; who: string; does: string; output: string | null; sub_issue: boolean };
const cat = JSON.parse(readFileSync(resolve(botsDir(), "data", "steps.json"), "utf8")) as {
  source: string;
  variants: Record<string, { name: string; flow: string; umbrella: boolean; sub_issues: boolean; steps: Step[]; includes: string[] }>;
};
const refIds: string[] = JSON.parse(readFileSync(resolve(FIXTURES, "ref-step-ids.json"), "utf8"));

function range(flow: string, from: number, to: number): string[] {
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(`OPS-${flow}-${String(i).padStart(2, "0")}`);
  return out;
}

describe("step catalogue (REF §2, §3)", () => {
  it("T-LH-2: every step ID in REF §1 and §2 is in steps.json, and nothing else", () => {
    expect(refIds).toHaveLength(75);
    const expected = [
      ...range("F0", 1, 9), ...range("F0", 41, 43), ...range("F1", 9, 14), ...range("F2", 1, 23), ...range("F4", 1, 7),
      ...range("F5", 1, 5), ...range("F6", 1, 8), ...range("F7", 1, 3), ...range("F7", 5, 13), ...range("F9", 17, 18),
    ];
    expect(new Set(refIds)).toEqual(new Set(expected));
    const inFile = new Set(Object.values(cat.variants).flatMap((v) => v.steps.map((s) => s.id)));
    expect(inFile).toEqual(new Set(refIds));
  });

  it("T-LH-2: the thirteen variants, their flags, each variant's IDs in table order, F2.3's copies equal F2.1's rows", () => {
    expect(cat.source).toBe("OPS · F0 to F9 flow pages as quoted in REF §2, as of 2026-09-25");
    expect(Object.keys(cat.variants)).toEqual(["F0.1", "F0.6", "F1.2", "F2.1", "F2.2", "F2.3", "F4", "F5.1", "F6", "F7.1", "F7.2", "F7.3", "F9.4"]);
    const ids = (v: string) => cat.variants[v].steps.map((s) => s.id);
    expect(ids("F2.3")).toEqual(["OPS-F2-21", "OPS-F2-22", "OPS-F2-23", ...range("F2", 1, 11), ...range("F2", 14, 16)]);
    expect(ids("F7.1")).toEqual(["OPS-F7-01", "OPS-F7-02", "OPS-F7-03", "OPS-F7-05", "OPS-F7-06", "OPS-F7-07", "OPS-F7-12", "OPS-F7-13"]);
    expect(ids("F7.2")).toEqual(["OPS-F7-01", "OPS-F7-02", "OPS-F7-03", "OPS-F7-08", "OPS-F7-09", "OPS-F7-12", "OPS-F7-13"]);
    expect(ids("F7.3")).toEqual(["OPS-F7-01", "OPS-F7-02", "OPS-F7-03", "OPS-F7-10", "OPS-F7-11", "OPS-F7-12", "OPS-F7-13"]);
    const f21 = new Map(cat.variants["F2.1"].steps.map((s) => [s.id, s]));
    for (const s of cat.variants["F2.3"].steps.slice(3)) expect(s).toEqual(f21.get(s.id));
    for (const v of ["F0.1", "F0.6", "F4", "F6"]) expect(cat.variants[v].umbrella).toBe(false);
    for (const v of ["F7.1", "F7.2", "F7.3"]) expect(cat.variants[v].sub_issues).toBe(false);
    expect(cat.variants["F1.2"].includes).toEqual(["F0.6"]);
    for (const [k, v] of Object.entries(cat.variants)) {
      if (k !== "F1.2") expect(v.includes).toEqual([]);
      for (const s of v.steps) expect(Object.keys(s)).toEqual(["id", "who", "does", "output", "sub_issue"]);
    }
    const f12 = cat.variants["F1.2"].steps;
    expect(f12[1]).toEqual({ id: "OPS-F1-10", who: "Entry agent", does: "Drafts the change in the thread: section, current text, new text and why", output: "Change in the thread", sub_issue: true });
    expect(f12[2].sub_issue).toBe(false); // "no (not on a Current page)"
    expect(cat.variants["F2.3"].steps[1]).toMatchObject({ id: "OPS-F2-22", sub_issue: false });
    expect(cat.variants["F0.1"].steps[0].output).toBeNull();
  });
});
