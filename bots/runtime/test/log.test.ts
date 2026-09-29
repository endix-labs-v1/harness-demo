import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createBotLogger } from "../src/core/log";
import { redact, REDACTION_PATTERNS } from "../src/core/redact";
import { fakeToken } from "./helpers";

describe("logs and redaction (SYS §4.7, SEC §3)", () => {
  it("T-R-13: tokens of every SEC §3 shape and the loaded secret values never reach the log file", () => {
    const shapes = [
      fakeToken("xox", "b-", "1111-2222"),
      fakeToken("xox", "p-", "3333"),
      fakeToken("xa", "pp-", "1-A0-4444"),
      fakeToken("lin", "_api_", "5555"),
      fakeToken("lin", "_oauth_", "6666"),
      fakeToken("nt", "n_", "7777"),
      fakeToken("secre", "t_", "8888"),
      fakeToken("gh", "p_", "9999"),
      fakeToken("github", "_pat_", "1010"),
      fakeToken("https://hooks.", "slack.com/services/T0/B0/xyz"),
    ];
    const values = ["short1", "plain-value-without-prefix", "k9"];
    const log = createBotLogger("checker", { redactionValues: values });
    const text = `a ${shapes.join(" b ")} c ${values.join(" ")}`;
    log.write({ kind: "tool_call", tool: "mcp__endix__x", input: { token: text, nested: [text] }, result: { r: text }, message: text });
    log.write({ kind: "refused", tool: "Bash", message: `Refused ${shapes[0]}` });
    const content = readFileSync(log.file, "utf8");
    for (const s of [...shapes, ...values]) expect(content).not.toContain(s);
    expect(content).toContain("[redacted]");
    for (const line of content.trim().split("\n")) {
      const e = JSON.parse(line);
      expect(Object.keys(e)).toEqual(["t", "bot", "run_id", "event_ts", "kind", "tool", "input", "result", "message"]);
    }
    expect(REDACTION_PATTERNS).toHaveLength(8);
    expect(redact("x", [""])).toBe("x");
  });
});
