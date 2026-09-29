import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WebClient, LogLevel } from "@slack/web-api";
import { Client } from "@notionhq/client";
import type { BotDef, BotName } from "../bots/types";
import { BOT_NAMES } from "../bots/types";
import { BOTS } from "../bots/registry";
import { ALWAYS_NEEDED, loadConfig, requireConfig, type DemoConfig } from "./config";
import { botsDir, configPath, secretsPath } from "./paths";
import { loadSecrets, secretKeysFor, type Secrets } from "./secrets";
import { redact } from "./redact";
import { LinearTokens, linearAppFor, makeLinear } from "../clients/linear";
import { toolsFor } from "../agent/run";

export const W21_MESSAGE = "Refused to start (W-21, SEC §4): ANTHROPIC_API_KEY is set. The demo runs on the Claude plan login only.";

export class StartError extends Error {
  code: number;
  constructor(message: string, code = 1) {
    super(message);
    this.name = "StartError";
    this.code = code;
  }
}

/** W-21: the first start step, before anything else is read (any value, empty included). */
export function refuseApiKey(env: NodeJS.ProcessEnv = process.env): void {
  if (Object.prototype.hasOwnProperty.call(env, "ANTHROPIC_API_KEY")) throw new StartError(W21_MESSAGE, 2);
}

export function parseOnly(value: string | undefined): BotName[] {
  if (!value) return [...BOT_NAMES];
  const names = value.split(",").map((s) => s.trim()).filter(Boolean);
  for (const n of names) {
    if (!(BOT_NAMES as string[]).includes(n)) throw new StartError(`Unknown bot "${n}". Bots: ${BOT_NAMES.join(", ")}.`, 1);
  }
  return BOT_NAMES.filter((b) => names.includes(b));
}

export interface StartProbes {
  slackAuth(token: string): Promise<{ user_id: string; user: string; bot_id?: string }>;
  linearViewer(bot: string, secrets: Secrets, config: DemoConfig, tokens: LinearTokens): Promise<string>;
  notionMe(token: string): Promise<string>;
  githubRepo(token: string, repo: string): Promise<void>;
}

export const LIVE_PROBES: StartProbes = {
  async slackAuth(token) {
    const r = (await new WebClient(token, { logLevel: LogLevel.ERROR }).auth.test()) as { user_id?: string; user?: string; bot_id?: string };
    return { user_id: r.user_id ?? "", user: r.user ?? "", bot_id: r.bot_id };
  },
  async linearViewer(bot, secrets, config, tokens) {
    const data = await makeLinear(bot, secrets, config, { dryRun: true, tokens })("query { viewer { id name } }");
    return data?.viewer?.name ?? "?";
  },
  async notionMe(token) {
    const me = (await new Client({ auth: token, notionVersion: "2025-09-03" }).users.me({})) as { name?: string };
    return me.name ?? "?";
  },
  async githubRepo(token, repo) {
    const r = await fetch(`https://api.github.com/repos/${repo}`, { headers: { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" } });
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
  },
};

export interface StartResult {
  secrets: Secrets;
  config: DemoConfig;
  tokens: LinearTokens;
  /** bot_id → display name, from each bot's auth.test. */
  botIds: Record<string, string>;
  bots: BotName[];
  table: string[];
}

const TASK_FOR: Record<string, string> = { "steps.json": "T6", "question-idea.md": "T9", "checker.md": "T9", "shared-rules.md": "T5" };

/** SYS §4.1 start, in order, stopping at the first failure (Req 6). */
export async function startChecks(opts: {
  only?: BotName[];
  dryRun?: boolean;
  probes?: StartProbes;
  tokens?: LinearTokens;
  fetch?: typeof fetch;
  out?: (line: string) => void;
  err?: (line: string) => void;
}): Promise<StartResult> {
  refuseApiKey();
  const out = opts.out ?? ((l: string) => process.stdout.write(`${l}\n`));
  const err = opts.err ?? ((l: string) => process.stderr.write(`${l}\n`));
  const bots = opts.only ?? [...BOT_NAMES];
  const path = secretsPath();
  let secrets: Secrets;
  let config: DemoConfig;
  try {
    secrets = loadSecrets(path);
  } catch (e) {
    throw new StartError((e as Error).message, 1);
  }
  const redactionValues = Object.values(secrets);
  let githubWarned = false;
  for (const bot of bots) {
    const { required, optional } = secretKeysFor(bot);
    for (const k of required) if (!secrets[k]) throw new StartError(`Missing secret ${k} for ${bot} in ${path}. Paste it with make secrets (PPL §1).`, 1);
    for (const k of optional) {
      if (!secrets[k] && k === "GITHUB_READ_TOKEN" && !githubWarned) {
        err(`GITHUB_READ_TOKEN is not in ${path} yet (PPL §2.6); github_read returns an error until it is.`);
        githubWarned = true;
      }
    }
  }
  try {
    config = loadConfig(configPath());
    requireConfig(config, ALWAYS_NEEDED, configPath());
  } catch (e) {
    throw new StartError((e as Error).message, 1);
  }

  const dir = botsDir();
  const files: string[] = [join(dir, "data", "shared-rules.md"), join(dir, "data", "steps.json"), ...bots.map((b) => join(dir, BOTS[b].promptFile))];
  for (const f of files) {
    const name = f.split("/").pop() ?? f;
    if (!existsSync(f)) throw new StartError(`Missing ${f} (${TASK_FOR[name] ?? "T6 to T9"}).`, 1);
  }
  try {
    JSON.parse(readFileSync(join(dir, "data", "steps.json"), "utf8"));
  } catch (e) {
    throw new StartError(`Missing ${join(dir, "data", "steps.json")} (T6): it does not parse as JSON.`, 1);
  }

  const probes = opts.probes ?? LIVE_PROBES;
  const tokens = opts.tokens ?? new LinearTokens(path, secrets, opts.fetch ?? fetch);
  const botIds: Record<string, string> = {};
  const table = ["bot · slack user · linear app · notion integration · tools"];
  const refreshed = new Set<string>();
  for (const bot of bots) {
    const def: BotDef = BOTS[bot];
    const fail = (check: string, e: unknown) =>
      new StartError(`Start failed: ${check} for ${bot}: ${redact((e as Error)?.message ?? String(e), [...redactionValues, ...tokens.redactionValues()])}.`, 1);
    let slackUser: { user_id: string; user: string; bot_id?: string };
    try {
      slackUser = await probes.slackAuth(secrets[def.secrets.slackBot]);
    } catch (e) {
      throw fail("Slack auth.test", e);
    }
    const want = (config.slack.bots as Record<string, { user_id?: string }>)[def.configKey]?.user_id;
    if (slackUser.user_id !== want) throw new StartError(`Slack user for ${bot} is ${slackUser.user_id}; config says ${want}.`, 1);
    if (slackUser.bot_id) botIds[slackUser.bot_id] = def.displayName;

    let linearName = "-";
    const app = def.secrets.linear || def.secrets.linearReader ? linearAppFor(bot) : null;
    if (app) {
      if (!refreshed.has(app)) {
        try {
          await tokens.refresh(app);
        } catch (e) {
          throw fail("Linear token refresh", e);
        }
        refreshed.add(app);
      }
      try {
        const name = await probes.linearViewer(bot, secrets, config, tokens);
        linearName = def.secrets.linearReader ? `${name} (reader)` : name;
      } catch (e) {
        throw fail("Linear viewer", e);
      }
    }
    let notionName = "-";
    if (def.secrets.notion) {
      try {
        notionName = await probes.notionMe(secrets[def.secrets.notion]);
      } catch (e) {
        throw fail("Notion users.me", e);
      }
    }
    if (def.secrets.github && secrets[def.secrets.github]) {
      try {
        await probes.githubRepo(secrets[def.secrets.github], config.github.repo);
      } catch (e) {
        throw fail("GitHub repo", e);
      }
    }
    const tools = toolsFor(def).map((t) => t.name);
    table.push(`${bot} · ${slackUser.user} (${slackUser.user_id}) · ${linearName} · ${notionName} · ${tools.length} tools: ${tools.join(", ")}`);
  }
  for (const line of table) out(line);
  void opts.dryRun;
  return { secrets, config, tokens, botIds, bots, table };
}

/** Runs a CLI body: a StartError prints its message to stderr and exits with its code. */
export async function runCli(body: () => Promise<number | void>): Promise<void> {
  try {
    refuseApiKey();
    const code = await body();
    if (typeof code === "number") process.exitCode = code;
  } catch (e) {
    if (e instanceof StartError) {
      process.stderr.write(`${e.message}\n`);
      process.exit(e.code);
    }
    process.stderr.write(`${redact((e as Error)?.message ?? String(e))}\n`);
    process.exit(1);
  }
}
