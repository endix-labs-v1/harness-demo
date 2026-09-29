import type { EventId } from "../events/table";
import type { ContextPacket } from "../packet/build";
import type { SharedReadName } from "../tools/shared";
import type { ToolContext, ToolDef } from "../tools/define";

export type BotName = "lighthouse" | "task-manager" | "doc-manager" | "question-idea" | "checker";
export const BOT_NAMES: BotName[] = ["lighthouse", "task-manager", "doc-manager", "question-idea", "checker"];
export type ChannelKey = "lighthouse" | "questions" | "ideas" | "build_test";

export interface BotDef {
  name: BotName;
  displayName: "Lighthouse" | "Task manager" | "Doc manager" | "Question/idea agent" | "Checker";
  configKey: "lighthouse" | "task_manager" | "doc_manager" | "question_idea" | "checker";
  secrets: {
    slackBot: string;
    slackApp?: string;
    linear?: string;
    linearReader?: string;
    notion?: "NOTION_READER_TOKEN" | "NOTION_DOC_MANAGER_TOKEN";
    github?: "GITHUB_READ_TOKEN";
  };
  socketMode: boolean;
  channels: ChannelKey[]; // SEC §2
  events: EventId[]; // the rows of Req 9 it wakes on
  promptFile: string; // relative to bots/, e.g. "lighthouse.md"
  reads: SharedReadName[]; // SYS §5.1
  writes: ToolDef[]; // imported from src/tools/<bot>/index.ts
  notionCurrentOnly: boolean; // true only for question-idea (W-20)
  packetExtras?: (packet: ContextPacket, ctx: ToolContext) => Promise<Record<string, unknown>>;
}
