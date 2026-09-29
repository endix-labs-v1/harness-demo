// The `expect` keys of an E-LH case (T6 Spec Req 22), checked against one run's tool calls.
// Pure: no model, no I/O, so the unit tests can check it offline.
import { NO_FLOW } from "../../src/tools/lighthouse/texts";

export interface Call {
  name: string;
  input: any;
  result: any;
}

export interface OpenExpect {
  variant: string;
  title_prefix?: string;
  title_words?: string[];
  steps?: string[];
  steps_include?: string[];
  steps_exclude?: string[];
  when?: Record<string, string>;
  rule_id?: string;
  source?: string;
  origin_key?: boolean | string;
}

export interface Expect {
  open?: OpenExpect | OpenExpect[];
  move?: "questions" | "ideas" | Array<"questions" | "ideas">;
  no_flow?: boolean;
  ask_back?: string;
  ask_back_words?: string[];
  items?: { n: number; who: string }[];
  items_count?: number;
  split?: { n: number; line_pattern?: string };
  post_ask_prefix?: string;
  post_asks?: number;
  followups?: number;
  mentions?: { bot: string; step_id: string }[];
  mention_contains?: { step_id: string; text: string }[];
  refused_wall?: string;
  reply_starts?: string;
  reply_contains?: string;
  no_open?: boolean;
  any_of?: Expect[];
}

const ok = (c: Call) => !!c.result && typeof c.result === "object" && c.result.refused !== true && c.result.error === undefined;
const calls = (cs: Call[], name: string) => cs.filter((c) => c.name === name && ok(c));
const words = (text: string, ws: string[]) => ws.filter((w) => !text.toLowerCase().includes(w.toLowerCase()));
const F7_ASK_BACK = /^Before I open anything: .+: by when, or after what\?$/s;

function openMatches(c: Call, o: OpenExpect): string | null {
  const i = c.input ?? {};
  if (i.variant !== o.variant) return `variant ${i.variant}`;
  const title = `${i.variant} · ${i.ask}`;
  if (o.title_prefix && !title.startsWith(o.title_prefix)) return `title "${title}" lacks prefix "${o.title_prefix}"`;
  const missingWords = words(String(i.ask ?? ""), o.title_words ?? []);
  if (missingWords.length) return `title "${title}" lacks ${missingWords.join(", ")}`;
  const steps: string[] = i.lightmap?.steps ?? [];
  if (o.steps && JSON.stringify(steps) !== JSON.stringify(o.steps)) return `steps ${steps.join(",")}`;
  for (const s of o.steps_include ?? []) if (!steps.includes(s)) return `steps lack ${s}`;
  for (const s of o.steps_exclude ?? []) if (steps.includes(s)) return `steps hold ${s}`;
  for (const [k, v] of Object.entries(o.when ?? {})) if (i.when?.[k] !== v) return `when.${k} ${i.when?.[k]}`;
  if (o.rule_id && i.rule_id !== o.rule_id) return `rule_id ${i.rule_id}`;
  if (o.source && i.source !== o.source) return `source ${i.source}`;
  if (o.origin_key === true && !i.origin_key) return "no origin_key";
  if (typeof o.origin_key === "string" && i.origin_key !== o.origin_key) return `origin_key ${i.origin_key}`;
  return null;
}

function replies(cs: Call[]): string[] {
  return calls(cs, "post_reply").map((c) => String(c.input?.text ?? ""));
}

/** The failures of one expect object on one run's calls; [] means it holds. */
export function checkExpect(e: Expect, cs: Call[]): string[] {
  const f: string[] = [];
  if (e.any_of) {
    const results = e.any_of.map((x) => checkExpect(x, cs));
    if (!results.some((r) => r.length === 0)) f.push(`any_of: none held (${results.map((r) => r.join("; ")).join(" | ")})`);
  }
  const opens = calls(cs, "open_umbrella");
  for (const o of e.open === undefined ? [] : Array.isArray(e.open) ? e.open : [e.open]) {
    const whys = opens.map((c) => openMatches(c, o));
    if (!whys.some((w) => w === null)) f.push(`open ${o.variant}: ${whys.length ? whys.join("; ") : "no open_umbrella"}`);
  }
  const moves = calls(cs, "move_to");
  for (const m of e.move === undefined ? [] : Array.isArray(e.move) ? e.move : [e.move]) {
    if (!moves.some((c) => c.input?.channel === m)) f.push(`move ${m}: none`);
  }
  if (e.no_flow) {
    if (!replies(cs).includes(NO_FLOW)) f.push("no_flow: no no-flow line");
    if (!moves.some((c) => c.input?.channel === "questions")) f.push("no_flow: no move to questions");
  }
  if (e.ask_back) {
    const rs = replies(cs);
    const hit = e.ask_back === "F7" ? rs.find((r) => F7_ASK_BACK.test(r)) : rs.find((r) => r === e.ask_back);
    if (!hit) f.push(`ask_back ${e.ask_back}: none in ${JSON.stringify(rs)}`);
    else if (e.ask_back_words && words(hit, e.ask_back_words).length) f.push(`ask_back lacks ${words(hit, e.ask_back_words).join(", ")}`);
  }
  if (e.items || e.items_count !== undefined) {
    const pi = calls(cs, "post_items_as_asks");
    if (pi.length !== 1) f.push(`items: ${pi.length} post_items_as_asks calls`);
    else {
      const items: { n: number; who: string }[] = pi[0].input?.items ?? [];
      if (e.items_count !== undefined && items.length !== e.items_count) f.push(`items: ${items.length} items`);
      for (const want of e.items ?? []) if (!items.some((i) => i.n === want.n && i.who === want.who)) f.push(`items: no item ${want.n} with who "${want.who}"`);
    }
  }
  if (e.split) {
    const head = `This ask has ${e.split.n} pieces:`;
    const r = replies(cs).find((x) => x.startsWith(head));
    if (!r) f.push(`split: no "${head}"`);
    else {
      const lines = r.split("\n").slice(1).filter((l) => l.trim());
      if (lines.length !== e.split.n) f.push(`split: ${lines.length} lines`);
      if (e.split.line_pattern) {
        const re = new RegExp(e.split.line_pattern);
        for (const l of lines) if (!re.test(l)) f.push(`split line "${l}" doesn't match`);
      }
    }
  }
  const asks = calls(cs, "post_ask");
  if (e.post_ask_prefix && !asks.some((c) => String(c.input?.text ?? "").startsWith(e.post_ask_prefix!))) f.push(`post_ask_prefix: none starts "${e.post_ask_prefix}"`);
  if (e.post_asks !== undefined && asks.length !== e.post_asks) f.push(`post_asks: ${asks.length}`);
  if (e.followups !== undefined && calls(cs, "start_followup_thread").length !== e.followups) f.push(`followups: ${calls(cs, "start_followup_thread").length}`);
  const ms = calls(cs, "mention");
  for (const m of e.mentions ?? []) if (!ms.some((c) => c.input?.bot === m.bot && c.input?.step_id === m.step_id)) f.push(`mention ${m.bot} ${m.step_id}: none`);
  for (const m of e.mention_contains ?? []) if (!ms.some((c) => c.input?.step_id === m.step_id && String(c.input?.text ?? "").includes(m.text))) f.push(`mention ${m.step_id} with "${m.text}": none`);
  if (e.refused_wall && !cs.some((c) => c.result?.refused === true && c.result?.wall === e.refused_wall)) f.push(`refused_wall ${e.refused_wall}: none`);
  if (e.reply_starts && !replies(cs).some((r) => r.startsWith(e.reply_starts!))) f.push(`reply starting "${e.reply_starts}": none`);
  if (e.reply_contains && !replies(cs).some((r) => r.includes(e.reply_contains!))) f.push(`reply containing "${e.reply_contains}": none`);
  if (e.no_open && opens.length) f.push(`no_open: ${opens.length} opened`);
  return f;
}
