import type { BotDef } from "./types";
import { checkerPacketExtras, checkerWriteTools } from "../tools/checker/index";

const def: BotDef = {
  name: "checker",
  displayName: "Checker",
  configKey: "checker",
  secrets: { slackBot: "SLACK_CHECKER_BOT_TOKEN", linear: "LINEAR_CHECKER_TOKEN", notion: "NOTION_READER_TOKEN", github: "GITHUB_READ_TOKEN" },
  socketMode: false,
  channels: ["lighthouse", "ideas", "build_test"],
  events: ["E16"],
  promptFile: "checker.md",
  reads: ["read_thread", "linear_get", "linear_find", "notion_search", "notion_read", "github_read", "list_idea_threads"],
  writes: checkerWriteTools,
  notionCurrentOnly: false,
  packetExtras: checkerPacketExtras,
};
export default def;
