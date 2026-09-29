import type { BotDef } from "./types";
import { taskManagerWriteTools } from "../tools/task-manager/index";

const def: BotDef = {
  name: "task-manager",
  displayName: "Task manager",
  configKey: "task_manager",
  secrets: { slackBot: "SLACK_TASK_MANAGER_BOT_TOKEN", slackApp: "SLACK_TASK_MANAGER_APP_TOKEN", linear: "LINEAR_TASK_MANAGER_TOKEN" },
  socketMode: true,
  channels: ["lighthouse", "build_test"],
  events: ["E9", "E10"],
  promptFile: "task-manager.md",
  reads: ["read_thread", "linear_get", "linear_find", "steps"],
  writes: taskManagerWriteTools,
  notionCurrentOnly: false,
};
export default def;
