import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import type { BotDef } from "../bots/types";
import { printRefusal, type BotLogger } from "../core/log";
import { w10 } from "./permissions";

/**
 * One callback for PreToolUse and PostToolUse (Req 13). PreToolUse logs `tool_call` and
 * denies any tool that isn't the bot's own, in front of canUseTool, with the W-10 text.
 */
export function makeAuditHook(def: Pick<BotDef, "displayName" | "name">, allowed: Set<string>, log: BotLogger): HookCallback {
  return async (input) => {
    const i = input as { hook_event_name: string; tool_name?: string; tool_input?: unknown; tool_response?: unknown };
    if (i.hook_event_name === "PreToolUse") {
      const name = i.tool_name ?? "";
      log.write({ kind: "tool_call", tool: name, input: i.tool_input ?? null });
      if (!allowed.has(name)) {
        const message = w10(def, name);
        log.write({ kind: "refused", tool: name, input: i.tool_input ?? null, message, result: { refused: true, wall: "W-10", message } });
        printRefusal("W-10", def.name, name, message, log.redactionValues);
        return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: message } };
      }
      return {};
    }
    if (i.hook_event_name === "PostToolUse") {
      log.write({ kind: "tool_result", tool: i.tool_name ?? null, input: i.tool_input ?? null, result: i.tool_response ?? null });
      return {};
    }
    return {};
  };
}
