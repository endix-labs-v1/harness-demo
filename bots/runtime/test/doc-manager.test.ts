// T8 · Doc manager tools (TEST §2.2 T-DM-1 to T-DM-10). Mocks only, no model, no secret.
// The fixtures the T8 Spec names (base-pages, thread-S2-*, thread-S3-draft-ok, page-twice)
// are built below as constants of the same names. Linear keys are fake END-9xxx keys.
import { describe, expect, it } from "vitest";
import { botDef } from "../src/bots/registry";
import { createBotLogger } from "../src/core/log";
import type { ContextPacket } from "../src/packet/build";
import { makeContext } from "../src/tools/context";
import { callTool, type ToolContext, type ToolDef } from "../src/tools/define";
import { docManagerWriteTools } from "../src/tools/doc-manager/index";
import { fromMarkdown, normalize, toMarkdown } from "../src/tools/doc-manager/richtext";
import { latestCarryOver, latestDraft, ownerOk } from "../src/tools/doc-manager/threads";
import { W13_TEXT, w14Text } from "../src/tools/doc-manager/texts";
import { mockLinear, mockNotion, mockSlack, permalinkFor, testConfig, type MockNotion, type MockSlack } from "./helpers";
import { readSteps } from "../src/packet/build";

// ---------- ids and constants ----------

const DOCS_DS = "c0185c0a-cbc6-49b4-a0da-62ad45fbb27f";
const CALL_LOG_DS = "DS_CALL_LOG";
const HENRY_NOTION = "107d872b-594c-81a7-84f5-0002f77c091c";
const LH = "C0C61PKP10Q";
const OTHER_CHANNEL = "C0C61PKLZT2";
const NOW = () => new Date("2026-10-02T14:03:00+09:00");

const FEE = "3ea8f1ec-11b4-816d-8ada-e5fa98d19815";
const CODE = "3ea8f1ec-11b4-81c7-8725-c73eca244ed3";
const FAQ = "3ea8f1ec-11b4-8149-babf-d4814aec71fd";
const LAUNCH = "3ea8f1ec-11b4-81a0-9000-00000000000a";
const NATSPEC = "3ea8f1ec-11b4-81a0-9000-00000000000b";
const TWICE = "3ea8f1ec-11b4-81a0-9000-00000000000c";
const ROW = "3ea8f1ec-11b4-81a0-9000-00000000000d";

const urlOf = (id: string) => `https://www.notion.so/${id.replace(/-/g, "")}`;
const linearUrl = (key: string, slug: string) => `https://linear.app/endix-labs/issue/${key}/${slug}`;

function umbrella(key: string, title: string, slug: string) {
  return { key, title, state: "In Progress", labels: ["Lightmap"], description: null, url: linearUrl(key, slug), due_date: null, assignee: "Henry", children: [] };
}
const UMBRELLAS = [
  umbrella("END-9512", "F1.2 · Fee model to 25 bps", "fee-model-to-25-bps"),
  umbrella("END-9520", "F2.1 · totalWithFee", "totalwithfee"),
  umbrella("END-9600", "F5.1 · Henry + 서준: fee launch sync", "henry-seojun-fee-launch-sync"),
  umbrella("END-9900", "F1.1 · Demo test page", "demo-test-page"),
];

// ---------- Notion fixtures: base-pages (WORLD §3.1, launch_date 2026-10-23) ----------

const PLAIN = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" };
const t = (content: string) => ({ type: "text", text: { content, link: null }, annotations: { ...PLAIN }, plain_text: content, href: null });
const c = (content: string) => ({ type: "text", text: { content, link: null }, annotations: { ...PLAIN, code: true }, plain_text: content, href: null });

function blk(type: string, rich: any[] | string) {
  const rt = typeof rich === "string" ? [t(rich)] : rich;
  return { object: "block", id: "", type, has_children: false, [type]: { rich_text: rt, color: "default" } };
}

/** Block IDs are the page's ID and the block's position, so every call gives the same IDs. */
function withIds(s: PageSpec): PageSpec {
  s.blocks.forEach((b, i) => (b.id = `${s.id.slice(-4)}-blk-${i}`));
  return s;
}
const h2 = (s: string) => blk("heading_2", s);
const p = (r: any[] | string) => blk("paragraph", r);
const li = (r: any[] | string) => blk("bulleted_list_item", r);
const CREATED = "2026-09-29 · Page created for the demo";

interface PageSpec {
  id: string;
  title: string;
  domain: string;
  type: string;
  status?: string;
  sourcePage?: boolean;
  writtenFrom?: string[];
  feeds?: string[];
  blocks: any[];
}

function notionPage(s: PageSpec, parent = DOCS_DS) {
  const henry = { object: "user", id: HENRY_NOTION, name: "Henry" };
  return {
    object: "page",
    id: s.id,
    url: urlOf(s.id),
    parent: { type: "data_source_id", data_source_id: parent, database_id: "db-docs" },
    in_trash: false,
    properties: {
      Name: { id: "title", type: "title", title: [t(s.title)] },
      Domain: { id: "dom", type: "select", select: { name: s.domain } },
      Type: { id: "typ", type: "select", select: { name: s.type } },
      Status: { id: "sts", type: "status", status: { name: s.status ?? "Current" } },
      Owner: { id: "own", type: "people", people: [henry] },
      "Approved by": { id: "apr", type: "people", people: [henry] },
      "As of": { id: "asof", type: "date", date: { start: "2026-09-29", end: null } },
      "Source page": { id: "src", type: "checkbox", checkbox: !!s.sourcePage },
      Lightmap: { id: "lmp", type: "url", url: null },
      "Written from": { id: "wf", type: "relation", relation: (s.writtenFrom ?? []).map((id) => ({ id })), has_more: false },
      Feeds: { id: "feeds", type: "relation", relation: (s.feeds ?? []).map((id) => ({ id })), has_more: false },
      "Last change": { id: "lc", type: "rich_text", rich_text: [] },
    },
  };
}

function basePageSpecs(): PageSpec[] {
  return ([
    {
      id: FEE,
      title: "Fee model",
      domain: "Product",
      type: "Spec",
      sourcePage: true,
      feeds: [CODE, FAQ, LAUNCH],
      blocks: [
        h2("What it is"),
        p("The fee Endix charges on each trade."),
        h2("The rule"),
        li("The fee is 30 bps (0.30%) of the trade amount."),
        li("The fee is rounded down to the smallest unit."),
        h2("Change log"),
        li(CREATED),
      ],
    },
    {
      id: CODE,
      title: "Code doc · FeeModel",
      domain: "Code",
      type: "Code doc",
      writtenFrom: [FEE],
      blocks: [
        h2("What the code does"),
        p([c("FeeModel.feeOf(amount)"), t(" returns "), c("amount × feeBps / 10,000"), t(", rounded down. "), c("feeBps"), t(" is set once at deployment (30 in the demo).")]),
        h2("Where it lives"),
        p([t("endix-labs/harness-demo · "), c("src/FeeModel.sol")]),
        h2("Change log"),
        li(CREATED),
      ],
    },
    {
      id: FAQ,
      title: "FAQ · Fees",
      domain: "GTM",
      type: "FAQ",
      writtenFrom: [FEE],
      blocks: [h2("How much is the fee?"), p("0.30% of each trade, rounded down to the smallest unit."), h2("Change log"), li(CREATED)],
    },
    {
      id: LAUNCH,
      title: "Launch plan",
      domain: "GTM",
      type: "Plan",
      writtenFrom: [FEE],
      blocks: [h2("When"), p("Public launch on 2026-10-23."), h2("Fees at launch"), p("The fee at launch is the one on the Fee model page."), h2("Change log"), li(CREATED)],
    },
    {
      id: NATSPEC,
      title: "Code Rules · NatSpec",
      domain: "Code",
      type: "Rules",
      sourcePage: true,
      blocks: [
        p("Rules for NatSpec in the demo repo's contracts."),
        h2("Rules"),
        { object: "block", id: "", type: "table", has_children: true, table: { table_width: 4, has_column_header: true, has_row_header: false } },
        h2("Change log"),
        li(CREATED),
      ],
    },
  ] as PageSpec[]).map(withIds);
}

/** page-twice: a Current page holding one sentence twice. */
const TWICE_SENTENCE = "The fee is shown on every trade receipt.";
function pageTwiceSpec(): PageSpec {
  return withIds({
    id: TWICE,
    title: "Demo twice page",
    domain: "Product",
    type: "Spec",
    blocks: [h2("What it is"), p(TWICE_SENTENCE), li(TWICE_SENTENCE), h2("Change log"), li(CREATED)],
  });
}

function callLogRow(linearIssues = "", granola = "https://notes.granola.ai/d/demo-call-0001") {
  return {
    object: "page",
    id: ROW,
    url: urlOf(ROW),
    parent: { type: "data_source_id", data_source_id: CALL_LOG_DS, database_id: "db-call-log" },
    properties: {
      Call: { id: "title", type: "title", title: [t("Henry + 서준: fee launch sync")] },
      Date: { id: "d", type: "date", date: { start: "2026-10-01", end: null } },
      Who: { id: "w", type: "rich_text", rich_text: [t("Henry, 서준")] },
      "Granola note": { id: "g", type: "url", url: granola },
      "Slack thread": { id: "s", type: "url", url: permalinkFor(LH, "1790001000.000100") },
      "Linear issues": { id: "li", type: "rich_text", rich_text: linearIssues ? [t(linearIssues)] : [] },
      "Changed docs": { id: "cd", type: "relation", relation: [], has_more: false },
      Lightmap: { id: "l", type: "url", url: linearUrl("END-9600", "henry-seojun-fee-launch-sync") },
    },
  };
}

const WRITES = ["pages.create", "pages.update", "blocks.update", "blocks.children.append", "blocks.delete", "dataSources.update"];

/** mockNotion() with the pages, their blocks, and the block and page writes this task uses. */
function notionWith(specs: PageSpec[], extra: any[] = []) {
  const n = mockNotion();
  const blocks: Record<string, any[]> = {};
  for (const s of specs) {
    n.fixtures.pages[s.id] = notionPage(s);
    blocks[s.id] = s.blocks;
  }
  for (const e of extra) n.fixtures.pages[e.id] = e;
  n.fixtures.dataSource = { object: "data_source", id: DOCS_DS, properties: { Status: { id: "sts", type: "status" } } };
  const raw = n as any;
  raw.blocks.children.list = async (args: any) => {
    n.calls.push({ method: "blocks.children.list", args });
    return { results: blocks[args.block_id] ?? [], has_more: false, next_cursor: null };
  };
  raw.pages.create = async (args: any) => {
    n.calls.push({ method: "pages.create", args });
    return { object: "page", id: "3ea8f1ec-11b4-81a0-9000-0000000000ff", url: urlOf("3ea8f1ec-11b4-81a0-9000-0000000000ff") };
  };
  raw.pages.update = async (args: any) => {
    n.calls.push({ method: "pages.update", args });
    return { object: "page", id: args.page_id, url: urlOf(args.page_id) };
  };
  return n;
}
const writesOf = (n: MockNotion) => n.calls.filter((x) => WRITES.includes(x.method));

// ---------- Slack thread fixtures ----------

const USERS: Record<string, { name: string; kind: string }> = {
  U_HENRY: { name: "Henry", kind: "person" },
  U_EA: { name: "Entry agent", kind: "bot" },
  U_LH: { name: "Lighthouse", kind: "bot" },
  U_DM: { name: "Doc manager", kind: "bot" },
};

interface RawMsg {
  ts: string;
  user: string;
  text: string;
}

interface ThreadFixture {
  channel: string;
  root: string;
  raw: (RawMsg & { thread_ts: string })[];
  thread: ContextPacket["thread"];
  event: ContextPacket["event"];
  permalinkOf(ts: string): string;
}

/** A thread; its last message is the event (a hand-off mentioning the doc manager). */
function thread(msgs: RawMsg[], channel = LH): ThreadFixture {
  const root = msgs[0].ts;
  const raw = msgs.map((m) => ({ ...m, thread_ts: root }));
  const permalinkOf = (ts: string) => permalinkFor(channel, ts, root);
  const packetThread = msgs.map((m) => ({ ts: m.ts, author: { ...USERS[m.user] }, text: m.text, permalink: permalinkOf(m.ts) }));
  const last = msgs[msgs.length - 1];
  return {
    channel,
    root,
    raw,
    thread: packetThread,
    event: { id: "E11", channel: "demo-lighthouse", ts: last.ts, thread_ts: root, permalink: permalinkOf(last.ts), author: { ...USERS[last.user] }, text: last.text },
    permalinkOf,
  };
}

function draftText(page: string, section: string, now: string, next: string, why: string): string {
  return [`OPS-F1-10 · Draft for ${page}`, `Section: ${section}`, `Now: "${now}"`, `New: "${next}"`, `Why: ${why}`, "<@U_HENRY> please OK or send back."].join("\n");
}

const S2_NOW = "The fee is 30 bps (0.30%) of the trade amount.";
const S2_NEW = "The fee is 25 bps (0.25%) of the trade amount.";
const S2_WHY = "Henry's ask in the thread";
const S2_ROOT: RawMsg = { ts: "1790000000.000100", user: "U_HENRY", text: "Fee model should say 25 bps from now on." };
const S2_LIGHTMAP: RawMsg = { ts: "1790000100.000100", user: "U_LH", text: "END-9512 · F1.2 · Fee model to 25 bps" };
const S2_DRAFT: RawMsg = { ts: "1790000200.000100", user: "U_EA", text: draftText("Fee model", "The rule", S2_NOW, S2_NEW, S2_WHY) };
const S2_HANDOFF = (ts: string): RawMsg => ({ ts, user: "U_EA", text: `<@U_DM> OPS-F1-13 · apply the draft above to Fee model · ${urlOf(FEE)}` });
const HENRY_OK = (ts: string): RawMsg => ({ ts, user: "U_HENRY", text: "OK" });

const threadS2BeforeOk = () => thread([S2_ROOT, S2_LIGHTMAP, S2_DRAFT, S2_HANDOFF("1790000300.000100")]);
const threadS2Ok = () => thread([S2_ROOT, S2_LIGHTMAP, S2_DRAFT, S2_HANDOFF("1790000300.000100"), HENRY_OK("1790000400.000100"), S2_HANDOFF("1790000500.000100")]);
const threadS2EarlyOk = () => thread([S2_ROOT, S2_LIGHTMAP, HENRY_OK("1790000150.000100"), S2_DRAFT, S2_HANDOFF("1790000300.000100")]);
const threadS2BotOk = () => thread([S2_ROOT, S2_LIGHTMAP, S2_DRAFT, { ts: "1790000250.000100", user: "U_EA", text: "OK" }, S2_HANDOFF("1790000300.000100")]);

const S3_NOW = "`feeBps` is set once at deployment (30 in the demo).";
const S3_NEW = "`feeBps` is set once at deployment (30 in the demo). `FeeModel.totalWithFee(amount)` returns `amount + feeOf(amount)`, the fee rounded down the same way.";
const threadS3DraftOk = () =>
  thread([
    { ts: "1790002000.000100", user: "U_HENRY", text: "Add totalWithFee to FeeModel." },
    { ts: "1790002100.000100", user: "U_EA", text: "OPS-F2-12 · Code doc · FeeModel: What the code does gains totalWithFee" },
    { ts: "1790002200.000100", user: "U_EA", text: draftText("Code doc · FeeModel", "What the code does", S3_NOW, S3_NEW, "totalWithFee is merged (END-9520)") },
    HENRY_OK("1790002300.000100"),
    { ts: "1790002400.000100", user: "U_EA", text: `<@U_DM> OPS-F2-13 · apply the draft above to Code doc · FeeModel · ${urlOf(CODE)}` },
  ]);

/** A draft with the given Now line, then Henry's OK, then the hand-off (T-DM-7). */
const threadDraftOk = (now: string, next: string, page: string) =>
  thread([
    { ts: "1790003000.000100", user: "U_HENRY", text: `Change ${page}.` },
    { ts: "1790003100.000100", user: "U_EA", text: draftText(page, "What it is", now, next, "Henry's ask in the thread") },
    HENRY_OK("1790003200.000100"),
    { ts: "1790003300.000100", user: "U_EA", text: `<@U_DM> OPS-F1-13 · apply the draft above to ${page}` },
  ]);

// ---------- context ----------

function packetFor(th: ThreadFixture | null): ContextPacket {
  const event: ContextPacket["event"] = th?.event ?? {
    id: "E11",
    channel: "demo-lighthouse",
    ts: "1790009000.000100",
    thread_ts: null,
    permalink: permalinkFor(LH, "1790009000.000100"),
    author: { name: "Lighthouse", kind: "bot" },
    text: "<@U_DM> hand-off",
  };
  return {
    bot: "doc-manager",
    now: "2026-10-02T14:03:00+09:00",
    event,
    thread: th?.thread ?? [],
    umbrellas: [...UMBRELLAS, { key: "END-9901", error: "not found" as const }],
    people: { Henry: { slack: "U_HENRY" } },
    steps: readSteps(),
  };
}

function ctxFor(opts: { notion: MockNotion; thread?: ThreadFixture | null; slack?: MockSlack; dryRun?: boolean }): ToolContext {
  const slack = opts.slack ?? mockSlack();
  if (opts.thread) (slack as any).fixtures.replies[opts.thread.root] = opts.thread.raw;
  return makeContext(botDef("doc-manager"), packetFor(opts.thread ?? null), {
    dryRun: opts.dryRun ?? false,
    runId: "doc-manager-test",
    secrets: {},
    config: testConfig(),
    log: createBotLogger("doc-manager"),
    overrides: { slack, notion: opts.notion, linear: mockLinear(), now: NOW },
  });
}

const tool = (name: string): ToolDef<any> => {
  const found = docManagerWriteTools.find((x) => x.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};

async function call(name: string, input: unknown, ctx: ToolContext): Promise<any> {
  const r = await callTool(tool(name), input, ctx);
  return JSON.parse(JSON.stringify(r.value));
}

const simple = (children: any[]) => children.map((b) => ({ type: b.type, rt: normalize(b[b.type].rich_text) }));

// ---------- tests ----------

describe("doc manager · shared parts", () => {
  it("index exports the nine tools in SYS §5.4 order", () => {
    expect(docManagerWriteTools.map((x) => x.name)).toEqual([
      "create_page",
      "replace_text",
      "add_change_log_line",
      "add_checked_against",
      "set_fields",
      "list_feeds",
      "call_log_create",
      "call_log_update",
      "post_reply",
    ]);
  });

  it("base pages read as WORLD §3.1's text, and fromMarkdown(toMarkdown(x)) equals x for every block", () => {
    const md = (s: PageSpec) =>
      s.blocks
        .filter((b) => b.type !== "table")
        .map((b) => {
          const m = toMarkdown(b[b.type].rich_text);
          return b.type === "heading_2" ? `## ${m}` : b.type === "bulleted_list_item" ? `- ${m}` : m;
        })
        .join("\n");
    const [fee, code, faq, launch] = basePageSpecs();
    expect(md(fee)).toBe(
      "## What it is\nThe fee Endix charges on each trade.\n## The rule\n- The fee is 30 bps (0.30%) of the trade amount.\n- The fee is rounded down to the smallest unit.\n## Change log\n- 2026-09-29 · Page created for the demo",
    );
    expect(md(code)).toBe(
      "## What the code does\n`FeeModel.feeOf(amount)` returns `amount × feeBps / 10,000`, rounded down. `feeBps` is set once at deployment (30 in the demo).\n## Where it lives\nendix-labs/harness-demo · `src/FeeModel.sol`\n## Change log\n- 2026-09-29 · Page created for the demo",
    );
    expect(md(faq)).toBe("## How much is the fee?\n0.30% of each trade, rounded down to the smallest unit.\n## Change log\n- 2026-09-29 · Page created for the demo");
    expect(md(launch)).toBe(
      "## When\nPublic launch on 2026-10-23.\n## Fees at launch\nThe fee at launch is the one on the Fee model page.\n## Change log\n- 2026-09-29 · Page created for the demo",
    );
    for (const s of basePageSpecs())
      for (const b of s.blocks) {
        if (b.type === "table") continue;
        expect(normalize(fromMarkdown(toMarkdown(b[b.type].rich_text)))).toEqual(normalize(b[b.type].rich_text));
      }
    const mixed = [t("a "), { ...t("b"), annotations: { ...PLAIN, bold: true } }, t(" "), { ...t("i"), annotations: { ...PLAIN, italic: true } }, t(" "), { type: "text", text: { content: "l", link: { url: "https://x.y/z" } }, annotations: { ...PLAIN } }];
    expect(toMarkdown(mixed)).toBe("a **b** *i* [l](https://x.y/z)");
    expect(normalize(fromMarkdown(toMarkdown(mixed)))).toEqual(normalize(mixed));
  });

  it("threads: latestDraft, ownerOk and latestCarryOver read the DICT §2 shapes", () => {
    const d = latestDraft(threadS2Ok().thread)!;
    expect(d).toMatchObject({ page: "Fee model", section: "The rule", now: S2_NOW, new: S2_NEW, why: "Henry's ask in the thread" });
    expect(latestDraft(threadS3DraftOk().thread)).toMatchObject({ page: "Code doc · FeeModel", now: S3_NOW, new: S3_NEW });
    expect(ownerOk(threadS2Ok().thread, "Henry", d.ts)?.ts).toBe("1790000400.000100");
    expect(ownerOk(threadS2BeforeOk().thread, "Henry", d.ts)).toBeNull();
    expect(ownerOk(threadS2EarlyOk().thread, "Henry", latestDraft(threadS2EarlyOk().thread)!.ts)).toBeNull();
    expect(ownerOk(threadS2BotOk().thread, "Henry", d.ts)).toBeNull();
    const carry = thread([
      S2_ROOT,
      {
        ts: "1790000900.000100",
        user: "U_EA",
        text: [
          "OPS-F0-41 · Carry-over for Fee model (END-9512):",
          "Code doc · FeeModel · changes · What the code does: says 30 in the demo · <@U_HENRY>",
          "FAQ · Fees · changes · How much is the fee?: says 0.30% · <@U_HENRY>",
          "Launch plan · no change · it points to the Fee model page and states no number",
          "<@U_LH> OPS-F0-42 · open the follow-ups",
          "<@U_DM> OPS-F0-43 · add the Checked-against lines",
        ].join("\n"),
      },
    ]);
    const co = latestCarryOver(carry.thread)!;
    expect(co.page).toBe("Fee model");
    expect(co.key).toBe("END-9512");
    expect(co.changes.map((x) => [x.page, x.section, x.why])).toEqual([
      ["Code doc · FeeModel", "What the code does", "says 30 in the demo"],
      ["FAQ · Fees", "How much is the fee?", "says 0.30%"],
    ]);
    expect(co.noChange).toEqual([{ page: "Launch plan", why: "it points to the Fee model page and states no number" }]);
  });
});

describe("doc manager · create_page and set_fields (W-13)", () => {
  const T1_INPUT = {
    title: "Demo test page",
    domain: "Product",
    type: "Spec",
    lightmap_key: "END-9900",
    written_from: [FEE],
    sections: [{ heading: "What it is", text: "Line one.\n- A bullet with `code`." }],
  };

  it("T-DM-1: create_page makes one Draft page with Owner Henry, As of today, Lightmap, Written from and the sections", async () => {
    const n = notionWith(basePageSpecs());
    const r = await call("create_page", T1_INPUT, ctxFor({ notion: n }));
    expect(r.refused).toBeUndefined();
    const w = writesOf(n);
    expect(w).toHaveLength(1);
    expect(w[0].method).toBe("pages.create");
    const a = w[0].args;
    expect(a.parent).toEqual({ type: "data_source_id", data_source_id: DOCS_DS });
    expect(a.properties.Name.title[0].text.content).toBe("Demo test page");
    expect(a.properties.Domain).toEqual({ select: { name: "Product" } });
    expect(a.properties.Type).toEqual({ select: { name: "Spec" } });
    expect(a.properties.Status).toEqual({ status: { name: "Draft" } });
    expect(a.properties.Owner).toEqual({ people: [{ id: HENRY_NOTION }] });
    expect(a.properties["As of"]).toEqual({ date: { start: "2026-10-02" } });
    expect(a.properties.Lightmap).toEqual({ url: "https://linear.app/endix-labs/issue/END-9900/demo-test-page" });
    expect(a.properties["Written from"]).toEqual({ relation: [{ id: FEE }] });
    expect(a.properties["Source page"]).toEqual({ checkbox: false });
    expect(a.properties["Approved by"]).toBeUndefined();
    expect(simple(a.children)).toEqual([
      { type: "heading_2", rt: [{ content: "What it is" }] },
      { type: "paragraph", rt: [{ content: "Line one." }] },
      { type: "bulleted_list_item", rt: [{ content: "A bullet with " }, { content: "code", code: true }, { content: "." }] },
      { type: "heading_2", rt: [{ content: "Change log" }] },
    ]);
    expect(r.title).toBe("Demo test page");
  });

  it("T-DM-1: create_page reads the Status type from the data source (select)", async () => {
    const n = notionWith(basePageSpecs());
    n.fixtures.dataSource = { properties: { Status: { type: "select" } } };
    await call("create_page", { ...T1_INPUT, written_from: [] }, ctxFor({ notion: n }));
    const a = writesOf(n)[0].args;
    expect(a.properties.Status).toEqual({ select: { name: "Draft" } });
    expect(a.properties["Source page"]).toEqual({ checkbox: true });
  });

  it("T-DM-1: a lightmap_key not in the packet's umbrellas is an input error; no create", async () => {
    const n = notionWith(basePageSpecs());
    const r = await call("create_page", { ...T1_INPUT, lightmap_key: "END-9901" }, ctxFor({ notion: n }));
    expect(r).toEqual({ error: "END-9901 is not an umbrella of this thread; name it in the hand-off." });
    const r2 = await call("create_page", { ...T1_INPUT, lightmap_key: "END-9902" }, ctxFor({ notion: n }));
    expect(r2).toEqual({ error: "END-9902 is not an umbrella of this thread; name it in the hand-off." });
    expect(writesOf(n)).toHaveLength(0);
  });

  it("T-DM-2: create_page with a Call log input is refused (OPS-F5-01); no create", async () => {
    const n = notionWith(basePageSpecs());
    const msg = "Call log rows are made by call_log_create (OPS-F5-01); create_page writes Demo · Endix Docs pages only.";
    const a = await call("create_page", { ...T1_INPUT, granola_url: "https://notes.granola.ai/d/x" }, ctxFor({ notion: n }));
    expect(a).toEqual({ refused: true, rule: "OPS-F5-01", message: msg });
    const b = await call("create_page", { ...T1_INPUT, type: "Call log" }, ctxFor({ notion: n }));
    expect(b).toEqual({ refused: true, rule: "OPS-F5-01", message: msg });
    const c2 = await call("create_page", { ...T1_INPUT, type: "Memo" }, ctxFor({ notion: n }));
    expect(c2.error).toMatch(/^input: type must be one of/);
    expect(writesOf(n)).toHaveLength(0);
  });

  it("T-DM-3: create_page with Status or Approved by is refused with the W-13 text; no create", async () => {
    const n = notionWith(basePageSpecs());
    for (const extra of [{ status: "Current" }, { Status: "Current" }, { approved_by: ["henry"] }]) {
      const r = await call("create_page", { ...T1_INPUT, ...extra }, ctxFor({ notion: n }));
      expect(r).toEqual({ refused: true, wall: "W-13", message: W13_TEXT });
    }
    expect(W13_TEXT).toBe("Refused by the harness (W-13, OPS-F1-26): only Henry or 서준 set Status to Current or Retired, or fill Approved by.");
    expect(writesOf(n)).toHaveLength(0);
  });

  it("T-DM-4: set_fields with Status, Approved by or Owner is refused with the W-13 text; no update", async () => {
    const n = notionWith(basePageSpecs());
    for (const extra of [{ status: "Current" }, { "Approved by": ["henry"] }, { owner: "henry" }]) {
      const r = await call("set_fields", { page: FEE, ...extra }, ctxFor({ notion: n }));
      expect(r).toEqual({ refused: true, wall: "W-13", message: W13_TEXT });
    }
    expect(writesOf(n)).toHaveLength(0);
  });

  it("set_fields lightmap: one pages.update of Lightmap only; a key not in the packet is an input error", async () => {
    const n = notionWith(basePageSpecs());
    await call("set_fields", { page: urlOf(FEE), lightmap_key: "END-9900" }, ctxFor({ notion: n }));
    const w = writesOf(n);
    expect(w).toHaveLength(1);
    expect(w[0]).toEqual({ method: "pages.update", args: { page_id: FEE, properties: { Lightmap: { url: "https://linear.app/endix-labs/issue/END-9900/demo-test-page" } } } });
    const r = await call("set_fields", { page: FEE, lightmap_key: "END-9901" }, ctxFor({ notion: n }));
    expect(r).toEqual({ error: "END-9901 is not an umbrella of this thread; name it in the hand-off." });
    expect(writesOf(n)).toHaveLength(1);
  });

  it("set_fields written_from replaces the relation and ticks Source page only when empty", async () => {
    const n = notionWith(basePageSpecs());
    await call("set_fields", { page: LAUNCH, written_from: [FEE, FAQ] }, ctxFor({ notion: n }));
    await call("set_fields", { page: LAUNCH, written_from: [] }, ctxFor({ notion: n }));
    const w = writesOf(n);
    expect(w[0].args.properties).toEqual({ "Written from": { relation: [{ id: FEE }, { id: FAQ }] }, "Source page": { checkbox: false } });
    expect(w[1].args.properties).toEqual({ "Written from": { relation: [] }, "Source page": { checkbox: true } });
  });
});

describe("doc manager · replace_text (W-14, OPS-F1-35)", () => {
  const W14_FEE = "Refused by the harness (W-14, OPS-F1-28): Fee model is Current; it changes only after its Owner, Henry, posts OK in the thread.";

  it("T-DM-5: on a Current page with no OK, an OK before the draft, or a bot's OK: the W-14 text; no update", async () => {
    expect(w14Text("Fee model", "Henry")).toBe(W14_FEE);
    const input = { page: urlOf(FEE), old: S2_NOW, new: S2_NEW };

    const n1 = notionWith(basePageSpecs());
    const r1 = await call("replace_text", input, ctxFor({ notion: n1, thread: threadS2BeforeOk() }));
    expect(r1).toEqual({ refused: true, wall: "W-14", message: W14_FEE });
    expect(writesOf(n1)).toHaveLength(0);

    const early = threadS2EarlyOk();
    const n2 = notionWith(basePageSpecs());
    const r2 = await call("replace_text", { ...input, ok_permalink: early.permalinkOf("1790000150.000100") }, ctxFor({ notion: n2, thread: early }));
    expect(r2).toEqual({ refused: true, wall: "W-14", message: W14_FEE });
    expect(writesOf(n2)).toHaveLength(0);

    const bot = threadS2BotOk();
    const n3 = notionWith(basePageSpecs());
    const r3 = await call("replace_text", { ...input, ok_permalink: bot.permalinkOf("1790000250.000100") }, ctxFor({ notion: n3, thread: bot }));
    expect(r3).toEqual({ refused: true, wall: "W-14", message: W14_FEE });
    expect(writesOf(n3)).toHaveLength(0);
  });

  it("T-DM-5: Henry's OK in another thread, or a permalink to the draft itself, is refused too", async () => {
    const input = { page: FEE, old: S2_NOW, new: S2_NEW };
    const th = threadS2Ok();
    const slack = mockSlack();
    const other = thread([{ ts: "1790000600.000100", user: "U_HENRY", text: "Something else" }, HENRY_OK("1790000700.000100")]);
    (slack as any).fixtures.replies[other.root] = other.raw;
    const n = notionWith(basePageSpecs());
    const r = await call("replace_text", { ...input, ok_permalink: other.permalinkOf("1790000700.000100") }, ctxFor({ notion: n, thread: th, slack }));
    expect(r.wall).toBe("W-14");
    const r2 = await call("replace_text", { ...input, ok_permalink: th.permalinkOf(S2_DRAFT.ts) }, ctxFor({ notion: n, thread: th }));
    expect(r2.wall).toBe("W-14");
    expect(writesOf(n)).toHaveLength(0);
  });

  it("T-DM-6: with Henry's OK after the draft: one blocks.update of the bullet, nothing else", async () => {
    const th = threadS2Ok();
    const n = notionWith(basePageSpecs());
    const r = await call("replace_text", { page: urlOf(FEE), old: S2_NOW, new: S2_NEW, ok_permalink: th.permalinkOf("1790000400.000100") }, ctxFor({ notion: n, thread: th }));
    const bulletId = basePageSpecs()[0].blocks[3].id;
    expect(r).toEqual({ page: FEE, url: urlOf(FEE), title: "Fee model", block: bulletId });
    const w = writesOf(n);
    expect(w).toHaveLength(1);
    expect(w[0].method).toBe("blocks.update");
    expect(w[0].args.block_id).toBe(bulletId);
    expect(Object.keys(w[0].args).sort()).toEqual(["block_id", "bulleted_list_item"]);
    expect(normalize(w[0].args.bulleted_list_item.rich_text)).toEqual([{ content: "The fee is 25 bps (0.25%) of the trade amount." }]);
  });

  it("T-DM-6: the S3 draft on Code doc · FeeModel keeps and adds the code spans", async () => {
    const th = threadS3DraftOk();
    const n = notionWith(basePageSpecs());
    const r = await call("replace_text", { page: CODE, old: S3_NOW, new: S3_NEW, ok_permalink: th.permalinkOf("1790002300.000100") }, ctxFor({ notion: n, thread: th }));
    expect(r.title).toBe("Code doc · FeeModel");
    const w = writesOf(n);
    expect(w).toHaveLength(1);
    expect(w[0].args.block_id).toBe(basePageSpecs()[1].blocks[1].id);
    expect(normalize(w[0].args.paragraph.rich_text)).toEqual([
      { content: "FeeModel.feeOf(amount)", code: true },
      { content: " returns " },
      { content: "amount × feeBps / 10,000", code: true },
      { content: ", rounded down. " },
      { content: "feeBps", code: true },
      { content: " is set once at deployment (30 in the demo). " },
      { content: "FeeModel.totalWithFee(amount)", code: true },
      { content: " returns " },
      { content: "amount + feeOf(amount)", code: true },
      { content: ", the fee rounded down the same way." },
    ]);
  });

  it("T-DM-6: a new that differs from the draft's New by one character: the word-for-word refusal", async () => {
    const th = threadS2Ok();
    const n = notionWith(basePageSpecs());
    const r = await call(
      "replace_text",
      { page: FEE, old: S2_NOW, new: "The fee is 25 bps (0.25%) of the trade amount!", ok_permalink: th.permalinkOf("1790000400.000100") },
      ctxFor({ notion: n, thread: th }),
    );
    expect(r).toEqual({ refused: true, rule: "OPS-F1-35", message: "old and new must be the Now and New lines of the latest draft in this thread, word for word (OPS-F1-35)." });
    expect(writesOf(n)).toHaveLength(0);
  });

  it("T-DM-7: old found 0 times or 2 times is refused, 'must occur exactly once'; no update", async () => {
    const zeroOld = "The fee is 40 bps (0.40%) of the trade amount.";
    const th0 = threadDraftOk(zeroOld, S2_NEW, "Fee model");
    const n0 = notionWith(basePageSpecs());
    const r0 = await call("replace_text", { page: FEE, old: zeroOld, new: S2_NEW, ok_permalink: th0.permalinkOf("1790003200.000100") }, ctxFor({ notion: n0, thread: th0 }));
    expect(r0.rule).toBe("OPS-F1-35");
    expect(r0.message).toContain("must occur exactly once");
    expect(r0.message).toBe("the text to replace must occur exactly once on Fee model; it occurs 0 times (OPS-F1-35).");
    expect(writesOf(n0)).toHaveLength(0);

    const th2 = threadDraftOk(TWICE_SENTENCE, "The fee is shown on the receipt.", "Demo twice page");
    const n2 = notionWith([...basePageSpecs(), pageTwiceSpec()]);
    const r2 = await call("replace_text", { page: TWICE, old: TWICE_SENTENCE, new: "The fee is shown on the receipt.", ok_permalink: th2.permalinkOf("1790003200.000100") }, ctxFor({ notion: n2, thread: th2 }));
    expect(r2.message).toContain("must occur exactly once");
    expect(r2.message).toContain("it occurs 2 times");
    expect(writesOf(n2)).toHaveLength(0);
  });

  it("replace_text: Retired is refused first; text outside the editable blocks is not edited; dry run writes nothing", async () => {
    const retired = basePageSpecs().map((s) => (s.id === FEE ? { ...s, status: "Retired" } : s));
    const th = threadS2Ok();
    const nR = notionWith(retired);
    const rR = await call("replace_text", { page: FEE, old: S2_NOW, new: S2_NEW }, ctxFor({ notion: nR, thread: th }));
    expect(rR).toEqual({ refused: true, rule: "OPS-F1-09", message: "Fee model is Retired; it doesn't change." });

    const callout = basePageSpecs().map((s) => (s.id === FEE ? withIds({ ...s, blocks: s.blocks.map((b, i) => (i === 3 ? blk("callout", S2_NOW) : b)) }) : s));
    const nC = notionWith(callout);
    const rC = await call("replace_text", { page: FEE, old: S2_NOW, new: S2_NEW, ok_permalink: th.permalinkOf("1790000400.000100") }, ctxFor({ notion: nC, thread: th }));
    expect(rC).toEqual({ refused: true, rule: "OPS-F1-35", message: "the text to replace sits in a callout block, which this tool doesn't edit." });
    const struck = basePageSpecs().map((s) =>
      s.id === FEE ? withIds({ ...s, blocks: s.blocks.map((b, i) => (i === 3 ? li([{ ...t(S2_NOW), annotations: { ...PLAIN, strikethrough: true } }]) : b)) }) : s,
    );
    const nS = notionWith(struck);
    const rS = await call("replace_text", { page: FEE, old: S2_NOW, new: S2_NEW, ok_permalink: th.permalinkOf("1790000400.000100") }, ctxFor({ notion: nS, thread: th }));
    expect(rS.message).toBe("the text to replace sits in a bulleted_list_item block, which this tool doesn't edit.");
    expect(writesOf(nC)).toHaveLength(0);
    expect(writesOf(nS)).toHaveLength(0);

    const nD = notionWith(basePageSpecs());
    const rD = await call("replace_text", { page: FEE, old: S2_NOW, new: S2_NEW, ok_permalink: th.permalinkOf("1790000400.000100") }, ctxFor({ notion: nD, thread: th, dryRun: true }));
    expect(rD.dry_run).toBe(true);
    expect(writesOf(nD)).toHaveLength(0);
  });
});

describe("doc manager · change log lines and feeds", () => {
  it("T-DM-8: add_change_log_line appends the SYS §6.4 line at the page end and sets As of and Last change", async () => {
    const n = notionWith(basePageSpecs());
    const r = await call(
      "add_change_log_line",
      { page: FEE, what: "Fee changed from 30 bps (0.30%) to 25 bps (0.25%)", why: "Henry's ask in the thread", umbrella_key: "END-9512" },
      ctxFor({ notion: n, thread: threadS2Ok() }),
    );
    const line = "2026-10-02 · Fee changed from 30 bps (0.30%) to 25 bps (0.25%) · Henry's ask in the thread · END-9512";
    expect(r).toEqual({ page: FEE, url: urlOf(FEE), line });
    const w = writesOf(n);
    expect(w.map((x) => x.method)).toEqual(["blocks.children.append", "pages.update"]);
    expect(Object.keys(w[0].args).sort()).toEqual(["block_id", "children"]);
    expect(w[0].args.block_id).toBe(FEE);
    expect(simple(w[0].args.children)).toEqual([{ type: "bulleted_list_item", rt: [{ content: line }] }]);
    const lastBlock = basePageSpecs()[0].blocks.at(-1);
    expect(toMarkdown(lastBlock[lastBlock.type].rich_text)).toBe("2026-09-29 · Page created for the demo");
    expect(w[1].args).toEqual({ page_id: FEE, properties: { "As of": { date: { start: "2026-10-02" } }, "Last change": { rich_text: [{ type: "text", text: { content: line } }] } } });
  });

  it("T-DM-8: add_checked_against appends the Checked-against line; no pages.update", async () => {
    const n = notionWith(basePageSpecs());
    const r = await call(
      "add_checked_against",
      { page: LAUNCH, changed_page: FEE, origin_key: "END-9512", why: "it points to the Fee model page and states no number" },
      ctxFor({ notion: n }),
    );
    const line = "2026-10-02 · Checked against Fee model (END-9512): no change, it points to the Fee model page and states no number";
    expect(r).toEqual({ page: LAUNCH, url: urlOf(LAUNCH), line });
    const w = writesOf(n);
    expect(w).toHaveLength(1);
    expect(w[0].method).toBe("blocks.children.append");
    expect(w[0].args.block_id).toBe(LAUNCH);
    expect(simple(w[0].args.children)).toEqual([{ type: "bulleted_list_item", rt: [{ content: line }] }]);
  });

  it("add_change_log_line: a Draft page is refused (OPS-F1-30); a page with no Change log at its end is refused (OPS-F1-13)", async () => {
    const specs = basePageSpecs().map((s) => (s.id === FEE ? { ...s, status: "Draft" } : s.id === FAQ ? { ...s, blocks: s.blocks.slice(0, 2) } : s));
    const n = notionWith(specs);
    const a = await call("add_change_log_line", { page: FEE, what: "x", why: "y", umbrella_key: "END-9512" }, ctxFor({ notion: n }));
    expect(a).toEqual({ refused: true, rule: "OPS-F1-30", message: "Fee model is Draft; its changes live in the thread until it is Current (OPS-F1-30)." });
    const b = await call("add_change_log_line", { page: FAQ, what: "x", why: "y", umbrella_key: "END-9512" }, ctxFor({ notion: n }));
    expect(b).toEqual({ refused: true, rule: "OPS-F1-13", message: "FAQ · Fees has no Change log section at its end." });
    expect(writesOf(n)).toHaveLength(0);
  });

  it("T-DM-9: list_feeds on Fee model at base: Code doc · FeeModel, FAQ · Fees, Launch plan", async () => {
    const n = notionWith(basePageSpecs());
    const r = await call("list_feeds", { page: FEE }, ctxFor({ notion: n }));
    expect(r).toEqual({
      page: FEE,
      feeds: [
        { page: CODE, title: "Code doc · FeeModel", status: "Current", owners: ["Henry"], url: urlOf(CODE) },
        { page: FAQ, title: "FAQ · Fees", status: "Current", owners: ["Henry"], url: urlOf(FAQ) },
        { page: LAUNCH, title: "Launch plan", status: "Current", owners: ["Henry"], url: urlOf(LAUNCH) },
      ],
    });
    expect(writesOf(n)).toHaveLength(0);
  });

  it("list_feeds pages through a Feeds relation of more than 25", async () => {
    const n = notionWith(basePageSpecs());
    const fee = n.fixtures.pages[FEE];
    fee.properties.Feeds.has_more = true;
    const raw = n as any;
    raw.pages.properties = {
      async retrieve(args: any) {
        n.calls.push({ method: "pages.properties.retrieve", args });
        if (!args.start_cursor) return { results: [{ type: "relation", relation: { id: CODE } }, { type: "relation", relation: { id: FAQ } }], has_more: true, next_cursor: "c2" };
        return { results: [{ type: "relation", relation: { id: LAUNCH } }], has_more: false, next_cursor: null };
      },
    };
    const r = await call("list_feeds", { page: FEE }, ctxFor({ notion: n }));
    expect(r.feeds.map((f: any) => f.title)).toEqual(["Code doc · FeeModel", "FAQ · Fees", "Launch plan"]);
  });
});

describe("doc manager · Call log and post_reply", () => {
  const S4 = {
    call: "Henry + 서준: fee launch sync",
    date: "2026-10-01",
    who: "Henry, 서준",
    granola_url: "https://notes.granola.ai/d/demo-call-0001",
    thread_permalink: permalinkFor(LH, "1790001000.000100"),
    lightmap_key: "END-9600",
  };

  it("T-DM-10: call_log_create makes one row with the six fields and no body; again: existing; a bad date: input error", async () => {
    const n = notionWith(basePageSpecs());
    const r = await call("call_log_create", S4, ctxFor({ notion: n }));
    expect(r.existing).toBe(false);
    let w = writesOf(n);
    expect(w).toHaveLength(1);
    expect(w[0].method).toBe("pages.create");
    expect(w[0].args.parent).toEqual({ type: "data_source_id", data_source_id: CALL_LOG_DS });
    expect(w[0].args.children).toBeUndefined();
    const props = w[0].args.properties;
    expect(Object.keys(props).sort()).toEqual(["Call", "Date", "Granola note", "Lightmap", "Slack thread", "Who"]);
    expect(props.Call.title[0].text.content).toBe("Henry + 서준: fee launch sync");
    expect(props.Date).toEqual({ date: { start: "2026-10-01" } });
    expect(props.Who.rich_text[0].text.content).toBe("Henry, 서준");
    expect(props["Granola note"]).toEqual({ url: S4.granola_url });
    expect(props["Slack thread"]).toEqual({ url: S4.thread_permalink });
    expect(props.Lightmap).toEqual({ url: "https://linear.app/endix-labs/issue/END-9600/henry-seojun-fee-launch-sync" });

    n.fixtures.query = [callLogRow()];
    const again = await call("call_log_create", S4, ctxFor({ notion: n }));
    expect(again).toEqual({ row: ROW, url: urlOf(ROW), existing: true });
    const bad = await call("call_log_create", { ...S4, date: "2026/10/01" }, ctxFor({ notion: n }));
    expect(bad.error).toMatch(/^input: /);
    const body = await call("call_log_create", { ...S4, summary: "what we said" }, ctxFor({ notion: n }));
    expect(body).toEqual({ refused: true, rule: "OPS-F5-09", message: "a Call log row holds links only, no body (OPS-F5-09)." });
    w = writesOf(n);
    expect(w).toHaveLength(1);
  });

  it("T-DM-10: call_log_update refuses a body and adds keys and thread links in order", async () => {
    const n = notionWith(basePageSpecs(), [callLogRow()]);
    const refusedBody = await call("call_log_update", { row: ROW, body: "summary" }, ctxFor({ notion: n }));
    expect(refusedBody).toEqual({ refused: true, rule: "OPS-F5-09", message: "a Call log row holds links only, no body (OPS-F5-09)." });
    expect(writesOf(n)).toHaveLength(0);
    const p1 = permalinkFor(OTHER_CHANNEL, "1790001500.000100");
    const p2 = permalinkFor("C0C55EFGY5C", "1790001600.000100");
    const r = await call("call_log_update", { row: urlOf(ROW), linear_issues_add: ["END-9601", "END-9602", p1, p2] }, ctxFor({ notion: n }));
    expect(r.linear_issues).toBe(`END-9601, END-9602, ${p1}, ${p2}`);
    const w = writesOf(n);
    expect(w).toHaveLength(1);
    expect(w[0].args).toEqual({ page_id: ROW, properties: { "Linear issues": { rich_text: [{ type: "text", text: { content: `END-9601, END-9602, ${p1}, ${p2}` } }] } } });
    const n2 = notionWith(basePageSpecs(), [callLogRow("END-9601")]);
    const r2 = await call("call_log_update", { row: ROW, linear_issues_add: ["END-9601", "END-9602"] }, ctxFor({ notion: n2 }));
    expect(r2.linear_issues).toBe("END-9601, END-9602");
    const notRow = await call("call_log_update", { row: FEE, linear_issues_add: ["END-9601"] }, ctxFor({ notion: n2 }));
    expect(notRow.error).toMatch(/^input: /);
  });

  it("post_reply: replies in the #demo-lighthouse thread; another channel is an input error; a person line is refused (W-12)", async () => {
    const slack = mockSlack();
    const n = notionWith(basePageSpecs());
    const th = threadS2Ok();
    const ctx = ctxFor({ notion: n, thread: th, slack });
    const r = await call("post_reply", { thread: th.event.permalink, text: `OPS-F1-13 · done: Fee model · ${urlOf(FEE)}` }, ctx);
    expect(r.ts).toBeTruthy();
    const posts = (slack as any).calls.filter((x: any) => x.method === "chat.postMessage");
    expect(posts).toHaveLength(1);
    expect(posts[0].args.channel).toBe(LH);
    expect(posts[0].args.thread_ts).toBe(th.root);
    const other = await call("post_reply", { thread: permalinkFor(OTHER_CHANNEL, "1790000000.000100"), text: "hello" }, ctx);
    expect(other.error).toMatch(/^input: /);
    const ok = await call("post_reply", { thread: th.event.permalink, text: "OK" }, ctx);
    expect(ok.wall).toBe("W-12");
    expect((slack as any).calls.filter((x: any) => x.method === "chat.postMessage")).toHaveLength(1);
  });
});
