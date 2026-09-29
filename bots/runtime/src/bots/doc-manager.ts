import type { BotDef } from "./types";
import { docManagerWriteTools } from "../tools/doc-manager/index";

const def: BotDef = {
  name: "doc-manager",
  displayName: "Doc manager",
  configKey: "doc_manager",
  secrets: { slackBot: "SLACK_DOC_MANAGER_BOT_TOKEN", slackApp: "SLACK_DOC_MANAGER_APP_TOKEN", linearReader: "LINEAR_CHECKER_TOKEN", notion: "NOTION_DOC_MANAGER_TOKEN" },
  socketMode: true,
  channels: ["lighthouse", "build_test"],
  events: ["E11"],
  promptFile: "doc-manager.md",
  reads: ["read_thread", "notion_search", "notion_read"],
  writes: docManagerWriteTools,
  notionCurrentOnly: false,
};
export default def;
