import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fenceProject, w11 } from "../src/fence/project";
import { callTool, defineTool } from "../src/tools/define";
import { mockLinear, testContext, testConfig } from "./helpers";

const PROJECT = testConfig().linear.project_id;

describe("project fence (W-11)", () => {
  it("T-R-7: another project or none is refused; the project's own issue passes; a refused write sends no mutation", async () => {
    const linear = mockLinear().on("FenceProject", (v: Record<string, unknown>) => {
      if (v.key === "END-1") return { issue: { project: { id: PROJECT } } };
      if (v.key === "END-9999") return { issue: { project: { id: "other-project" } } };
      return { issue: { project: null } };
    });
    const ctx = testContext("task-manager", { mocks: { linear } });
    expect(await fenceProject(ctx, "END-1")).toBeNull();
    expect(await fenceProject(ctx, "END-9999")).toEqual({ refused: true, wall: "W-11", message: w11("END-9999") });
    expect(await fenceProject(ctx, "END-9")).toEqual({ refused: true, wall: "W-11", message: w11("END-9") });
    expect(w11("END-9999")).toBe("Refused by the harness (W-11, SEC §5): END-9999 is outside the project Harness demo.");

    const writer = defineTool({
      name: "test_close",
      description: "test write",
      input: { key: z.string() },
      async handler(input, c) {
        const r = await fenceProject(c, input.key);
        if (r) return r;
        await c.linear(`mutation Close($id: String!) { issueUpdate(id: $id, input: {}) { success } }`, { id: input.key });
        return { ok: true };
      },
    });
    const refused = await callTool(writer, { key: "END-9999" }, ctx);
    expect(refused.value).toMatchObject({ refused: true, wall: "W-11" });
    expect(linear.calls.some((c) => c.query.trim().startsWith("mutation"))).toBe(false);
    const ok = await callTool(writer, { key: "END-1" }, ctx);
    expect(ok.value).toEqual({ ok: true });
    expect(linear.calls.filter((c) => c.query.trim().startsWith("mutation"))).toHaveLength(1);
  });
});
