import { plainText } from "../clients/slack";
import type { ThreadPredicate } from "./table";

export interface PredicateMessage {
  ts: string;
  author: { name: string; kind: string };
  text: string;
}

export interface PredicateInput {
  eventTs: string;
  thread: PredicateMessage[];
  /** Labels of an issue, read with the task manager's Linear token. */
  issueLabels(key: string): Promise<string[]>;
}

const UMBRELLA_LINE = /^(END-\d+) · (F\d+(?:\.\d+)?) · /;

function older(input: PredicateInput): PredicateMessage[] {
  return input.thread.filter((m) => Number(m.ts) < Number(input.eventTs));
}

function firstUmbrella(thread: PredicateMessage[]): RegExpExecArray | null {
  for (const m of thread) {
    if (m.author.name !== "Lighthouse") continue;
    const hit = UMBRELLA_LINE.exec(plainText(m.text));
    if (hit) return hit;
  }
  return null;
}

/** The thread predicates of Req 9; links are unwrapped to their label first. */
export const THREAD_PREDICATES: Record<ThreadPredicate, (input: PredicateInput) => Promise<boolean>> = {
  async lighthouse_last_ends_with_question(input) {
    const lh = older(input).filter((m) => m.author.name === "Lighthouse");
    const last = lh[lh.length - 1];
    return !!last && plainText(last.text).trim().endsWith("?");
  },
  async umbrella_f5_with_item_list(input) {
    const hit = firstUmbrella(input.thread);
    if (!hit || !hit[2].startsWith("F5.")) return false;
    return input.thread.some((m) => m.author.name === "Entry agent" && plainText(m.text).startsWith('OPS-F5-02 · Items from "'));
  },
  async lighthouse_proposed_flows(input) {
    return older(input).some((m) => m.author.name === "Lighthouse" && plainText(m.text).startsWith("Proposed flows:"));
  },
  async umbrella_label_later(input) {
    const hit = firstUmbrella(input.thread);
    if (!hit) return false;
    const labels = await input.issueLabels(hit[1]);
    return labels.includes("Later");
  },
};
