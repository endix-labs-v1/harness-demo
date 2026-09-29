// Every fixed string Lighthouse's tools write (T6 Spec Req 5): the WALL texts of W-16 to
// W-19 and the DICT §2 Lighthouse lines. Nothing in the tools writes these any other way.

export function w16(id: string, variant: string): string {
  return `Refused by the harness (W-16, OPS-F0-24): ${id} is not a step of ${variant}. A lightmap quotes only steps on the flow page.`;
}

export const W17 =
  'Refused by the harness (W-17, OPS-F7-14): an F7 task opens only with exactly one when: a due date, a blocking issue, a check date with what it waits on, or a repeat. Ask the asker "By when, or after what?".';

export const W18 = "Refused by the harness (W-18, OPS-F6-10): this idea has no Go: or Later: line from Henry or 서준, so nothing opens from it.";

export const W19 = "Refused by the harness (W-19, OPS-F5-11): the item list has no OK from someone who was on the call.";

/** Move (DICT §2, OPS-F4-21, F6-19): the header line, then the text quoted line by line. */
export function moveText(source: string, asker: string, text: string): string {
  const quoted = text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  return `Moved from ${source} · asked by ${asker}\n${quoted}`;
}

/** F7 task thread (DICT §2, OPS-F7-23). */
export function taskThreadText(source: string, task: string): string {
  return `Task from ${source}: ${task}`;
}

/** Follow-up (DICT §2, OPS-F0-42). */
export function followupText(originKey: string, line: string): string {
  return `Follow-up from ${originKey}, carry-over line: "${line}"`;
}

/** Item as ask (DICT §2, OPS-F5-04). */
export function itemAskText(rowUrl: string, n: number, who: string, sentence: string): string {
  return `From the call ${rowUrl}, item ${n}, asked by ${who}: ${sentence}`;
}

export type MentionBot = "task-manager" | "doc-manager" | "question-idea";

export const MENTION_LABEL: Record<MentionBot, string> = {
  "task-manager": "Task manager",
  "doc-manager": "Doc manager",
  "question-idea": "Question/idea agent",
};

/** Mention (DICT §2 shapes): `<@{label}> {step} · {text}`; postGuarded renders the label to the user ID. */
export function mentionText(bot: MentionBot, stepId: string, text: string): string {
  return `<@${MENTION_LABEL[bot]}> ${stepId} · ${text}`;
}

/** No flow fits (DICT §2, OPS-F0-19). */
export const NO_FLOW = "No flow fits this in the demo, so I'm posting it in #demo-questions (OPS-F0-19).";

/** Refusal (DICT §2): what Lighthouse posts in the thread after a tool refuses. */
export function refusalLine(message: string): string {
  return `Refused: ${message}`;
}

/** (proposed, T6 Spec Req 5) */
export const ONLY_OUR_CHANNELS = "Lighthouse posts only in #demo-lighthouse, #demo-questions and #demo-ideas.";

/** The task row of every demo lightmap (proposed, T6 Spec Req 9). */
export const TASK_ROW = "none in the demo (the flow's defaults)";
