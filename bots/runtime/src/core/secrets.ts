import { closeSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync, chmodSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parse } from "dotenv";
import { secretsLockPath, secretsPath } from "./paths";

export type Secrets = Record<string, string>;

export class SecretsLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsLockError";
  }
}

/**
 * Reads the whole file with dotenv.parse (never dotenv.config): no secret goes into
 * process.env, so the Agent SDK's child process inherits none (Req 4).
 */
export function loadSecrets(path: string = secretsPath()): Secrets {
  let mode: number;
  try {
    mode = statSync(path).mode & 0o777;
  } catch {
    throw new Error(`Missing secrets file ${path}. Paste the keys with make secrets (PPL §1).`);
  }
  if (mode !== 0o600) {
    throw new Error(`secrets.env must have mode 600; it has ${mode.toString(8)}. Run chmod 600 ${path}.`);
  }
  return parse(readFileSync(path, "utf8"));
}

export function requireSecret(secrets: Secrets, key: string, bot: string, path: string = secretsPath()): string {
  const v = secrets[key];
  if (!v) throw new Error(`Missing secret ${key} for ${bot} in ${path}. Paste it with make secrets (PPL §1).`);
  return v;
}

const LINEAR_EXTRAS = ["_REFRESH", "_CLIENT_ID", "_CLIENT_SECRET"];

function withLinear(keys: string[]): string[] {
  const out: string[] = [];
  for (const k of keys) {
    out.push(k);
    if (/^LINEAR_[A-Z_]+_TOKEN$/.test(k)) for (const x of LINEAR_EXTRAS) out.push(`${k}${x}`);
  }
  return out;
}

/** Keys per bot (Req 4): `required` stop start when missing; `optional` only warn. */
export function secretKeysFor(bot: string): { required: string[]; optional: string[] } {
  switch (bot) {
    case "lighthouse":
      return { required: withLinear(["SLACK_LIGHTHOUSE_BOT_TOKEN", "SLACK_LIGHTHOUSE_APP_TOKEN", "LINEAR_LIGHTHOUSE_TOKEN", "NOTION_READER_TOKEN"]), optional: [] };
    case "task-manager":
      return { required: withLinear(["SLACK_TASK_MANAGER_BOT_TOKEN", "SLACK_TASK_MANAGER_APP_TOKEN", "LINEAR_TASK_MANAGER_TOKEN"]), optional: [] };
    case "doc-manager":
      return { required: withLinear(["SLACK_DOC_MANAGER_BOT_TOKEN", "SLACK_DOC_MANAGER_APP_TOKEN", "NOTION_DOC_MANAGER_TOKEN", "LINEAR_CHECKER_TOKEN"]), optional: [] };
    case "question-idea":
      return { required: withLinear(["SLACK_QUESTION_IDEA_BOT_TOKEN", "SLACK_QUESTION_IDEA_APP_TOKEN", "LINEAR_QUESTION_IDEA_TOKEN", "NOTION_READER_TOKEN"]), optional: ["GITHUB_READ_TOKEN"] };
    case "checker":
      return { required: withLinear(["SLACK_CHECKER_BOT_TOKEN", "LINEAR_CHECKER_TOKEN", "NOTION_READER_TOKEN"]), optional: ["GITHUB_READ_TOKEN"] };
    default:
      throw new Error(`Unknown bot "${bot}".`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function replaceKeys(text: string, updates: Record<string, string>): string {
  const lines = text.split("\n");
  const done = new Set<string>();
  const out = lines.map((line) => {
    const m = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=)/.exec(line);
    if (m && m[2] in updates) {
      done.add(m[2]);
      return `${m[1]}${m[2]}${m[3]}${updates[m[2]]}`;
    }
    return line;
  });
  const missing = Object.keys(updates).filter((k) => !done.has(k));
  if (missing.length) {
    if (out.length && out[out.length - 1] === "") out.pop();
    for (const k of missing) out.push(`${k}=${updates[k]}`);
    out.push("");
  }
  return out.join("\n");
}

/**
 * The SEC §3 lock: create-exclusive `.secrets.lock`, 100 ms retries for up to 10 s,
 * a lock older than 60 s is stale; under it the file is re-read, `fn` names the keys
 * to write, and the new text goes through a temp file and a rename.
 */
export async function withSecretsLock(
  path: string,
  fn: (current: Secrets) => Promise<Record<string, string> | null | undefined> | Record<string, string> | null | undefined,
): Promise<Record<string, string> | null> {
  const lock = secretsLockPath(path);
  const mine = `${process.pid}\n`;
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      const fd = openSync(lock, "wx", 0o600);
      try {
        writeSync(fd, mine);
      } finally {
        closeSync(fd);
      }
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      let age = 0;
      try {
        age = Date.now() - statSync(lock).mtimeMs;
      } catch {
        continue; // removed in between: try again at once
      }
      if (age > 60_000) {
        try {
          unlinkSync(lock);
        } catch {
          /* another writer removed it first */
        }
        continue;
      }
      if (Date.now() >= deadline) throw new SecretsLockError(`Could not take ${lock} within 10 s; nothing written.`);
      await sleep(100);
    }
  }
  try {
    const text = readFileSync(path, "utf8");
    const updates = await fn(parse(text));
    if (!updates || Object.keys(updates).length === 0) return null;
    const tmp = join(dirname(path), `${basename(path)}.${process.pid}.tmp`);
    writeFileSync(tmp, replaceKeys(text, updates), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
    return updates;
  } finally {
    try {
      if (readFileSync(lock, "utf8") === mine) unlinkSync(lock);
    } catch {
      /* already gone */
    }
  }
}

export function rewriteSecrets(path: string, updates: Record<string, string>): Promise<Record<string, string> | null> {
  return withSecretsLock(path, () => updates);
}
