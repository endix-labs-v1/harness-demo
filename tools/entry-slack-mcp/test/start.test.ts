// T-EA-1 (TEST §2.2): the server starts from .mcp.json exactly as Claude Code spawns it,
// and lists its four tools. No Slack call is made at start, so the fake token is never sent.
import { execSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const pkg = fileURLToPath(new URL("..", import.meta.url));
const repo = fileURLToPath(new URL("../../..", import.meta.url));
const FIXTURE = join(pkg, "test", "fixtures", "demo.config.json");

// A fake token, joined from parts at run time so no file holds a token pattern (SEC §3).
const FAKE_TOKEN = ["xox", "b-", "0000", "-t-ea-1"].join("");

let home: string;

function makeHome(mode: number): string {
  const dir = mkdtempSync(join(tmpdir(), "t-ea-1-"));
  mkdirSync(join(dir, ".config", "endix-demo"), { recursive: true });
  mkdirSync(join(dir, "github", "endix-demo-kit", "config"), { recursive: true });
  const secrets = join(dir, ".config", "endix-demo", "secrets.env");
  writeFileSync(secrets, `SLACK_ENTRY_AGENT_BOT_TOKEN=${FAKE_TOKEN}\n`);
  chmodSync(secrets, mode);
  copyFileSync(FIXTURE, join(dir, "github", "endix-demo-kit", "config", "demo.config.json"));
  return dir;
}

type ServerEntry = { command: string; args: string[]; env: Record<string, string> };

function serverFromMcpJson(homeDir: string): ServerEntry {
  const mcp = JSON.parse(readFileSync(join(repo, ".mcp.json"), "utf8"));
  const s = mcp.mcpServers["endix-entry-slack"] as ServerEntry;
  const env = Object.fromEntries(Object.entries(s.env).map(([k, v]) => [k, v.replaceAll("${HOME}", homeDir)]));
  return { command: s.command, args: s.args, env };
}

beforeAll(() => {
  execSync("npm run build --silent", { cwd: pkg, stdio: ["ignore", "ignore", "inherit"] });
  home = makeHome(0o600);
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("endix-entry-slack start", () => {
  it("T-EA-1 spawned from .mcp.json, listTools returns exactly the four tools", async () => {
    const s = serverFromMcpJson(home);
    const transport = new StdioClientTransport({ command: s.command, args: s.args, env: s.env, cwd: repo, stderr: "pipe" });
    const client = new Client({ name: "t-ea-1", version: "1.0.0" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(["hand_off", "post_ask", "post_in_thread", "read_thread"]);
      expect(client.getServerVersion()?.name).toBe("endix-entry-slack");
    } finally {
      await client.close();
    }
  });

  it("through the protocol, a person line and another channel come back refused, before any Slack call", async () => {
    const s = serverFromMcpJson(home);
    const transport = new StdioClientTransport({ command: s.command, args: s.args, env: s.env, cwd: repo, stderr: "pipe" });
    const client = new Client({ name: "t-ea-1", version: "1.0.0" });
    await client.connect(transport);
    try {
      const lh = "https://endix-demo.slack.com/archives/C0C61PKP10Q/p1759370000000100";
      const ok = await client.callTool({ name: "post_in_thread", arguments: { permalink: lh, text: "OK" } });
      expect(ok.isError).toBe(true);
      expect(JSON.parse((ok.content as { text: string }[])[0].text)).toMatchObject({ refused: true, wall: "W-12" });
      const other = await client.callTool({
        name: "hand_off",
        arguments: {
          permalink: "https://endix-demo.slack.com/archives/C0C61PKLZT2/p1759370000000100",
          manager: "doc",
          step_id: "OPS-F1-13",
          what: "apply the draft above to Fee model",
          where: "Fee model",
        },
      });
      expect(JSON.parse((other.content as { text: string }[])[0].text)).toMatchObject({ refused: true, wall: "W-01" });
    } finally {
      await client.close();
    }
  });

  function start(env: Record<string, string>) {
    const s = serverFromMcpJson(home);
    return spawnSync(s.command, s.args, {
      cwd: repo,
      env: { PATH: process.env.PATH ?? "", HOME: home, ...env },
      input: "",
      encoding: "utf8",
      timeout: 20_000,
    });
  }

  it("a missing DEMO_CONFIG exits 1 with the missing line on stderr and nothing on stdout", () => {
    const r = start({ ENDIX_SECRETS: serverFromMcpJson(home).env.ENDIX_SECRETS });
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe("endix-entry-slack: DEMO_CONFIG is missing (.mcp.json).");
    expect(r.stdout).toBe("");
  });

  it("a secrets file without the Entry agent token exits 1 naming the key and the path", () => {
    const dir = makeHome(0o600);
    const env = serverFromMcpJson(dir).env;
    writeFileSync(env.ENDIX_SECRETS, "SLACK_CHECKER_BOT_TOKEN=x\n");
    const r = start(env);
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe(`endix-entry-slack: SLACK_ENTRY_AGENT_BOT_TOKEN is missing (${env.ENDIX_SECRETS}).`);
    rmSync(dir, { recursive: true, force: true });
  });

  it("a secrets file that isn't mode 600 stops the start and never prints the token", () => {
    const dir = makeHome(0o644);
    const env = serverFromMcpJson(dir).env;
    const r = start(env);
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe(
      `endix-entry-slack: secrets.env must have mode 600; it has 644. Run chmod 600 ${env.ENDIX_SECRETS}.`,
    );
    expect(r.stderr + r.stdout).not.toContain(FAKE_TOKEN);
    rmSync(dir, { recursive: true, force: true });
  });
});
