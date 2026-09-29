import type { ToolDef } from "../define";
import { postReply } from "./post_reply";
import { moveTo } from "./move_to";
import { handToLighthouse } from "./hand_to_lighthouse";
import { closeThread } from "./close_thread";
import { fileQuestion } from "./file_question";
import { closeQuestion } from "./close_question";

/** SYS §5.5's order (T9 Req 11). The reads, list_idea_threads among them, come from the BotDef. */
export const questionIdeaWriteTools: ToolDef[] = [postReply, moveTo, handToLighthouse, closeThread, fileQuestion, closeQuestion] as ToolDef<any>[];
