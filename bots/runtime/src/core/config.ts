import { readFileSync } from "node:fs";
import { z } from "zod";
import { configPath } from "./paths";

const s = () => z.string().default("");
const obj = <T extends z.ZodRawShape>(shape: T) => z.looseObject(shape).prefault({} as never);
const botId = () => obj({ user_id: s() });

/** Every key the runtime and the bots' tools read (SYS §3). Unknown keys pass through. */
export const DemoConfigSchema = z.looseObject({
  timezone: z.string().default("Asia/Seoul"),
  people: obj({
    henry: obj({ name: z.string().default("Henry"), slack_user_id: s(), linear_user_id: s(), notion_user_id: s() }),
  }),
  slack: obj({
    channels: obj({ lighthouse: s(), questions: s(), ideas: s(), build_test: s(), no_bots: s() }),
    bots: obj({
      lighthouse: botId(),
      task_manager: botId(),
      doc_manager: botId(),
      question_idea: botId(),
      checker: botId(),
      entry_agent: botId(),
      actions: obj({ bot_id: s() }),
    }),
  }),
  linear: obj({
    team_id: s(),
    project_id: s(),
    labels: obj({ Lightmap: s(), Later: s(), Question: s() }),
    states: obj({ Backlog: s(), Todo: s(), "In Progress": s(), "In Review": s(), Done: s(), Canceled: s() }),
  }),
  notion: obj({ docs_data_source: s(), call_log_data_source: s() }),
  github: obj({ repo: s() }),
  model: obj({ bots: z.string().default("sonnet") }),
  checker: obj({ schedule: z.string().default("0 9 * * *"), quiet_idea_days: z.number().default(14) }),
});

export type DemoConfig = z.infer<typeof DemoConfigSchema>;

/**
 * Reads `demo.config.json` (DEMO_CONFIG). The file may not exist yet (T2 writes it);
 * a missing or broken file is a clear one-line error, never a stack trace.
 */
export function loadConfig(path: string = configPath()): DemoConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`Missing config ${path} (T2's setup writes it; see bots/runtime/README shape in SYS §3).`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Config ${path} is not JSON: ${(e as Error).message}`);
  }
  const parsed = DemoConfigSchema.safeParse(json);
  if (!parsed.success) throw new Error(`Config ${path} is invalid: ${parsed.error.message}`);
  return parsed.data;
}

export function configValue(config: DemoConfig, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), config);
}

/** Start stops on an empty value it needs (Req 5). */
export function requireConfig(config: DemoConfig, keys: string[], path: string = configPath()): void {
  for (const k of keys) {
    const v = configValue(config, k);
    if (v === undefined || v === null || v === "") throw new Error(`Config ${k} is empty in ${path}. T2's setup fills it.`);
  }
}

export const ALWAYS_NEEDED = [
  "people.henry.slack_user_id",
  "slack.channels.lighthouse",
  "slack.channels.questions",
  "slack.channels.ideas",
  "slack.bots.lighthouse.user_id",
  "slack.bots.task_manager.user_id",
  "slack.bots.doc_manager.user_id",
  "slack.bots.question_idea.user_id",
  "slack.bots.checker.user_id",
  "slack.bots.entry_agent.user_id",
];
