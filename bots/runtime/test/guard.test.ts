import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as guard from "../src/guard/person-line";
import { CLOSING_FORMATS, guardPersonLine, personLineStart, w12Message } from "../src/guard/person-line";
import { GuardRefusal } from "../src/tools/define";
import { postGuarded } from "../src/clients/slack";
import { FIXTURES, mockSlack, testConfig } from "./helpers";

const lines: { text: string; refused: boolean; start: string | null }[] = JSON.parse(readFileSync(resolve(FIXTURES, "person-lines.json"), "utf8"));
const ENTRY_GUARD = resolve(__dirname, "..", "..", "..", "tools", "entry-slack-mcp", "src", "guard.ts");

describe("person-line guard (W-12)", () => {
  it("T-G-1: the 40 strings: 27 refused with their start, 13 allowed", () => {
    expect(lines.filter((l) => l.refused)).toHaveLength(27);
    expect(lines.filter((l) => !l.refused)).toHaveLength(13);
    for (const l of lines) {
      const r = guardPersonLine(l.text);
      if (l.refused) {
        expect(r, l.text).not.toBeNull();
        expect(r!.start, l.text).toBe(l.start);
        expect(personLineStart(l.text)).toBe(l.start);
        expect(r!.message).toBe(w12Message(l.start!));
        expect(r!.message).toBe(
          `Refused by the harness (W-12, OPS-F2-33, OPS-F4-10, OPS-F5-11, OPS-F6-11, OPS-F7-16): only Henry or 서준 post "${l.start}". Ask them in the thread.`,
        );
        expect(r!.wall).toBe("W-12");
      } else {
        expect(r, l.text).toBeNull();
      }
    }
  });

  it("T-G-2: closing lines pass only through CLOSING_FORMATS.close_thread", async () => {
    const link = "https://endix.slack.com/archives/C0C55EFGY5C/p1790000000000100";
    const cases = [
      [`Later: END-4 · revisit 2026-11-05 · Henry: ${link}`, "Later:"],
      [`Dropped: not now · Henry: ${link}`, "Dropped:"],
      ["Answered: https://www.notion.so/x", "Answered:"],
      ["Led to: END-12", "Led to:"],
    ] as const;
    const config = testConfig();
    for (const [text, start] of cases) {
      const slack = mockSlack();
      const ctx = { slack: slack as any, config, dryRun: false };
      const refusedPost = await postGuarded(ctx, { channel: config.slack.channels.ideas, thread_ts: "1790000000.000100", text });
      expect(refusedPost).toEqual({ refused: true, wall: "W-12", start, message: w12Message(start) });
      await expect(slack.chat.postMessage({ channel: config.slack.channels.ideas, text })).rejects.toBeInstanceOf(GuardRefusal);
      expect(slack.calls.filter((c) => c.method === "chat.postMessage")).toHaveLength(0);
      const posted = (await postGuarded(ctx, { channel: config.slack.channels.ideas, thread_ts: "1790000000.000100", text, closingFormats: CLOSING_FORMATS.close_thread })) as { ts: string; permalink: string };
      expect(posted.ts).toBeTruthy();
      expect(posted.permalink).toMatch(/^https:\/\/endix\.slack\.com\/archives\//);
      expect(slack.calls.filter((c) => c.method === "chat.postMessage")).toHaveLength(1);
    }
    const slack = mockSlack();
    const r = await postGuarded({ slack: slack as any, config, dryRun: false }, { channel: config.slack.channels.ideas, text: "Dropped: not now", closingFormats: CLOSING_FORMATS.close_thread });
    expect(r).toMatchObject({ refused: true, wall: "W-12", start: "Dropped:" });
    expect(slack.calls).toHaveLength(0);
  });

  it.skipIf(!existsSync(ENTRY_GUARD))("T-G-3: endix-entry-slack's guard.ts re-exports the runtime's guard", async () => {
    const entry = await import(ENTRY_GUARD);
    expect(entry.guardPersonLine).toBe(guard.guardPersonLine);
    for (const l of lines) expect(entry.guardPersonLine(l.text)).toEqual(guard.guardPersonLine(l.text));
    expect(readFileSync(ENTRY_GUARD, "utf8")).not.toContain("function");
  });

  it("T-G-3 (part): person-line.ts and mentions.ts have no import statement", () => {
    for (const f of ["../src/guard/person-line.ts", "../src/slack/mentions.ts"]) {
      const text = readFileSync(resolve(__dirname, f), "utf8");
      expect(text.split("\n").filter((l) => l.startsWith("import"))).toHaveLength(0);
    }
  });
});
