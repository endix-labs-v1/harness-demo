import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LinearTokens, makeLinear } from "../src/clients/linear";
import { loadSecrets } from "../src/core/secrets";
import { secretsLockPath } from "../src/core/paths";
import { testConfig } from "./helpers";

const config = testConfig();

function secretsFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "endix-lin-"));
  const f = join(dir, "secrets.env");
  writeFileSync(
    f,
    [
      "SLACK_TASK_MANAGER_BOT_TOKEN=slack-tm",
      "LINEAR_TASK_MANAGER_TOKEN=access-1",
      "LINEAR_TASK_MANAGER_TOKEN_REFRESH=refresh-1",
      "LINEAR_TASK_MANAGER_TOKEN_CLIENT_ID=cid",
      "LINEAR_TASK_MANAGER_TOKEN_CLIENT_SECRET=ckey",
      "OTHER=keep me",
      "",
    ].join("\n"),
  );
  chmodSync(f, 0o600);
  return f;
}

type Req = { url: string; init: RequestInit };
function fakeFetch(handler: (req: Req, i: number) => Response | Promise<Response>) {
  const calls: Req[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handler({ url, init }, calls.length - 1);
  }) as unknown as typeof fetch;
  return Object.assign(fn, { calls });
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });

afterEach(() => vi.useRealTimers());

describe("Linear client and token refresh (SEC §3)", () => {
  it("a 401: lock, re-read, refresh, both keys rewritten (mode 600, other lines kept), lock removed, then the retry", async () => {
    const f = secretsFile();
    const before = readFileSync(f, "utf8");
    const fetchImpl = fakeFetch(({ url, init }) => {
      if (url.endsWith("/oauth/token")) {
        expect(existsSync(secretsLockPath(f))).toBe(true);
        expect(String(init.body)).toContain("grant_type=refresh_token");
        expect(String(init.body)).toContain("refresh_token=refresh-1");
        return json({ access_token: "access-2", refresh_token: "refresh-2", expires_in: 86400 });
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === "Bearer access-1" ? new Response("", { status: 401 }) : json({ data: { viewer: { id: "1", name: "Task manager (demo)" } } });
    });
    const secrets = loadSecrets(f);
    const tokens = new LinearTokens(f, secrets, fetchImpl);
    const linear = makeLinear("task-manager", secrets, config, { dryRun: false, tokens, fetch: fetchImpl });
    expect(await linear("query { viewer { id name } }")).toEqual({ viewer: { id: "1", name: "Task manager (demo)" } });
    tokens.stop();
    expect(fetchImpl.calls.map((c) => c.url)).toEqual(["https://api.linear.app/graphql", "https://api.linear.app/oauth/token", "https://api.linear.app/graphql"]);
    const after = readFileSync(f, "utf8");
    expect(after).toBe(before.replace("=access-1", "=access-2").replace("=refresh-1", "=refresh-2"));
    expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(existsSync(secretsLockPath(f))).toBe(false);
  });

  it("a file whose token changed (another process refreshed) is taken with no refresh", async () => {
    const f = secretsFile();
    const secrets = loadSecrets(f);
    writeFileSync(f, readFileSync(f, "utf8").replace("=access-1", "=access-other"));
    const fetchImpl = fakeFetch(({ url, init }) => {
      if (url.endsWith("/oauth/token")) throw new Error("must not refresh");
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === "Bearer access-1" ? new Response("", { status: 401 }) : json({ data: { ok: auth } });
    });
    const tokens = new LinearTokens(f, secrets, fetchImpl);
    const linear = makeLinear("task-manager", secrets, config, { dryRun: false, tokens, fetch: fetchImpl });
    expect(await linear("query Ok { ok }")).toEqual({ ok: "Bearer access-other" });
  });

  it("two bots on one <APP> make one refresh; the start refresh schedules the next at half of expires_in", async () => {
    vi.useFakeTimers({ now: Date.now() });
    const f = secretsFile();
    let refreshes = 0;
    const fetchImpl = fakeFetch(async () => {
      refreshes += 1;
      return json({ access_token: `access-${refreshes + 1}`, refresh_token: `refresh-${refreshes + 1}`, expires_in: 3600 });
    });
    const tokens = new LinearTokens(f, loadSecrets(f), fetchImpl);
    await Promise.all([tokens.refresh("TASK_MANAGER"), tokens.refresh("TASK_MANAGER")]);
    expect(refreshes).toBe(1);
    await vi.advanceTimersByTimeAsync(1_799_000);
    expect(refreshes).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(refreshes).toBe(2);
    tokens.stop();
    expect(loadSecrets(f).LINEAR_TASK_MANAGER_TOKEN).toBe("access-3");
  });

  it("a failed refresh gives the make linear-auth message and leaves the file and the lock as they were", async () => {
    const f = secretsFile();
    const before = readFileSync(f, "utf8");
    const fetchImpl = fakeFetch(() => new Response("bad", { status: 400 }));
    const tokens = new LinearTokens(f, loadSecrets(f), fetchImpl);
    await expect(tokens.refresh("TASK_MANAGER")).rejects.toThrow(
      "Linear token for task-manager expired and the refresh failed: 400. Run make linear-auth BOT=task-manager (PPL §1.2).",
    );
    expect(readFileSync(f, "utf8")).toBe(before);
    expect(existsSync(secretsLockPath(f))).toBe(false);
  });
});
