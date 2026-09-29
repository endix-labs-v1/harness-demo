import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));

export function endixHome(): string {
  return process.env.ENDIX_HOME || join(homedir(), ".endix-demo");
}

export function secretsPath(): string {
  return process.env.ENDIX_SECRETS || join(homedir(), ".config", "endix-demo", "secrets.env");
}

/** `.secrets.lock` in the folder of the secrets file (SEC §3). */
export function secretsLockPath(path: string = secretsPath()): string {
  return join(dirname(path), ".secrets.lock");
}

export function configPath(): string {
  return process.env.DEMO_CONFIG || join(homedir(), "github", "endix-demo-kit", "config", "demo.config.json");
}

/** The repo's `bots/` folder: src/core -> src -> runtime -> bots. */
export function botsDir(): string {
  return process.env.ENDIX_BOTS_DIR || resolve(HERE, "..", "..", "..");
}

export function logsDir(): string {
  return join(endixHome(), "logs");
}

export function seenFile(): string {
  return join(endixHome(), "seen.jsonl");
}

export function stopFile(): string {
  return join(endixHome(), "STOP");
}

export function heartbeatFile(): string {
  return join(endixHome(), "heartbeat.json");
}

export function runsDir(): string {
  return join(endixHome(), "runs");
}

/** A missing folder is made before each write, not only on first use (Req 3). */
export function ensureDirFor(file: string): void {
  mkdirSync(dirname(file), { recursive: true });
}
