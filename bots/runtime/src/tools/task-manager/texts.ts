// Every fixed string of the task manager (T7 Spec Req 6). WALL §2, DICT §2 and §4, SYS §5.3.

/** WALL W-15, exact. */
export const W15 =
  'Refused by the harness (W-15, OPS-F7-16, OPS-F7-17): a to-do closes or moves only on a line from Henry or 서준 ("Done:", "Drop:" or "Move:"); pass its permalink.';

/** WALL W-16, exact. */
export function w16(id: string, variant: string): string {
  return `Refused by the harness (W-16, OPS-F0-24): ${id} is not a step of ${variant}. A lightmap quotes only steps on the flow page.`;
}

// ---- DICT §2, Task manager ----

export function treeBuilt(key: string, n: number, shortIds: string[]): string {
  return `${key}: ${n} steps filed · ${shortIds.join(", ")}`;
}
export function f7TaskSet(key: string, owner: string, when: string): string {
  return `${key} is the task: owner ${owner}, ${when}.`;
}
export function closedLine(key: string, kind: string): string {
  return `${key} closed · ${kind}`;
}
export function afterMove(key: string, newWhen: string, moveLine: string): string {
  return `${key}: ${newWhen} (Henry: "${moveLine}")`;
}
export function afterHandOff(step: string, what: string, link: string): string {
  return `${step} · done: ${what} · ${link}`;
}
export function pageNamedByDone(key: string, page: string, what: string): string {
  return `<@Lighthouse> OPS-F7-07 · ${key}'s Done line names ${page}: "${what}"`;
}
export function refusalLine(message: string): string {
  return `Refused: ${message}`;
}

// ---- SYS §5.3, the comment line ----

export function commentLine(today: string, what: string, permalink: string): string {
  return `${today} · ${what} · ${permalink}`;
}

// ---- SYS §6.2, a step ----

export function stepTitle(shortId: string, output: string): string {
  return `${shortId} · ${output}`;
}
/** (proposed) The link part stays empty until OPS-F0-13; no trailing space. */
export function stepDescription(by: string, output: string): string {
  return `By: ${by}\nDone when: ${output}:`;
}

// ---- Rule refusals (T7 Spec Req 2; proposed shape, no wall) ----

export const CLOSE_VIA_CLOSE = "closing goes through close (OPS-F0-09).";
export function openChild(childKey: string, childTitle: string, stateName: string): string {
  return `${childKey} (${childTitle}) is ${stateName}; a tree closes when every child is Done or Canceled.`;
}
export function noDoneWhen(key: string): string {
  return `${key} has no Done when line to fill.`;
}
/** (proposed) More than one line matching the Done when pattern. */
export function manyDoneWhen(key: string): string {
  return `${key} has more than one Done when line; fill it by hand.`;
}

// ---- DICT §4, closing comments (Linear) ----

export type CloseKind = "Done" | "Drop" | "No" | "Led to" | "Reopened" | "Not doing" | "Closed";

/** `Done · <author>: "<line>" · <permalink>`, and the same for Drop and No. */
export function personClosing(kind: "Done" | "Drop" | "No", author: string, line: string, permalink: string): string {
  return `${kind} · ${author}: "${line}" · ${permalink}`;
}
export function ledToClosing(key: string): string {
  return `Led to: ${key}`;
}
export function reopenedClosing(permalink: string): string {
  return `Reopened: ${permalink}`;
}
export function notDoingClosing(discussionUrl: string): string {
  return `Not doing · Henry: "no" · ${discussionUrl}`;
}

/** The formats `close` accepts for `Closed` (a tree or a step; a docs issue). */
export const CLOSED_FORMATS: RegExp[] = [/^Closed · .+$/, /^Code doc: https:\/\/\S+$/, /^No doc change: .+$/];

export interface RuleRefusal {
  refused: true;
  rule: string;
  message: string;
}
export function ruleRefused(rule: string, message: string): RuleRefusal {
  return { refused: true, rule, message };
}
