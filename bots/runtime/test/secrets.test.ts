import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";
import { loadSecrets, rewriteSecrets, SecretsLockError, withSecretsLock } from "../src/core/secrets";
import { secretsLockPath } from "../src/core/paths";

function file(): string {
  const dir = mkdtempSync(join(tmpdir(), "endix-sec-"));
  const f = join(dir, "secrets.env");
  writeFileSync(f, "# demo secrets\nA=1\nLINEAR_CHECKER_TOKEN=old\n\nLINEAR_CHECKER_TOKEN_REFRESH=r-old\nB=two words\n");
  chmodSync(f, 0o600);
  return f;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("secrets lock (SEC §3)", () => {
  it("creates .secrets.lock with wx and removes it; only the named keys change; mode 600; no .tmp left", async () => {
    const f = file();
    let sawLock = false;
    await withSecretsLock(f, (cur) => {
      sawLock = existsSync(secretsLockPath(f)) && readFileSync(secretsLockPath(f), "utf8") === `${process.pid}\n`;
      expect(cur.LINEAR_CHECKER_TOKEN).toBe("old");
      return { LINEAR_CHECKER_TOKEN: "new", LINEAR_CHECKER_TOKEN_REFRESH: "r-new" };
    });
    expect(sawLock).toBe(true);
    expect(existsSync(secretsLockPath(f))).toBe(false);
    expect(readFileSync(f, "utf8")).toBe("# demo secrets\nA=1\nLINEAR_CHECKER_TOKEN=new\n\nLINEAR_CHECKER_TOKEN_REFRESH=r-new\nB=two words\n");
    expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(f, "..")).filter((x) => x.endsWith(".tmp"))).toEqual([]);
    expect(loadSecrets(f).LINEAR_CHECKER_TOKEN).toBe("new");
  });

  it("waits while a fresh lock exists and writes once it is gone", async () => {
    const f = file();
    writeFileSync(secretsLockPath(f), "99999\n");
    setTimeout(() => rmSync(secretsLockPath(f)), 300);
    const t0 = Date.now();
    await rewriteSecrets(f, { A: "3" });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    expect(loadSecrets(f).A).toBe("3");
  });

  it("removes a lock file 61 s old and writes", async () => {
    const f = file();
    writeFileSync(secretsLockPath(f), "99999\n");
    const old = (Date.now() - 61_000) / 1000;
    utimesSync(secretsLockPath(f), old, old);
    await rewriteSecrets(f, { A: "4" });
    expect(loadSecrets(f).A).toBe("4");
    expect(existsSync(secretsLockPath(f))).toBe(false);
  });

  it("a fresh lock held for 10 s gives SecretsLockError and leaves the file unchanged (fake timers)", async () => {
    const f = file();
    const before = readFileSync(f, "utf8");
    writeFileSync(secretsLockPath(f), "99999\n");
    vi.useFakeTimers({ now: Date.now() });
    const p = rewriteSecrets(f, { A: "5" }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10_200);
    const err = await p;
    expect(err).toBeInstanceOf(SecretsLockError);
    expect(err.message).toBe(`Could not take ${secretsLockPath(f)} within 10 s; nothing written.`);
    expect(readFileSync(f, "utf8")).toBe(before);
    expect(readFileSync(secretsLockPath(f), "utf8")).toBe("99999\n");
  });

  it("a secrets file without mode 600 stops with the chmod line", () => {
    const f = file();
    chmodSync(f, 0o644);
    expect(() => loadSecrets(f)).toThrow(`secrets.env must have mode 600; it has 644. Run chmod 600 ${f}.`);
  });
});
