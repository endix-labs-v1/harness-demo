import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startChecks, StartError, W21_MESSAGE, type StartProbes } from "../src/core/start";
import { LinearTokens } from "../src/clients/linear";
import { fakeToken } from "./helpers";

const ROOT = resolve(__dirname, "..");
const TSX = join(ROOT, "node_modules", ".bin", "tsx");

function secretsFile(extra: Record<string, string> = {}, drop: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "endix-secrets-"));
  const file = join(dir, "secrets.env");
  const keys: Record<string, string> = {
    SLACK_LIGHTHOUSE_BOT_TOKEN: fakeToken("xox", "b-", "0001"),
    SLACK_LIGHTHOUSE_APP_TOKEN: fakeToken("xa", "pp-", "0002"),
    LINEAR_LIGHTHOUSE_TOKEN: fakeToken("lin", "_oauth_", "0003"),
    LINEAR_LIGHTHOUSE_TOKEN_REFRESH: "refresh-0004",
    LINEAR_LIGHTHOUSE_TOKEN_CLIENT_ID: "client-0005",
    LINEAR_LIGHTHOUSE_TOKEN_CLIENT_SECRET: "client-key-0006",
    NOTION_READER_TOKEN: fakeToken("nt", "n_", "0007"),
    SLACK_TASK_MANAGER_BOT_TOKEN: fakeToken("xox", "b-", "0011"),
    SLACK_TASK_MANAGER_APP_TOKEN: fakeToken("xa", "pp-", "0012"),
    LINEAR_TASK_MANAGER_TOKEN: fakeToken("lin", "_oauth_", "0013"),
    LINEAR_TASK_MANAGER_TOKEN_REFRESH: "refresh-0014",
    LINEAR_TASK_MANAGER_TOKEN_CLIENT_ID: "client-0015",
    LINEAR_TASK_MANAGER_TOKEN_CLIENT_SECRET: "client-key-0016",
    SLACK_DOC_MANAGER_BOT_TOKEN: fakeToken("xox", "b-", "0021"),
    SLACK_DOC_MANAGER_APP_TOKEN: fakeToken("xa", "pp-", "0022"),
    NOTION_DOC_MANAGER_TOKEN: fakeToken("nt", "n_", "0023"),
    LINEAR_CHECKER_TOKEN: fakeToken("lin", "_oauth_", "0031"),
    LINEAR_CHECKER_TOKEN_REFRESH: "refresh-0032",
    LINEAR_CHECKER_TOKEN_CLIENT_ID: "client-0033",
    LINEAR_CHECKER_TOKEN_CLIENT_SECRET: "client-key-0034",
    ...extra,
  };
  for (const d of drop) delete keys[d];
  writeFileSync(file, Object.entries(keys).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  chmodSync(file, 0o600);
  return file;
}

const USERS: Record<string, { user_id: string; user: string; bot_id: string }> = {
  "0001": { user_id: "U_LH", user: "lighthouse", bot_id: "B_LH" },
  "0011": { user_id: "U_TM", user: "task_manager", bot_id: "B_TM" },
  "0021": { user_id: "U_DM", user: "doc_manager", bot_id: "B_DM" },
};

const probes: StartProbes = {
  async slackAuth(token) {
    return USERS[token.slice(-4)];
  },
  async linearViewer(bot) {
    return bot === "doc-manager" ? "Checker (demo)" : `${bot} (demo)`;
  },
  async notionMe(token) {
    return token.endsWith("0023") ? "Endix doc manager (demo)" : "Endix readers (demo)";
  },
  async githubRepo() {},
};

const okFetch = (async () =>
  new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 86400 }), { status: 200 })) as typeof fetch;

const saved = process.env.ENDIX_SECRETS;
afterEach(() => {
  process.env.ENDIX_SECRETS = saved;
});

describe("start (SYS §4.1)", () => {
  it("T-R-1: ANTHROPIC_API_KEY set: exit 2, stderr is exactly the W-21 line, nothing else read (bots, checker, replay)", () => {
    const env = { ...process.env, ANTHROPIC_API_KEY: "x", ENDIX_SECRETS: "/nonexistent/secrets.env", DEMO_CONFIG: "/nonexistent/demo.config.json" };
    for (const args of [["src/cli/bots.ts"], ["src/cli/checker.ts", "--once"], ["src/cli/replay.ts", "test/fixtures/replay/sample.json"]]) {
      const r = spawnSync(TSX, args, { cwd: ROOT, env, encoding: "utf8" });
      expect(r.status, args.join(" ")).toBe(2);
      expect(r.stderr).toBe(`${W21_MESSAGE}\n`);
      expect(r.stdout).toBe("");
    }
    const empty = spawnSync(TSX, ["src/cli/bots.ts"], { cwd: ROOT, env: { ...env, ANTHROPIC_API_KEY: "" }, encoding: "utf8" });
    expect(empty.status).toBe(2);
    expect(W21_MESSAGE).toBe("Refused to start (W-21, SEC §4): ANTHROPIC_API_KEY is set. The demo runs on the Claude plan login only.");
  });

  it("T-R-2: a selected bot's key missing: exit 1, the message names the key", async () => {
    process.env.ENDIX_SECRETS = secretsFile({}, ["SLACK_LIGHTHOUSE_APP_TOKEN"]);
    const err = await startChecks({ only: ["lighthouse"], probes, fetch: okFetch, out: () => undefined, err: () => undefined }).catch((e) => e);
    expect(err).toBeInstanceOf(StartError);
    expect(err.code).toBe(1);
    expect(err.message).toBe(`Missing secret SLACK_LIGHTHOUSE_APP_TOKEN for lighthouse in ${process.env.ENDIX_SECRETS}. Paste it with make secrets (PPL §1).`);
  });

  it("T-R-2 (cli): unknown --only name exits 1 with the list of bots", () => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    const r = spawnSync(TSX, ["src/cli/bots.ts", "--only", "nobody"], { cwd: ROOT, env, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toBe('Unknown bot "nobody". Bots: lighthouse, task-manager, doc-manager, question-idea, checker.\n');
  });

  it("T-R-3: all mocks: the header line and one row per bot", async () => {
    process.env.ENDIX_SECRETS = secretsFile();
    const lines: string[] = [];
    const tokens = new LinearTokens(process.env.ENDIX_SECRETS!, {}, okFetch);
    const r = await startChecks({ only: ["lighthouse", "task-manager", "doc-manager"], probes, tokens, out: (l) => lines.push(l), err: () => undefined });
    tokens.stop();
    expect(lines[0]).toBe("bot · slack user · linear app · notion integration · tools");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe("lighthouse · lighthouse (U_LH) · lighthouse (demo) · Endix readers (demo) · 6 tools: read_thread, linear_get, linear_find, notion_search, notion_read, steps");
    expect(lines[2]).toBe("task-manager · task_manager (U_TM) · task-manager (demo) · - · 4 tools: read_thread, linear_get, linear_find, steps");
    expect(lines[3]).toBe("doc-manager · doc_manager (U_DM) · Checker (demo) (reader) · Endix doc manager (demo) · 3 tools: read_thread, notion_search, notion_read");
    expect(r.botIds).toEqual({ B_LH: "Lighthouse", B_TM: "Task manager", B_DM: "Doc manager" });
  });
});
