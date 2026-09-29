// T7 · the task manager's write tools (TEST §2.2, T-TM-1 to T-TM-12). Mocks only; no model,
// no secret, no live write. Keys are fake (END-95xx, END-96xx) and name no real issue.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mockLinear, mockSlack, permalinkFor, testConfig, testContext, type MockLinear, type MockSlack } from "./helpers";
import { callTool, type ToolContext } from "../src/tools/define";
import { botsDir } from "../src/core/paths";
import { taskManagerWriteTools } from "../src/tools/task-manager/index";
import { lightmapSteps, normalizeIssue, shortId, sourceOf, threadOf, variantOf } from "../src/tools/task-manager/issues";
import { subIssueFlag } from "../src/tools/task-manager/catalogue";
import { W15 } from "../src/tools/task-manager/texts";
import { w11 } from "../src/fence/project";

const cfg = testConfig();
const LH = cfg.slack.channels.lighthouse;
const IDEAS = cfg.slack.channels.ideas;
const PROJECT = cfg.linear.project_id;
const OTHER_PROJECT = "11111111-2222-3333-4444-555555555555";
const STATES = cfg.linear.states as Record<string, string>;
const STATE_TYPE: Record<string, string> = { Backlog: "backlog", Todo: "unstarted", "In Progress": "started", "In Review": "started", Done: "completed", Canceled: "canceled" };
const CATALOGUE = JSON.parse(readFileSync(join(botsDir(), "data", "steps.json"), "utf8")) as {
  variants: Record<string, { name: string; steps: { id: string; who: string; does: string; output: string | null }[]; includes?: string[] }>;
};

// ---------------------------------------------------------------- the mocked world

interface Rec {
  id: string;
  identifier: string;
  title: string;
  url: string;
  description: string;
  dueDate: string | null;
  state: string;
  labels: string[];
  project: string;
  parent: string | null;
  assignee: string | null;
  relations: { type: string; key: string }[];
  attachments: { url: string; title: string }[];
}

function rec(key: string, over: Partial<Rec> = {}): Rec {
  return {
    id: `id-${key}`,
    identifier: key,
    title: over.title ?? key,
    url: `https://linear.app/endix/issue/${key.toLowerCase()}`,
    description: "",
    dueDate: null,
    state: "Todo",
    labels: [],
    project: PROJECT,
    parent: null,
    assignee: null,
    relations: [],
    attachments: [],
    ...over,
  };
}

function world(recs: Rec[]) {
  const store = new Map<string, Rec>(recs.map((r) => [r.identifier, r]));
  const byId = (id: string) => [...store.values()].find((r) => r.id === id);
  const comments: { issueId: string; body: string }[] = [];
  let n = 9600;
  const gql = (r: Rec) => ({
    id: r.id,
    identifier: r.identifier,
    title: r.title,
    url: r.url,
    description: r.description,
    dueDate: r.dueDate,
    state: { name: r.state, type: STATE_TYPE[r.state] },
    labels: { nodes: r.labels.map((name) => ({ name })) },
    assignee: r.assignee ? { id: r.assignee } : null,
    project: { id: r.project },
    parent: r.parent ? { identifier: r.parent } : null,
    children: { nodes: [...store.values()].filter((c) => c.parent === r.identifier).map((c) => ({ id: c.id, identifier: c.identifier, title: c.title, description: c.description, state: { name: c.state, type: STATE_TYPE[c.state] } })) },
    relations: { nodes: r.relations.map((x) => ({ type: x.type, relatedIssue: { identifier: x.key } })) },
    inverseRelations: {
      nodes: [...store.values()].flatMap((o) => o.relations.filter((x) => x.key === r.identifier).map((x) => ({ type: x.type, issue: { identifier: o.identifier, state: { name: o.state, type: STATE_TYPE[o.state] } } }))),
    },
    attachments: { nodes: r.attachments },
  });
  const linear = mockLinear()
    .on("FenceProject", (v: any) => ({ issue: store.has(v.key) ? { project: { id: store.get(v.key)!.project } } : null }))
    .on("IssueFull", (v: any) => ({ issue: store.has(v.key) ? gql(store.get(v.key)!) : null }))
    .on("IssueCreate", (v: any) => {
      const i = v.input;
      n += 1;
      const key = `END-${n}`;
      const parent = byId(i.parentId);
      const stateName = Object.keys(STATES).find((k) => STATES[k] === i.stateId) ?? "Todo";
      const r = rec(key, { title: i.title, description: i.description, parent: parent?.identifier ?? null, state: stateName, project: i.projectId });
      store.set(key, r);
      return { issueCreate: { success: true, issue: { id: r.id, identifier: key, title: r.title, url: r.url } } };
    })
    .on("IssueUpdate", (v: any) => {
      const r = byId(v.id)!;
      const i = v.input;
      if (i.stateId) r.state = Object.keys(STATES).find((k) => STATES[k] === i.stateId)!;
      if ("description" in i) r.description = i.description;
      if ("dueDate" in i) r.dueDate = i.dueDate;
      if ("assigneeId" in i) r.assignee = i.assigneeId;
      if (i.addedLabelIds) r.labels.push("Later");
      return { issueUpdate: { success: true, issue: { id: r.id, identifier: r.identifier, url: r.url, state: { name: r.state } } } };
    })
    .on("CommentCreate", (v: any) => {
      comments.push({ issueId: v.input.issueId, body: v.input.body });
      return { commentCreate: { success: true, comment: { id: `c${comments.length}`, url: "https://linear.app/c" } } };
    })
    .on("IssueRelationCreate", (v: any) => {
      byId(v.input.issueId)!.relations.push({ type: v.input.type, key: byId(v.input.relatedIssueId)!.identifier });
      return { issueRelationCreate: { success: true, issueRelation: { id: "rel" } } };
    })
    .on("AttachmentLinkURL", (v: any) => {
      byId(v.issueId)!.attachments.push({ url: v.url, title: v.title });
      return { attachmentLinkURL: { success: true, attachment: { id: "att", url: v.url } } };
    });
  const ops = (op: string) => linear.calls.filter((c) => c.op === op);
  const writes = () => linear.calls.filter((c) => /^\s*mutation\b/.test(c.query));
  return { store, linear, comments, ops, writes };
}

function tool(name: string) {
  const t = taskManagerWriteTools.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
}

/** A tool call through T5's tool path, with the mocks and a fixed day (2026-10-02, Seoul). */
async function call(name: string, input: unknown, m: { linear: MockLinear; slack?: MockSlack; dryRun?: boolean }) {
  const ctx: ToolContext = testContext("task-manager", { mocks: { linear: m.linear, slack: m.slack ?? mockSlack() }, dryRun: m.dryRun });
  ctx.now = () => new Date("2026-10-02T05:03:00Z");
  ctx.today = () => "2026-10-02";
  const r = await callTool(tool(name), input, ctx);
  return JSON.parse(JSON.stringify(r.value));
}

// ---------------------------------------------------------------- fixtures (SYS §6.1, §6.2)

function stepLines(variant: string, ids: string[]): string[] {
  const all = [variant, ...(CATALOGUE.variants[variant].includes ?? [])].flatMap((v) => CATALOGUE.variants[v].steps);
  return ids.map((id) => {
    const s = all.find((x) => x.id === id)!;
    return `- ${id} · ${s.who} · ${s.does}`;
  });
}
function variantIds(variant: string): string[] {
  return [variant, ...(CATALOGUE.variants[variant].includes ?? [])].flatMap((v) => CATALOGUE.variants[v].steps.map((s) => s.id));
}
function umbrellaDescription(variant: string, ids: string[], thread: string, extra: string[] = []): string {
  return [
    `Thread: ${thread}`,
    "Source: Henry · 2026-10-02",
    ...extra,
    "",
    "## Lightmap",
    "",
    `Flow: ${variant} · ${CATALOGUE.variants[variant].name} · Task row: none in the demo (the flow's defaults)`,
    "Steps:",
    ...stepLines(variant, ids),
    "Read first: Fee model",
    "Outputs land in: this thread",
    "Closes when: the flow's end state holds",
  ].join("\n");
}
/** `by` per the prompt (T7 Spec Req 15): the first actor `who` names; Owner and Henry or 서준 are Henry. */
function byOf(who: string): string {
  const first = who.split(",")[0].trim();
  if (/^(owner|henry)/i.test(first)) return "Henry";
  if (/^merge action$/i.test(first)) return "merge Action";
  if (/^(entry agent|doc manager|task manager)$/i.test(first)) return first.toLowerCase();
  return first;
}
function stepsInput(variant: string, ids: string[]) {
  const all = [variant, ...(CATALOGUE.variants[variant].includes ?? [])].flatMap((v) => CATALOGUE.variants[v].steps);
  return ids.map((id) => {
    const s = all.find((x) => x.id === id)!;
    return { step_id: id, output: s.output, by: byOf(s.who) };
  });
}

const TS = { A: "1790001000.000100", B: "1790002000.000100", F: "1790004000.000100", IDEA: "1790003000.000100" };
const THREAD_A = permalinkFor(LH, TS.A);
const THREAD_B = permalinkFor(LH, TS.B);
const THREAD_F = permalinkFor(LH, TS.F);
const IDEA_THREAD = permalinkFor(IDEAS, TS.IDEA);
const DONE_TS = "1790002100.000100";
const MOVE_TS = "1790002200.000100";
const BOT_DONE_TS = "1790002300.000100";
const DROP_TS = "1790002400.000100";
const NO_TS = "1790003100.000100";
const DONE_LINK = permalinkFor(LH, DONE_TS, TS.B);
const MOVE_LINK = permalinkFor(LH, MOVE_TS, TS.B);
const BOT_DONE_LINK = permalinkFor(LH, BOT_DONE_TS, TS.B);
const DROP_LINK = permalinkFor(LH, DROP_TS, TS.B);
const NO_LINK = permalinkFor(IDEAS, NO_TS, TS.IDEA);

const F12_IDS = ["OPS-F1-09", "OPS-F1-10", "OPS-F1-12", "OPS-F1-13", "OPS-F1-14", "OPS-F0-41", "OPS-F0-42", "OPS-F0-43"];
const F21_IDS = Array.from({ length: 16 }, (_, i) => `OPS-F2-${String(i + 1).padStart(2, "0")}`);

const umbrellaA = () => rec("END-9512", { title: "F1.2 · Change the fee on Fee model to 25 bps", description: umbrellaDescription("F1.2", F12_IDS, THREAD_A), labels: ["Lightmap"] });
const umbrellaF = () => rec("END-9530", { title: "F2.1 · Add totalWithFee to FeeModel", description: umbrellaDescription("F2.1", F21_IDS, THREAD_F), labels: ["Lightmap"] });
const F71_IDS = ["OPS-F7-01", "OPS-F7-02", "OPS-F7-03", "OPS-F7-05", "OPS-F7-06", "OPS-F7-07", "OPS-F7-12", "OPS-F7-13"];
const taskBLater = () => rec("END-9514", { title: "F7.1 · Send Acme the NDA", description: umbrellaDescription("F7.1", F71_IDS, THREAD_B), labels: ["Lightmap", "Later"] });
const taskBDue = () => ({ ...taskBLater(), dueDate: "2026-10-02", assignee: cfg.people.henry.linear_user_id });
const F73_IDS = ["OPS-F7-01", "OPS-F7-02", "OPS-F7-03", "OPS-F7-10", "OPS-F7-11", "OPS-F7-12", "OPS-F7-13"];
const taskKRevisit = () =>
  rec("END-9540", {
    title: "F7.3 · Revisit the fee rebate idea",
    description: umbrellaDescription("F7.3", F73_IDS, permalinkFor(LH, "1790005000.000100")).replace("Source: Henry · 2026-10-02", `Source: Henry · 2026-10-02 · ${IDEA_THREAD}`),
    labels: ["Lightmap", "Later"],
    dueDate: "2026-10-02",
  });
const otherProjectIssue = () => rec("END-9999", { title: "F1.2 · Not in the demo", description: umbrellaDescription("F1.2", F12_IDS, THREAD_A), project: OTHER_PROJECT });

/** The F2.1 tree as create_steps files it, plus the Discussion Action's check issue (SYS §6.3). */
function treeF21(): Rec[] {
  const shorts = F21_IDS.filter((id) => subIssueFlag(id, "F2.1")).map((id) => {
    const s = CATALOGUE.variants["F2.1"].steps.find((x) => x.id === id)!;
    return { id, s };
  });
  const kids = shorts.map(({ id, s }, i) =>
    rec(`END-${9531 + i}`, { title: `${shortId(id)} · ${s.output}`, description: `By: ${byOf(s.who)}\nDone when: ${s.output}:`, parent: "END-9530" }),
  );
  const check = rec("END-9545", {
    title: "F2-02 · Check: Add totalWithFee to FeeModel",
    description: "Discussion: https://github.com/endix-labs-v1/harness-demo/discussions/7\nBy: Discussion Action",
    parent: "END-9530",
  });
  return [umbrellaF(), ...kids, check];
}

function slackWithThreads(): MockSlack {
  const slack = mockSlack();
  slack.fixtures.replies[TS.B] = [
    { ts: TS.B, user: "U_LH", text: "END-9514 · F7.1 · Send Acme the NDA" },
    { ts: DONE_TS, thread_ts: TS.B, user: "U_HENRY", text: "Done: Acme signed the NDA today." },
    { ts: MOVE_TS, thread_ts: TS.B, user: "U_HENRY", text: "Move: October 5, 2026, the NDA was late." },
    { ts: BOT_DONE_TS, thread_ts: TS.B, user: "U_EA", text: "Done: sent" },
    { ts: DROP_TS, thread_ts: TS.B, user: "U_HENRY", text: "Drop: Acme went with another vendor." },
  ];
  slack.fixtures.replies[TS.IDEA] = [
    { ts: TS.IDEA, user: "U_HENRY", text: "A fee rebate for early holders?" },
    { ts: NO_TS, thread_ts: TS.IDEA, user: "U_HENRY", text: "No: the rebate breaks the fee model." },
  ];
  return slack;
}

// ---------------------------------------------------------------- tests

describe("task manager · shared parts", () => {
  it("reads the thread, source, lightmap steps and variant of each fixture", () => {
    const a = normalizeIssue({ ...umbrellaA(), labels: { nodes: [{ name: "Lightmap" }] } });
    expect(threadOf(a)).toBe(THREAD_A);
    expect(sourceOf(a)).toBeNull();
    expect(lightmapSteps(a)).toEqual(F12_IDS);
    expect(variantOf(a)).toBe("F1.2");
    const k = normalizeIssue(taskKRevisit());
    expect(sourceOf(k)).toBe(IDEA_THREAD);
    expect(subIssueFlag("OPS-F0-43", "F1.2")).toBe(false);
    expect(subIssueFlag("OPS-F1-10", "F1.2")).toBe(true);
    expect(subIssueFlag("OPS-F9-99", "F1.2")).toBeNull();
  });

  it("exports the seven writes in SYS §5.3 order", () => {
    expect(taskManagerWriteTools.map((t) => t.name)).toEqual(["create_steps", "comment", "set_fields", "link", "fill_done_when", "close", "post_reply"]);
  });
});

describe("task manager · create_steps", () => {
  it("T-TM-1: F1.2 files four steps, skips the rest, and files nothing twice", async () => {
    const w = world([umbrellaA()]);
    const r = await call("create_steps", { umbrella: "END-9512", steps: stepsInput("F1.2", F12_IDS) }, w);
    const creates = w.ops("IssueCreate");
    expect(creates).toHaveLength(4);
    expect(creates.map((c: any) => c.variables.input.title)).toEqual([
      "F1-10 · Change in the thread",
      "F1-12 · Thread reply",
      "F1-13 · Updated Current page",
      "F1-14 · Carry-over list; follow-ups; closed umbrella",
    ]);
    expect(creates.map((c: any) => c.variables.input.description)).toEqual([
      "By: entry agent\nDone when: Change in the thread:",
      "By: Henry\nDone when: Thread reply:",
      "By: doc manager\nDone when: Updated Current page:",
      "By: entry agent\nDone when: Carry-over list; follow-ups; closed umbrella:",
    ]);
    for (const c of creates as any[]) {
      expect(c.variables.input).toMatchObject({ parentId: "id-END-9512", stateId: cfg.linear.states.Todo, teamId: cfg.linear.team_id, projectId: PROJECT });
    }
    expect(r.skipped).toEqual(["OPS-F1-09", "OPS-F0-41", "OPS-F0-42", "OPS-F0-43"]);
    expect(r.tree_reply).toBe("END-9512: 4 steps filed · F1-10, F1-12, F1-13, F1-14");

    const again = await call("create_steps", { umbrella: "END-9512", steps: stepsInput("F1.2", F12_IDS) }, w);
    expect(w.ops("IssueCreate")).toHaveLength(4);
    expect(again.created).toEqual([]);
    expect(again.existing.map((e: any) => e.title)).toEqual(creates.map((c: any) => c.variables.input.title));
    expect(again.tree_reply).toBe("END-9512: 4 steps filed · F1-10, F1-12, F1-13, F1-14");
  });

  it("T-TM-2: F2.1 files eleven sub-issues in order", async () => {
    const w = world([umbrellaF()]);
    const r = await call("create_steps", { umbrella: "END-9530", steps: stepsInput("F2.1", F21_IDS) }, w);
    const shorts = w.ops("IssueCreate").map((c: any) => String(c.variables.input.title).split(" · ")[0]);
    expect(shorts).toEqual(["F2-01", "F2-03", "F2-04", "F2-06", "F2-07", "F2-08", "F2-09", "F2-10", "F2-12", "F2-13", "F2-15"]);
    expect(r.tree_reply).toBe(`END-9530: 11 steps filed · ${shorts.join(", ")}`);
  });

  it("create_steps counts: F2.2 3, F2.3 10, F5.1 4, F9.4 2", async () => {
    const expected: Record<string, string[]> = {
      "F2.2": ["F2-17", "F2-18", "F2-19"],
      "F2.3": ["F2-01", "F2-03", "F2-04", "F2-06", "F2-07", "F2-08", "F2-09", "F2-10", "F2-15", "F2-23"],
      "F5.1": ["F5-01", "F5-02", "F5-03", "F5-04"],
      "F9.4": ["F9-17", "F9-18"],
    };
    for (const [variant, shorts] of Object.entries(expected)) {
      const ids = variantIds(variant);
      const w = world([rec("END-9550", { title: `${variant} · a test ask`, description: umbrellaDescription(variant, ids, THREAD_A), labels: ["Lightmap"] })]);
      await call("create_steps", { umbrella: "END-9550", steps: stepsInput(variant, ids) }, w);
      const got = w.ops("IssueCreate").map((c: any) => String(c.variables.input.title).split(" · ")[0]);
      expect(got, variant).toHaveLength(shorts.length);
      expect([...got].sort(), variant).toEqual([...shorts].sort());
    }
  });

  it("T-TM-3: a step outside the lightmap is refused (W-16) and nothing is created", async () => {
    const w = world([umbrellaA()]);
    const r = await call("create_steps", { umbrella: "END-9512", steps: [{ step_id: "OPS-F1-11", output: "Updated Draft page", by: "doc manager" }] }, w);
    expect(r).toEqual({ refused: true, wall: "W-16", message: "Refused by the harness (W-16, OPS-F0-24): OPS-F1-11 is not a step of F1.2. A lightmap quotes only steps on the flow page." });
    expect(w.writes()).toHaveLength(0);
  });

  it("create_steps in dry run checks the walls and writes nothing", async () => {
    const w = world([umbrellaA()]);
    const r = await call("create_steps", { umbrella: "END-9512", steps: stepsInput("F1.2", F12_IDS) }, { ...w, dryRun: true });
    expect(r.dry_run).toBe(true);
    expect(r.titles).toHaveLength(4);
    expect(w.writes()).toHaveLength(0);
  });
});

describe("task manager · comment, set_fields, fill_done_when", () => {
  it("T-TM-4: comment is one line, date · what · permalink", async () => {
    const w = world([taskBDue()]);
    const r = await call("comment", { issue: "END-9514", what: 'Moved: "Move: October 5, 2026, the NDA was late."', thread_permalink: MOVE_LINK }, w);
    expect(w.ops("CommentCreate")).toHaveLength(1);
    expect(w.comments[0]).toEqual({ issueId: "id-END-9514", body: `2026-10-02 · Moved: "Move: October 5, 2026, the NDA was late." · ${MOVE_LINK}` });
    expect(r.comment).toBe(w.comments[0].body);
  });

  it("T-TM-5: set_fields state Done or Canceled is refused (OPS-F0-09)", async () => {
    for (const state of ["Done", "Canceled"]) {
      const w = world([umbrellaA()]);
      const r = await call("set_fields", { issue: "END-9512", state }, w);
      expect(r).toEqual({ refused: true, rule: "OPS-F0-09", message: "closing goes through close (OPS-F0-09)." });
      expect(w.ops("IssueUpdate")).toHaveLength(0);
    }
  });

  it("T-TM-6: owner and due date at opening need no permalink", async () => {
    const w = world([taskBLater()]);
    const r = await call("set_fields", { issue: "END-9514", assignee: "henry", due_date: "2026-10-02" }, w);
    const ups = w.ops("IssueUpdate");
    expect(ups).toHaveLength(1);
    expect(ups[0].variables.input).toEqual({ assigneeId: cfg.people.henry.linear_user_id, dueDate: "2026-10-02" });
    expect(r.set).toEqual({ assignee: "henry", due_date: "2026-10-02" });
  });

  it("T-TM-7: moving a Later task's when needs Henry's Move: line (W-15)", async () => {
    const slack = slackWithThreads();
    let w = world([taskBDue()]);
    expect(await call("set_fields", { issue: "END-9514", due_date: "2026-10-05" }, { ...w, slack })).toEqual({ refused: true, wall: "W-15", message: W15 });
    expect(await call("set_fields", { issue: "END-9514", due_date: "2026-10-05", person_line_permalink: BOT_DONE_LINK }, { ...w, slack })).toEqual({ refused: true, wall: "W-15", message: W15 });
    // Henry's Done: line is his, in the thread, but not a Move: line.
    expect(await call("set_fields", { issue: "END-9514", due_date: "2026-10-05", person_line_permalink: DONE_LINK }, { ...w, slack })).toEqual({ refused: true, wall: "W-15", message: W15 });
    expect(w.ops("IssueUpdate")).toHaveLength(0);
    const r = await call("set_fields", { issue: "END-9514", due_date: "2026-10-05", person_line_permalink: MOVE_LINK }, { ...w, slack });
    expect(r.set).toEqual({ due_date: "2026-10-05" });
    expect(w.ops("IssueUpdate")).toHaveLength(1);
    expect(w.store.get("END-9514")!.dueDate).toBe("2026-10-05");
    // A blocked-by when is a when too.
    w = world([taskBLater(), rec("END-9515", { relations: [{ type: "blocks", key: "END-9514" }] })]);
    expect(await call("set_fields", { issue: "END-9514", due_date: "2026-10-05" }, { ...w, slack })).toEqual({ refused: true, wall: "W-15", message: W15 });
  });

  it("T-TM-11: fill_done_when rewrites only the Done when line", async () => {
    const before = "By: entry agent\nDone when: Change in the thread:";
    const w = world([umbrellaA(), rec("END-9600", { title: "F1-10 · Change in the thread", description: before, parent: "END-9512" })]);
    const link = permalinkFor(LH, "1790001100.000100", TS.A);
    await call("fill_done_when", { issue: "END-9600", link }, w);
    const ups = w.ops("IssueUpdate");
    expect(ups).toHaveLength(1);
    expect(ups[0].variables.input).toEqual({ description: `By: entry agent\nDone when: Change in the thread: ${link}` });
    const r = await call("fill_done_when", { issue: "END-9512", link }, w);
    expect(r).toEqual({ refused: true, rule: "OPS-F0-13", message: "END-9512 has no Done when line to fill." });
    expect(w.ops("IssueUpdate")).toHaveLength(1);
  });
});

describe("task manager · close", () => {
  it("T-TM-8: close Done quotes Henry's Done: line from Slack, then Done", async () => {
    const w = world([taskBDue()]);
    const r = await call("close", { issue: "END-9514", kind: "Done", text: "model's own copy, ignored", person_line_permalink: DONE_LINK }, { ...w, slack: slackWithThreads() });
    expect(w.comments).toEqual([{ issueId: "id-END-9514", body: `Done · Henry: "Done: Acme signed the NDA today." · ${DONE_LINK}` }]);
    const ups = w.ops("IssueUpdate");
    expect(ups).toHaveLength(1);
    expect(ups[0].variables.input).toEqual({ stateId: cfg.linear.states.Done });
    const order = w.writes().map((c) => c.op);
    expect(order).toEqual(["CommentCreate", "IssueUpdate"]);
    expect(r.closed_reply).toBe("END-9514 closed · Done");
    expect(r.state).toBe("Done");
  });

  it("T-TM-9: a bot's Done: line, or Closed, can't close a to-do (W-15)", async () => {
    const slack = slackWithThreads();
    const w = world([taskBDue()]);
    expect(await call("close", { issue: "END-9514", kind: "Done", text: "x", person_line_permalink: BOT_DONE_LINK }, { ...w, slack })).toEqual({ refused: true, wall: "W-15", message: W15 });
    expect(await call("close", { issue: "END-9514", kind: "Done", text: "x" }, { ...w, slack })).toEqual({ refused: true, wall: "W-15", message: W15 });
    expect(await call("close", { issue: "END-9514", kind: "Done", text: "x", person_line_permalink: MOVE_LINK }, { ...w, slack })).toEqual({ refused: true, wall: "W-15", message: W15 });
    expect(await call("close", { issue: "END-9514", kind: "Closed", text: "Closed · done" }, { ...w, slack })).toEqual({ refused: true, wall: "W-15", message: W15 });
    expect(await call("close", { issue: "END-9514", kind: "Not doing", text: "https://github.com/x" }, { ...w, slack })).toEqual({ refused: true, wall: "W-15", message: W15 });
    expect(w.writes()).toHaveLength(0);
  });

  it("close on Later issues: Drop and No cancel on the person's line; Led to and Reopened", async () => {
    const slack = slackWithThreads();
    let w = world([taskBDue()]);
    let r = await call("close", { issue: "END-9514", kind: "Drop", text: "x", person_line_permalink: DROP_LINK }, { ...w, slack });
    expect(w.comments[0].body).toBe(`Drop · Henry: "Drop: Acme went with another vendor." · ${DROP_LINK}`);
    expect(r.state).toBe("Canceled");
    expect(w.store.get("END-9514")!.state).toBe("Canceled");

    w = world([taskKRevisit()]);
    r = await call("close", { issue: "END-9540", kind: "No", text: "x", person_line_permalink: NO_LINK }, { ...w, slack });
    expect(w.comments[0].body).toBe(`No · Henry: "No: the rebate breaks the fee model." · ${NO_LINK}`);
    expect(r.closed_reply).toBe("END-9540 closed · No");

    w = world([taskKRevisit()]);
    r = await call("close", { issue: "END-9540", kind: "Reopened", text: IDEA_THREAD }, { ...w, slack });
    expect(w.comments[0].body).toBe(`Reopened: ${IDEA_THREAD}`);
    w = world([taskKRevisit()]);
    expect(await call("close", { issue: "END-9540", kind: "Reopened", text: THREAD_B }, { ...w, slack })).toEqual({ refused: true, wall: "W-15", message: W15 });

    w = world([taskBDue(), rec("END-9560", { title: "F2.1 · the later work" })]);
    r = await call("close", { issue: "END-9514", kind: "Led to", text: "END-9560" }, { ...w, slack });
    expect(w.comments[0].body).toBe("Led to: END-9560");
    expect(r.state).toBe("Done");
    w = world([taskBDue(), otherProjectIssue()]);
    expect(await call("close", { issue: "END-9514", kind: "Led to", text: "END-9999" }, { ...w, slack })).toEqual({ refused: true, wall: "W-15", message: W15 });
  });

  it("T-TM-10: a tree with an open child stays open; the F2.1 tree closes after its person steps", async () => {
    // A with F1-12 still in Todo.
    let w = world([
      umbrellaA(),
      rec("END-9601", { title: "F1-10 · Change in the thread", parent: "END-9512", state: "Done" }),
      rec("END-9602", { title: "F1-12 · Thread reply", parent: "END-9512", state: "Todo" }),
    ]);
    let r = await call("close", { issue: "END-9512", kind: "Closed", text: `Closed · Fee model is Current with the change · carry-over list: ${THREAD_A}` }, w);
    expect(r).toEqual({ refused: true, rule: "OPS-F0-09", message: "END-9602 (F1-12 · Thread reply) is Todo; a tree closes when every child is Done or Canceled." });
    expect(w.writes()).toHaveLength(0);

    // The F2.1 tree (S3-11, S3-20, S3-30).
    w = world(treeF21());
    const child = (short: string) => [...w.store.values()].find((x) => x.title.startsWith(`${short} · `))!;
    const GO = "https://github.com/endix-labs-v1/harness-demo/discussions/7#discussioncomment-1";
    const DISC = "https://github.com/endix-labs-v1/harness-demo/discussions/7";
    const PR = "https://github.com/endix-labs-v1/harness-demo/pull/12";
    const steps: [string, string, string][] = [
      ["F2-04", GO, `Closed · go by Henry: ${GO} · ${THREAD_F}`],
      ["F2-03", DISC, `Closed · Discussion replies by Henry: ${DISC} · ${THREAD_F}`],
      ["F2-09", PR, `Closed · approved by Seojun (demo): ${PR} · ${THREAD_F}`],
    ];
    for (const [short, link, text] of steps) {
      const c = child(short);
      const before = c.description;
      await call("fill_done_when", { issue: c.identifier, link }, w);
      const output = before.split("\n")[1].replace(/^Done when: /, "").replace(/:$/, "");
      expect(c.description).toBe(before.replace(`Done when: ${output}:`, `Done when: ${output}: ${link}`));
      r = await call("close", { issue: c.identifier, kind: "Closed", text }, w);
      expect(r.comment).toBe(text);
      expect(c.state).toBe("Done");
    }
    expect(child("F2-04").description).toBe(`By: Henry\nDone when: Discussion reply: ${GO}`);
    const check = child("F2-02");
    r = await call("close", { issue: check.identifier, kind: "Closed", text: `Closed · go on the discussion: ${GO} · ${THREAD_F}` }, w);
    expect(r.state).toBe("Done");
    expect(check.description).toBe("Discussion: https://github.com/endix-labs-v1/harness-demo/discussions/7\nBy: Discussion Action");

    // Every other child closed, the check issue back to Todo: the tree stays open, naming it.
    for (const x of w.store.values()) if (x.parent === "END-9530") x.state = "Done";
    check.state = "Todo";
    const closeF = { issue: "END-9530", kind: "Closed", text: `Closed · the flow's end state holds · ${THREAD_F}` };
    const commentsBefore = w.comments.length;
    r = await call("close", closeF, w);
    expect(r).toEqual({ refused: true, rule: "OPS-F0-09", message: `${check.identifier} (F2-02 · Check: Add totalWithFee to FeeModel) is Todo; a tree closes when every child is Done or Canceled.` });
    expect(w.comments.length).toBe(commentsBefore);
    check.state = "Done";
    r = await call("close", closeF, w);
    expect(w.comments.length).toBe(commentsBefore + 1);
    expect(w.comments.at(-1)!.body).toBe(closeF.text);
    expect(w.store.get("END-9530")!.state).toBe("Done");
    expect(r.closed_reply).toBe("END-9530 closed · Closed");
  });

  it("close: the docs issue formats, Not doing, and to-do kinds on a tree", async () => {
    const w = world([umbrellaF(), rec("END-9570", { title: "F2-11 · Docs: Add totalWithFee", parent: "END-9530", description: 'PR: https://github.com/x/pull/1\nBy: merge Action\nDone when: the Code doc link, or "no doc change" and why' })]);
    let r = await call("close", { issue: "END-9570", kind: "Closed", text: "Code doc: https://www.notion.so/code-doc" }, w);
    expect(r.comment).toBe("Code doc: https://www.notion.so/code-doc");
    r = await call("close", { issue: "END-9530", kind: "Closed", text: "done, trust me" }, w);
    expect(r.error).toMatch(/^input: /);
    r = await call("close", { issue: "END-9530", kind: "Done", text: "x", person_line_permalink: DONE_LINK }, w);
    expect(r.error).toMatch(/^input: /);
    r = await call("close", { issue: "END-9530", kind: "Not doing", text: "https://github.com/endix-labs-v1/harness-demo/discussions/7" }, w);
    expect(r.comment).toBe('Not doing · Henry: "no" · https://github.com/endix-labs-v1/harness-demo/discussions/7');
    expect(r.state).toBe("Canceled");
  });
});

describe("task manager · link and post_reply", () => {
  it("link: blocked by, related and a URL, each once", async () => {
    const w = world([taskBLater(), rec("END-9515"), umbrellaA()]);
    let r = await call("link", { issue: "END-9514", blocked_by: "END-9515" }, w);
    expect(r.added).toEqual(["blocked by END-9515"]);
    expect(w.ops("IssueRelationCreate")[0].variables.input).toEqual({ issueId: "id-END-9515", relatedIssueId: "id-END-9514", type: "blocks" });
    r = await call("link", { issue: "END-9514", blocked_by: "END-9515", related: "END-9512", url: THREAD_A, url_title: "Carry-over list" }, w);
    expect(r.already).toEqual(["blocked by END-9515"]);
    expect(r.added).toEqual(["related END-9512", `link ${THREAD_A}`]);
    expect(w.ops("AttachmentLinkURL")[0].variables).toEqual({ issueId: "id-END-9514", url: THREAD_A, title: "Carry-over list" });
    r = await call("link", { issue: "END-9512", related: "END-9514", url: THREAD_A }, w);
    expect(r.already).toEqual(["related END-9514"]);
    expect(w.ops("IssueRelationCreate")).toHaveLength(2);
  });

  it("post_reply replies in the #demo-lighthouse thread and keeps W-12", async () => {
    const slack = mockSlack();
    const w = world([]);
    const r = await call("post_reply", { thread: DONE_LINK, text: "END-9514 closed · Done" }, { ...w, slack });
    expect(r.permalink).toMatch(/^https:\/\//);
    const posts = slack.calls.filter((c) => c.method === "chat.postMessage");
    expect(posts).toHaveLength(1);
    expect(posts[0].args).toMatchObject({ channel: LH, thread_ts: TS.B, text: "END-9514 closed · Done" });
    const refused = await call("post_reply", { thread: THREAD_B, text: "Done: sent" }, { ...w, slack });
    expect(refused.wall).toBe("W-12");
    const other = await call("post_reply", { thread: IDEA_THREAD, text: "hello" }, { ...w, slack });
    expect(other.error).toMatch(/^input: /);
    expect(slack.calls.filter((c) => c.method === "chat.postMessage")).toHaveLength(1);
  });
});

describe("task manager · dry run", () => {
  it("every Linear write runs its checks and returns would-do, writing nothing", async () => {
    const slack = slackWithThreads();
    const w = world([...treeF21(), taskBDue(), rec("END-9515")]);
    const f204 = [...w.store.values()].find((x) => x.title.startsWith("F2-04 · "))!.identifier;
    const inputs: [string, unknown][] = [
      ["comment", { issue: "END-9514", what: "x", thread_permalink: THREAD_B }],
      ["set_fields", { issue: "END-9514", due_date: "2026-10-05", person_line_permalink: MOVE_LINK }],
      ["link", { issue: "END-9514", related: "END-9515", url: THREAD_B }],
      ["fill_done_when", { issue: f204, link: "https://github.com/endix-labs-v1/harness-demo/discussions/7#discussioncomment-1" }],
      ["close", { issue: "END-9514", kind: "Done", text: "x", person_line_permalink: DONE_LINK }],
    ];
    for (const [name, input] of inputs) {
      const r = await call(name, input, { ...w, slack, dryRun: true });
      expect(r.dry_run, name).toBe(true);
    }
    // The walls still run in dry run.
    expect(await call("close", { issue: "END-9514", kind: "Done", text: "x", person_line_permalink: BOT_DONE_LINK }, { ...w, slack, dryRun: true })).toEqual({ refused: true, wall: "W-15", message: W15 });
    expect(w.writes()).toHaveLength(0);
  });
});

describe("task manager · the project fence", () => {
  it("T-TM-12: every write on an issue outside the project is refused (W-11)", async () => {
    const W11 = { refused: true, wall: "W-11", message: w11("END-9999") };
    const w = world([otherProjectIssue(), taskBLater()]);
    const calls: [string, unknown][] = [
      ["create_steps", { umbrella: "END-9999", steps: stepsInput("F1.2", F12_IDS) }],
      ["comment", { issue: "END-9999", what: "x", thread_permalink: THREAD_A }],
      ["set_fields", { issue: "END-9999", state: "In Progress" }],
      ["link", { issue: "END-9999", url: THREAD_A }],
      ["link", { issue: "END-9514", related: "END-9999" }],
      ["link", { issue: "END-9514", blocked_by: "END-9999" }],
      ["fill_done_when", { issue: "END-9999", link: THREAD_A }],
      ["close", { issue: "END-9999", kind: "Closed", text: "Closed · x" }],
    ];
    for (const [name, input] of calls) expect(await call(name, input, w), name).toEqual(W11);
    expect(w.writes()).toHaveLength(0);
  });
});
