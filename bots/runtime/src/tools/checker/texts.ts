// The Checker's fixed lines (DICT §2, Checker; T9 Spec Requirements 12, 13).

export type PingKind = "due" | "check_date" | "quiet_idea" | "waiting_ok";
export const PING_KINDS: PingKind[] = ["due", "check_date", "quiet_idea", "waiting_ok"];

export function pingLine(kind: PingKind, subject: string, owner: string): string {
  switch (kind) {
    case "due":
      return `Due: ${subject} · <@${owner}>`;
    case "check_date":
      return `Has ${subject} happened? <@${owner}>`;
    case "quiet_idea":
      return "Go, later or no? <@Henry>";
    case "waiting_ok":
      return "The item list above waits for an OK from someone who was on the call. <@Henry>";
  }
}

export type HandTo = "lighthouse" | "question-idea";
export const HAND_STEP: Record<HandTo, string> = { lighthouse: "OPS-F7-08", "question-idea": "OPS-F7-10" };

export function handOnLine(to: HandTo, taskKey: string, text: string): string {
  return to === "lighthouse"
    ? `<@Lighthouse> OPS-F7-08 · ${taskKey} is due: re-stamp it`
    : `<@Question/idea agent> OPS-F7-10 · ${taskKey} is due: reopen ${text}`;
}

/** What a hand-on line holds, for the once-a-day rule. */
export const handOnMark = (stepId: string, taskKey: string) => `${stepId} · ${taskKey} is due`;

export const SKIPPED = { skipped: true, reason: "already posted today" } as const;

// Errors (proposed).
export const ERR_PING_CHANNEL = "quiet_idea pings a #demo-ideas thread; due, check_date and waiting_ok ping a #demo-lighthouse thread.";
export const ERR_OWNER = 'owner is "Henry" (the only person in the demo with a Slack account).';
export const ERR_SUBJECT = "due and check_date need a subject: the task's title, or the event.";
export const ERR_HAND_CHANNEL = "hand_on posts in the task's thread in #demo-lighthouse.";
export const ERR_HAND_STEP = "hand_on to lighthouse is OPS-F7-08; to question-idea is OPS-F7-10.";
export const ERR_HAND_TEXT = "hand_on to question-idea needs text: the idea thread's permalink in #demo-ideas.";
