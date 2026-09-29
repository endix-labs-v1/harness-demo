import type { ToolDef } from "../define";
import { ping } from "./ping";
import { handOn } from "./hand_on";

export { checkerPacketExtras, findings, type Finding } from "./pass";

/** SYS §5.6's order (T9 Req 14). The reads, list_idea_threads among them, come from the BotDef. */
export const checkerWriteTools: ToolDef[] = [ping, handOn] as ToolDef<any>[];
