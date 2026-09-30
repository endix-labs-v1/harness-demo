// What the doc manager reads from the current event's thread (T8 Spec Requirement 7):
// the latest draft (DICT §2, OPS-F1-10), the Owner's OK, and the latest carry-over list.
import { trimForGuard } from "../../guard/person-line";

export interface ThreadMsg {
  ts: string;
  author: { name: string; kind: string };
  text: string;
  permalink: string;
}

/** Slack escapes &, < and > in message text. */
function unescapeSlack(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

const later = (a: string, b: string) => Number(a) > Number(b);

export interface Draft {
  ts: string;
  permalink: string;
  page: string;
  section: string | null;
  now: string | null;
  new: string | null;
  why: string | null;
}

const DRAFT_START = "OPS-F1-10 · Draft for ";

/** Where the draft starts in a message: at the start of any line (another line may come first), or -1. */
function draftStart(text: string): number {
  if (text.startsWith(DRAFT_START)) return 0;
  const i = text.indexOf("\n" + DRAFT_START);
  return i < 0 ? -1 : i + 1;
}

/** The latest message holding an `OPS-F1-10 · Draft for …` line, with the text inside its Now and New quotes. */
export function latestDraft(thread: ThreadMsg[]): Draft | null {
  for (let i = thread.length - 1; i >= 0; i--) {
    const m = thread[i];
    const at = draftStart(m.text);
    if (at < 0) continue;
    const ls = m.text.slice(at).split("\n");
    const pick = (re: RegExp) => {
      for (const l of ls) {
        const r = re.exec(l);
        if (r) return unescapeSlack(r[1]);
      }
      return null;
    };
    return {
      ts: m.ts,
      permalink: m.permalink,
      page: unescapeSlack(ls[0].slice(DRAFT_START.length).trim()),
      section: pick(/^Section: (.*)$/),
      now: pick(/^Now: "(.*)"$/),
      new: pick(/^New: "(.*)"$/),
      why: pick(/^Why: (.*)$/),
    };
  }
  return null;
}

/** "OK" or a message starting with "OK" (DICT §3), after the person-line trim. */
export function isOk(text: string): boolean {
  return /^ok\b/i.test(trimForGuard(text));
}

/** The latest OK by the person `ownerName`, later than `afterTs`. */
export function ownerOk(thread: ThreadMsg[], ownerName: string, afterTs: string): ThreadMsg | null {
  for (let i = thread.length - 1; i >= 0; i--) {
    const m = thread[i];
    if (m.author.kind === "person" && m.author.name === ownerName && later(m.ts, afterTs) && isOk(m.text)) return m;
  }
  return null;
}

export interface CarryOver {
  ts: string;
  permalink: string;
  page: string;
  key: string;
  changes: { page: string; section: string; why: string; owner: string }[];
  noChange: { page: string; why: string }[];
}

const CARRY_START = "OPS-F0-41 · Carry-over for ";

/** The latest carry-over list (DICT §2, OPS-F0-41). */
export function latestCarryOver(thread: ThreadMsg[]): CarryOver | null {
  for (let i = thread.length - 1; i >= 0; i--) {
    const m = thread[i];
    if (!m.text.startsWith(CARRY_START)) continue;
    const ls = unescapeSlack(m.text).split("\n");
    const head = /^OPS-F0-41 · Carry-over for (.+) \((END-\d+)\):/.exec(ls[0]);
    if (!head) return null;
    const out: CarryOver = { ts: m.ts, permalink: m.permalink, page: head[1], key: head[2], changes: [], noChange: [] };
    for (const raw of ls.slice(1)) {
      const l = raw.trim();
      const nc = l.indexOf(" · no change · ");
      if (nc > 0) {
        out.noChange.push({ page: l.slice(0, nc), why: l.slice(nc + " · no change · ".length) });
        continue;
      }
      const ch = l.indexOf(" · changes · ");
      if (ch > 0) {
        const rest = l.slice(ch + " · changes · ".length);
        const ownerAt = rest.lastIndexOf(" · ");
        const body = ownerAt >= 0 ? rest.slice(0, ownerAt) : rest;
        const owner = ownerAt >= 0 ? rest.slice(ownerAt + 3) : "";
        const colon = body.indexOf(": ");
        out.changes.push({
          page: l.slice(0, ch),
          section: colon >= 0 ? body.slice(0, colon) : body,
          why: colon >= 0 ? body.slice(colon + 2) : "",
          owner,
        });
      }
    }
    return out;
  }
  return null;
}
