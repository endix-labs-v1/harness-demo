import type { BotDef, BotName } from "./types";
import { BOT_NAMES } from "./types";
import lighthouse from "./lighthouse";
import taskManager from "./task-manager";
import docManager from "./doc-manager";
import questionIdea from "./question-idea";
import checker from "./checker";

/** One file per bot; a bot's tools come from its own `src/tools/<bot>/index.ts` (Req 26). */
export const BOTS: Record<BotName, BotDef> = {
  lighthouse,
  "task-manager": taskManager,
  "doc-manager": docManager,
  "question-idea": questionIdea,
  checker,
};

export function botDef(name: string): BotDef {
  if (!(BOT_NAMES as string[]).includes(name)) {
    throw new Error(`Unknown bot "${name}". Bots: ${BOT_NAMES.join(", ")}.`);
  }
  return BOTS[name as BotName];
}

export function botByConfigKey(key: string): BotDef | undefined {
  return Object.values(BOTS).find((d) => d.configKey === key);
}
