// Start-time inputs of endix-entry-slack (T10 Spec Req 3; SYS §3, SEC §3).
// Paths come from the environment .mcp.json sets. The secrets file is read with
// dotenv.parse only, so no secret is ever put in process.env.
import { readFileSync, statSync } from "node:fs";
import { parse } from "dotenv";

/** The bots whose Slack user IDs the tools read (config `slack.bots.<key>.user_id`). */
export const BOT_KEYS = ["lighthouse", "task_manager", "doc_manager", "question_idea", "checker", "entry_agent"] as const;
export type BotKey = (typeof BOT_KEYS)[number];

/** The part of demo.config.json that endix-entry-slack reads. Unknown keys pass through. */
export interface EntryConfig {
  people: { henry: { slack_user_id: string } };
  slack: {
    channels: { lighthouse: string };
    bots: Record<BotKey, { user_id: string }> & { actions?: { bot_id?: string } };
  };
}

export const TOKEN_KEY = "SLACK_ENTRY_AGENT_BOT_TOKEN";

export class StartError extends Error {}

function missing(what: string, where: string): StartError {
  return new StartError(`endix-entry-slack: ${what} is missing (${where}).`);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Reads DEMO_CONFIG for the channel and user IDs. Only the lighthouse channel is needed at start. */
export function loadConfig(path: string): EntryConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw missing("DEMO_CONFIG", path);
  }
  const c = (raw ?? {}) as Record<string, any>;
  const lighthouse = str(c.slack?.channels?.lighthouse);
  if (!lighthouse) throw missing("slack.channels.lighthouse", path);
  const bots = {} as EntryConfig["slack"]["bots"];
  for (const key of BOT_KEYS) bots[key] = { user_id: str(c.slack?.bots?.[key]?.user_id) };
  bots.actions = { bot_id: str(c.slack?.bots?.actions?.bot_id) };
  return {
    ...c,
    people: { ...c.people, henry: { ...c.people?.henry, slack_user_id: str(c.people?.henry?.slack_user_id) } },
    slack: { ...c.slack, channels: { ...c.slack?.channels, lighthouse }, bots },
  } as EntryConfig;
}

/** Reads the Entry agent's bot token from the secrets file, which must have mode 600 (SEC §3). */
export function loadToken(path: string): string {
  let mode: number;
  try {
    mode = statSync(path).mode & 0o777;
  } catch {
    throw missing("ENDIX_SECRETS", path);
  }
  if (mode !== 0o600) {
    throw new StartError(
      `endix-entry-slack: secrets.env must have mode 600; it has ${mode.toString(8)}. Run chmod 600 ${path}.`,
    );
  }
  const token = parse(readFileSync(path, "utf8"))[TOKEN_KEY] ?? "";
  if (!token.trim()) throw missing(TOKEN_KEY, path);
  return token.trim();
}

/** Everything the server needs at start; throws StartError with the line to print. */
export function loadEnv(env: NodeJS.ProcessEnv): { config: EntryConfig; token: string } {
  const configPath = env.DEMO_CONFIG ?? "";
  if (!configPath) throw missing("DEMO_CONFIG", ".mcp.json");
  const secretsPath = env.ENDIX_SECRETS ?? "";
  if (!secretsPath) throw missing("ENDIX_SECRETS", ".mcp.json");
  const config = loadConfig(configPath);
  const token = loadToken(secretsPath);
  return { config, token };
}
