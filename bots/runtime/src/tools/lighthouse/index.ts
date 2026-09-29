// Lighthouse's eight write tools, in SYS §5.2 order (T6 Spec Req 16).
import type { ToolDef } from "../define";
import { postReply } from "./post_reply";
import { moveToTool } from "./move_to";
import { startTaskThread } from "./start_task_thread";
import { openUmbrella } from "./open_umbrella";
import { mention } from "./mention";
import { postAsk } from "./post_ask";
import { startFollowupThread } from "./start_followup_thread";
import { postItemsAsAsks } from "./post_items_as_asks";

export const lighthouseWriteTools: ToolDef[] = [
  postReply,
  moveToTool,
  startTaskThread,
  openUmbrella,
  mention,
  postAsk,
  startFollowupThread,
  postItemsAsAsks,
] as unknown as ToolDef[];
