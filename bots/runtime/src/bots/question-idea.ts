import type { BotDef } from "./types";
import { questionIdeaWriteTools } from "../tools/question-idea/index";

const def: BotDef = {
  name: "question-idea",
  displayName: "Question/idea agent",
  configKey: "question_idea",
  secrets: {
    slackBot: "SLACK_QUESTION_IDEA_BOT_TOKEN",
    slackApp: "SLACK_QUESTION_IDEA_APP_TOKEN",
    linear: "LINEAR_QUESTION_IDEA_TOKEN",
    notion: "NOTION_READER_TOKEN",
    github: "GITHUB_READ_TOKEN",
  },
  socketMode: true,
  channels: ["questions", "ideas", "lighthouse", "build_test"],
  events: ["E12", "E13", "E14", "E15"],
  promptFile: "question-idea.md",
  reads: ["read_thread", "linear_get", "linear_find", "notion_search", "notion_read", "github_read", "list_idea_threads"],
  writes: questionIdeaWriteTools,
  notionCurrentOnly: true,
};
export default def;
