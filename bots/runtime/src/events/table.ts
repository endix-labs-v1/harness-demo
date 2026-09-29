import type { BotName } from "../bots/types";

export type EventId = "E1" | "E2" | "E3" | "E4" | "E5" | "E6" | "E7" | "E8" | "E9" | "E10" | "E11" | "E12" | "E13" | "E14" | "E15" | "E16" | "E17";
export type ChannelRole = "lighthouse" | "questions" | "ideas";
export type Position = "top" | "reply" | "any" | "top_or_self" | "self" | "cli";
export type BotConfigKey = "lighthouse" | "task_manager" | "doc_manager" | "question_idea" | "checker" | "entry_agent";

export type AuthorRule =
  | { person: true; bots?: string[] } // a person, and these bots by display name
  | { person: false; bots: string[] }
  | { anyone: true } // person or any bot
  | null;

export type TextRule =
  | { kind: "mentions"; bot: BotConfigKey; holds?: string[] }
  | { kind: "prefix"; starts: string[] }
  | { kind: "ok" }
  | { kind: "go_or_prefix"; starts: string[] }
  | null;

export type ThreadPredicate = "lighthouse_last_ends_with_question" | "umbrella_f5_with_item_list" | "lighthouse_proposed_flows" | "umbrella_label_later";

export interface EventRow {
  id: EventId;
  wakes: BotName;
  channels: ChannelRole[];
  position: Position;
  author: AuthorRule;
  text: TextRule;
  thread: ThreadPredicate | null;
  rule: string;
}

const ALL: ChannelRole[] = ["lighthouse", "questions", "ideas"];
const PERSON = { person: true } as const;

/** SYS §4.2 as data, in its table order (Req 9). */
export const EVENT_TABLE: EventRow[] = [
  { id: "E1", wakes: "lighthouse", channels: ["lighthouse"], position: "top", author: PERSON, text: null, thread: null, rule: "OPS-F0-03" },
  { id: "E2", wakes: "lighthouse", channels: ["lighthouse"], position: "top", author: { person: false, bots: ["Question/idea agent", "Task manager", "Checker", "Entry agent"] }, text: null, thread: null, rule: "OPS-F0-02, F4-01, F1-39" },
  { id: "E3", wakes: "lighthouse", channels: ["lighthouse"], position: "self", author: { person: false, bots: ["Lighthouse"] }, text: null, thread: null, rule: "OPS-F5-04, F6-05" },
  { id: "E4", wakes: "lighthouse", channels: ["lighthouse"], position: "reply", author: PERSON, text: null, thread: "lighthouse_last_ends_with_question", rule: "OPS-F0-03 ask back, F7-01" },
  { id: "E5", wakes: "lighthouse", channels: ALL, position: "any", author: { anyone: true }, text: { kind: "mentions", bot: "lighthouse" }, thread: null, rule: "" },
  { id: "E6", wakes: "lighthouse", channels: ["lighthouse"], position: "reply", author: PERSON, text: { kind: "ok" }, thread: "umbrella_f5_with_item_list", rule: "OPS-F5-04" },
  { id: "E7", wakes: "lighthouse", channels: ["ideas"], position: "reply", author: PERSON, text: { kind: "prefix", starts: ["Go:", "Later:"] }, thread: null, rule: "OPS-F6-05" },
  { id: "E8", wakes: "lighthouse", channels: ["questions"], position: "reply", author: PERSON, text: { kind: "go_or_prefix", starts: ["Answer:"] }, thread: "lighthouse_proposed_flows", rule: "OPS-F4-04, 05" },
  { id: "E9", wakes: "task-manager", channels: ["lighthouse"], position: "any", author: { anyone: true }, text: { kind: "mentions", bot: "task_manager" }, thread: null, rule: "OPS-F0-07, 13; hand-offs" },
  { id: "E10", wakes: "task-manager", channels: ["lighthouse"], position: "reply", author: PERSON, text: { kind: "prefix", starts: ["Done:", "Move:", "Drop:"] }, thread: "umbrella_label_later", rule: "OPS-F7-06, 12, 13" },
  { id: "E11", wakes: "doc-manager", channels: ["lighthouse"], position: "any", author: { anyone: true }, text: { kind: "mentions", bot: "doc_manager" }, thread: null, rule: "hand-offs" },
  { id: "E12", wakes: "question-idea", channels: ["questions", "ideas"], position: "top_or_self", author: { person: true, bots: ["Lighthouse"] }, text: null, thread: null, rule: "OPS-F4-01, F6-01, F6-14" },
  { id: "E13", wakes: "question-idea", channels: ["questions", "ideas"], position: "reply", author: PERSON, text: null, thread: null, rule: "OPS-F4-03, F6-03" },
  { id: "E14", wakes: "question-idea", channels: ["ideas"], position: "any", author: PERSON, text: { kind: "prefix", starts: ["No:"] }, thread: null, rule: "OPS-F6-07" },
  { id: "E15", wakes: "question-idea", channels: ALL, position: "any", author: { anyone: true }, text: { kind: "mentions", bot: "question_idea" }, thread: null, rule: "OPS-F6-07, 08, F7-10" },
  { id: "E16", wakes: "checker", channels: [], position: "cli", author: null, text: null, thread: null, rule: "OPS-F7-03, F6-06" },
  { id: "E17", wakes: "lighthouse", channels: ["lighthouse"], position: "any", author: { anyone: true }, text: { kind: "mentions", bot: "lighthouse", holds: ["OPS-F7-07", "OPS-F7-08"] }, thread: null, rule: "OPS-F7-07, 08" },
];

/** When several rows of one bot match: E17 before E5; E14 and E15 before E13; else table order. */
export const EVENT_PRECEDENCE: EventId[] = ["E1", "E2", "E3", "E4", "E17", "E5", "E6", "E7", "E8", "E9", "E10", "E11", "E12", "E14", "E15", "E13", "E16"];
