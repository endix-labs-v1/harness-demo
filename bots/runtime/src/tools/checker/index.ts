import type { ToolDef, ToolContext } from "../define";
import type { ContextPacket } from "../../packet/build";
export const checkerWriteTools: ToolDef[] = [];
export async function checkerPacketExtras(_packet: ContextPacket, _ctx: ToolContext): Promise<Record<string, unknown>> { return {}; }
