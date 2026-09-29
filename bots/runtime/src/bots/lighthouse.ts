import type { BotDef } from "./types";
import { lighthouseWriteTools } from "../tools/lighthouse/index";

const def: BotDef = {
  name: "lighthouse",
  displayName: "Lighthouse",
  configKey: "lighthouse",
  secrets: { slackBot: "SLACK_LIGHTHOUSE_BOT_TOKEN", slackApp: "SLACK_LIGHTHOUSE_APP_TOKEN", linear: "LINEAR_LIGHTHOUSE_TOKEN", notion: "NOTION_READER_TOKEN" },
  socketMode: true,
  channels: ["lighthouse", "questions", "ideas", "build_test"],
  events: ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E17"],
  promptFile: "lighthouse.md",
  reads: ["read_thread", "linear_get", "linear_find", "notion_search", "notion_read", "steps"],
  writes: lighthouseWriteTools,
  notionCurrentOnly: false,
};
export default def;
