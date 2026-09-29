// The Question/idea agent's fixed texts (DICT §2, §4; T9 Spec Requirements 5 to 10).

/** The Move text, as Lighthouse's (T6 Spec Requirement 5; DICT §2 Lighthouse "Move"). */
export function moveText(sourcePermalink: string, asker: string, text: string): string {
  const quoted = text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  return `Moved from ${sourcePermalink} · asked by ${asker}\n${quoted}`;
}

/** DICT §2, Question/idea agent, "Hand to Lighthouse". */
export function handText(asker: string, text: string, sourcePermalink: string): string {
  return `Ask from ${asker} via the question/idea agent: ${text} · ${sourcePermalink}`;
}

export type CloseKind = "Answered" | "Led to" | "Parked" | "Later" | "Dropped";
export const CLOSE_KINDS: CloseKind[] = ["Answered", "Led to", "Parked", "Later", "Dropped"];

/** Which kinds close a thread in which channel (T9 Req 8, proposed). */
export const CLOSE_KINDS_BY_CHANNEL: Record<"questions" | "ideas", CloseKind[]> = {
  questions: ["Answered", "Led to", "Parked"],
  ideas: ["Led to", "Later", "Dropped"],
};

/** DICT §4, question thread and idea thread closing lines. */
export function closingLine(kind: CloseKind, body: string, personLinePermalink?: string): string {
  switch (kind) {
    case "Answered":
      return `Answered: ${body}`;
    case "Led to":
      return `Led to: ${body}`;
    case "Parked":
      return `Parked: ${body}`;
    case "Later":
      return `Later: ${body} · Henry: ${personLinePermalink}`;
    case "Dropped":
      return `Dropped: ${body} · Henry: ${personLinePermalink}`;
  }
}

/** The person line each decision kind needs behind it (W-12). */
export const PERSON_START: Partial<Record<CloseKind, string>> = { Later: "Later:", Dropped: "No:" };

export const LATER_BODY = /^END-\d+ · revisit \d{4}-\d{2}-\d{2}$/;
export const LED_TO_BODY = /^END-\d+(, END-\d+)*$/;

/** SYS §6.3 open question. */
export const openQuestionTitle = (question: string) => `Open question: ${question}`;
export const threadLine = (permalink: string) => `Thread: ${permalink}`;

/** DICT §4, open question closing comment. */
export function answerComment(answerLine: string, answerPermalink: string, docsLink: string): string {
  return `Answer · Henry: "${answerLine}" · ${answerPermalink}\nDocs: ${docsLink}`;
}

// Errors (T9 Req 5, 8; proposed).
export const ERR_CHANNEL = "The question/idea agent posts only in #demo-questions, #demo-ideas and #demo-lighthouse.";
export const ERR_LIGHTHOUSE = "In #demo-lighthouse the question/idea agent posts only mentions and refusal lines.";
export const ERR_CLOSE_CHANNEL =
  "Answered, Led to and Parked close a #demo-questions thread; Led to, Later and Dropped close a #demo-ideas thread.";
export const ERR_LATER_BODY = "For Later, body is `END-<n> · revisit YYYY-MM-DD`.";
export const ERR_LED_TO_BODY = "For Led to, body is the keys, comma separated: `END-1, END-2`.";
export const ERR_QUESTIONS_ONLY = "file_question takes a thread in #demo-questions.";
