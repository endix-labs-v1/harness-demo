// Mentions by name (Req 18). No import statement: T10 imports this file by relative path.

type MentionConfig = {
  people: { henry: { slack_user_id: string } };
  slack: { bots: Record<string, unknown> };
};

export const MENTION_NAMES: Record<string, string> = {
  Lighthouse: "lighthouse",
  "Task manager": "task_manager",
  "Doc manager": "doc_manager",
  "Question/idea agent": "question_idea",
  Checker: "checker",
  Henry: "henry",
};

export function renderMentions(text: string, config: MentionConfig): string {
  let out = text;
  for (const [name, key] of Object.entries(MENTION_NAMES)) {
    const id = key === "henry" ? config.people.henry.slack_user_id : (config.slack.bots[key] as { user_id?: string } | undefined)?.user_id ?? "";
    if (!id) continue;
    out = out.split(`<@${name}>`).join(`<@${id}>`);
  }
  return out;
}
