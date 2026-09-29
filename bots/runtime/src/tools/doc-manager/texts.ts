// Every fixed string of the doc manager (T8 Spec Requirement 8). WALL, DICT §2 and SYS §6.4
// write them; the ones marked (proposed) are the T8 Spec's own texts.

export interface RuleRefusal {
  refused: true;
  rule: string;
  message: string;
}

/** A refusal that holds a flow rule but no wall (T8 Spec Requirement 2). */
export function ruleRefusal(rule: string, message: string): RuleRefusal {
  return { refused: true, rule, message };
}

export function isRuleRefusal(v: unknown): v is RuleRefusal {
  return !!v && typeof v === "object" && (v as RuleRefusal).refused === true && typeof (v as RuleRefusal).rule === "string";
}

export const W13_TEXT = "Refused by the harness (W-13, OPS-F1-26): only Henry or 서준 set Status to Current or Retired, or fill Approved by.";

export function w14Text(page: string, name: string): string {
  return `Refused by the harness (W-14, OPS-F1-28): ${page} is Current; it changes only after its Owner, ${name}, posts OK in the thread.`;
}

/** SYS §6.4 change log line (without the leading "- "; it is a bulleted block). */
export function changeLogLine(today: string, what: string, why: string, key: string): string {
  return `${today} · ${what} · ${why} · ${key}`;
}

/** SYS §6.4 Checked-against line. */
export function checkedAgainstLine(today: string, changedPage: string, originKey: string, why: string): string {
  return `${today} · Checked against ${changedPage} (${originKey}): no change, ${why}`;
}

// DICT §2, Doc manager.
export const lines = {
  done: (step: string, title: string, link: string) => `${step} · done: ${title} · ${link}`,
  callLogRow: (rowLink: string) => `OPS-F5-01 · done: Call log row · ${rowLink}`,
  checkedAgainstAdded: (pages: string) => `<@Task manager> OPS-F0-43 · Checked-against lines added: ${pages}`,
  rowUpdated: (key: string) => `<@Task manager> OPS-F5-05 · row updated: close ${key}`,
  refusal: (message: string) => `Refused: ${message}`,
};

// Rule refusals (proposed texts of the T8 Spec).
export const texts = {
  retired: (title: string) => `${title} is Retired; it doesn't change.`,
  wordForWord: "old and new must be the Now and New lines of the latest draft in this thread, word for word (OPS-F1-35).",
  exactlyOnce: (title: string, n: number) => `the text to replace must occur exactly once on ${title}; it occurs ${n} times (OPS-F1-35).`,
  notEditable: (blockType: string) => `the text to replace sits in a ${blockType} block, which this tool doesn't edit.`,
  draftNoChangeLog: (title: string) => `${title} is Draft; its changes live in the thread until it is Current (OPS-F1-30).`,
  noChangeLog: (title: string) => `${title} has no Change log section at its end.`,
  callLogByCreatePage: "Call log rows are made by call_log_create (OPS-F5-01); create_page writes Demo · Endix Docs pages only.",
  noBody: "a Call log row holds links only, no body (OPS-F5-09).",
  notUmbrella: (key: string) => `${key} is not an umbrella of this thread; name it in the hand-off.`,
};
