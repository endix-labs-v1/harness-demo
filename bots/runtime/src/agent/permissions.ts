import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import type { BotDef } from "../bots/types";
import { printRefusal, type BotLogger } from "../core/log";

/** WALL W-10's text. `name` is the tool name as the SDK passes it. */
export function w10(def: Pick<BotDef, "displayName">, name: string): string {
  return `Refused by the harness (W-10, OPS-A4-10): ${def.displayName} has no tool ${name}. Use only your tools.`;
}

/** SYS §4.5's canUseTool: deny by default, with the W-10 text; a denial is logged `refused`. */
export function makeCanUseTool(def: Pick<BotDef, "displayName" | "name">, allowed: Set<string>, log: BotLogger): CanUseTool {
  return async (name, input) => {
    if (allowed.has(name)) return { behavior: "allow" };
    const message = w10(def, name);
    log.write({ kind: "refused", tool: name, input, message, result: { refused: true, wall: "W-10", message } });
    printRefusal("W-10", def.name, name, message, log.redactionValues);
    return { behavior: "deny", message };
  };
}
