import type { DemoConfig } from "../core/config";
import { loadSecrets, withSecretsLock, type Secrets } from "../core/secrets";
import { redact } from "../core/redact";
import { DryRunWriteError, type ToolContext } from "../tools/define";

export class LinearError extends Error {
  code: string | null;
  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = "LinearError";
    this.code = code;
  }
}

type Fetch = typeof fetch;

const APP_BOT: Record<string, string> = {
  LIGHTHOUSE: "lighthouse",
  TASK_MANAGER: "task-manager",
  QUESTION_IDEA: "question-idea",
  CHECKER: "checker",
};

/** The `<APP>` whose token a bot uses (the doc manager reads with the checker's). */
export function linearAppFor(bot: string): "LIGHTHOUSE" | "TASK_MANAGER" | "QUESTION_IDEA" | "CHECKER" | null {
  switch (bot) {
    case "lighthouse":
      return "LIGHTHOUSE";
    case "task-manager":
      return "TASK_MANAGER";
    case "question-idea":
      return "QUESTION_IDEA";
    case "checker":
    case "doc-manager":
      return "CHECKER";
    default:
      return null;
  }
}

const TOKEN_URL = "https://api.linear.app/oauth/token";
const GRAPHQL_URL = "https://api.linear.app/graphql";

/**
 * One entry per `<APP>` for the whole process, shared by every bot that uses it; at
 * most one refresh at a time per `<APP>` (a refresh token works once). Each refresh
 * runs inside the SEC §3 lock, from the re-read to the rename (Req 19).
 */
export class LinearTokens {
  private tokens = new Map<string, string>();
  private inflight = new Map<string, Promise<string>>();
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private path: string,
    private secrets: Secrets,
    private fetchImpl: Fetch = fetch,
  ) {}

  redactionValues(): string[] {
    return [...Object.values(this.secrets), ...this.tokens.values()];
  }

  token(app: string): string {
    const t = this.tokens.get(app) ?? this.secrets[`LINEAR_${app}_TOKEN`];
    if (!t) throw new Error(`Missing secret LINEAR_${app}_TOKEN in ${this.path}.`);
    return t;
  }

  /** Refresh under the lock; concurrent callers for one `<APP>` share one refresh. */
  refresh(app: string): Promise<string> {
    const running = this.inflight.get(app);
    if (running) return running;
    const p = this.doRefresh(app).finally(() => this.inflight.delete(app));
    this.inflight.set(app, p);
    return p;
  }

  /** On a 401: take the file's token when another process just refreshed, else refresh. */
  async recover(app: string, used: string): Promise<string> {
    const running = this.inflight.get(app);
    if (running) return running;
    let fresh: string | null = null;
    await withSecretsLock(this.path, (current) => {
      const onFile = current[`LINEAR_${app}_TOKEN`];
      if (onFile && onFile !== used) fresh = onFile;
      return null;
    });
    if (fresh) {
      this.tokens.set(app, fresh);
      return fresh;
    }
    return this.refresh(app);
  }

  private async doRefresh(app: string): Promise<string> {
    const bot = APP_BOT[app] ?? app.toLowerCase();
    let expiresIn: number | null = null;
    let access = "";
    let status = "no response";
    await withSecretsLock(this.path, async (current) => {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: current[`LINEAR_${app}_TOKEN_REFRESH`] ?? "",
        client_id: current[`LINEAR_${app}_TOKEN_CLIENT_ID`] ?? "",
        client_secret: current[`LINEAR_${app}_TOKEN_CLIENT_SECRET`] ?? "",
      });
      let res: Response;
      try {
        res = await this.fetchImpl(TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
          signal: AbortSignal.timeout(20_000),
        });
      } catch (e) {
        status = (e as Error).name === "TimeoutError" ? "timeout" : "network error";
        throw new Error(status);
      }
      status = String(res.status);
      if (!res.ok) throw new Error(status);
      const json = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!json.access_token || !json.refresh_token) throw new Error(`${status} without tokens`);
      access = json.access_token;
      expiresIn = typeof json.expires_in === "number" ? json.expires_in : null;
      return { [`LINEAR_${app}_TOKEN`]: json.access_token, [`LINEAR_${app}_TOKEN_REFRESH`]: json.refresh_token };
    }).catch((e) => {
      if ((e as Error).name === "SecretsLockError") throw e;
      throw new Error(`Linear token for ${bot} expired and the refresh failed: ${status}. Run make linear-auth BOT=${bot} (PPL §1.2).`);
    });
    this.tokens.set(app, access);
    this.secrets = { ...this.secrets, [`LINEAR_${app}_TOKEN`]: access };
    this.schedule(app, expiresIn);
    return access;
  }

  /** The next refresh at half of `expires_in` (12 h without it), on an unref'd timer. */
  private schedule(app: string, expiresIn: number | null): void {
    const old = this.timers.get(app);
    if (old) clearTimeout(old);
    const ms = expiresIn ? (expiresIn * 1000) / 2 : 12 * 60 * 60 * 1000;
    const t = setTimeout(() => {
      this.refresh(app).catch((e) => process.stderr.write(`${redact((e as Error).message, this.redactionValues())}\n`));
    }, ms);
    t.unref?.();
    this.timers.set(app, t);
  }

  stop(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}

export type LinearFn = (query: string, variables?: Record<string, unknown>) => Promise<any>;

function isMutation(query: string): boolean {
  const first = query.replace(/#[^\n]*\n/g, " ").trim().split(/[\s({]/)[0];
  return first === "mutation";
}

/** `linear(query, variables)` on the bot's token, with the 401 path and the dry-run net. */
export function makeLinear(
  bot: string,
  secrets: Secrets,
  config: DemoConfig,
  opts: { dryRun: boolean; tokens?: LinearTokens; path?: string; fetch?: Fetch },
): LinearFn {
  const app = linearAppFor(bot);
  const fetchImpl = opts.fetch ?? fetch;
  const tokens = opts.tokens ?? new LinearTokens(opts.path ?? "", secrets, fetchImpl);
  void config;
  const post = async (token: string, query: string, variables?: Record<string, unknown>) =>
    fetchImpl(GRAPHQL_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: variables ?? {} }),
    });
  return async (query, variables) => {
    if (!app) throw new LinearError(`${bot} has no Linear token`);
    if (opts.dryRun && isMutation(query)) throw new DryRunWriteError("dry run: linear mutation blocked");
    let token = tokens.token(app);
    let res = await post(token, query, variables);
    let json = res.status === 401 ? null : ((await res.json()) as any);
    const authError = (j: any) => Array.isArray(j?.errors) && j.errors.some((e: any) => e?.extensions?.code === "AUTHENTICATION_ERROR");
    if (res.status === 401 || authError(json)) {
      token = await tokens.recover(app, token);
      res = await post(token, query, variables);
      json = (await res.json()) as any;
    }
    if (Array.isArray(json?.errors) && json.errors.length) {
      const e = json.errors[0];
      throw new LinearError(e?.message ?? "Linear error", e?.extensions?.code ?? null);
    }
    return json?.data;
  };
}

export const ISSUE_FIELDS =
  "id identifier title url description dueDate state { name } labels { nodes { name } } assignee { name } parent { identifier title } children { nodes { identifier title state { name } } } relations { nodes { type relatedIssue { identifier title state { name } } } } attachments { nodes { title url } } project { id name }";

export async function getIssue(ctx: Pick<ToolContext, "linear"> & { reads?: ToolContext["reads"] }, key: string): Promise<any | null> {
  if (ctx.reads?.linear_get && key in ctx.reads.linear_get) return ctx.reads.linear_get[key];
  try {
    const data = await ctx.linear(`query Issue($key: String!) { issue(id: $key) { ${ISSUE_FIELDS} } }`, { key });
    return data?.issue ?? null;
  } catch (e) {
    if (e instanceof LinearError && /not found|entity/i.test(e.message)) return null;
    throw e;
  }
}

export async function findIssues(
  ctx: Pick<ToolContext, "linear" | "config">,
  filter: { label?: string; state?: string; due_on_or_before?: string; title_contains?: string },
): Promise<any[]> {
  const f: Record<string, unknown> = { project: { id: { eq: ctx.config.linear.project_id } } };
  if (filter.label) f.labels = { name: { eq: filter.label } };
  if (filter.state) f.state = { name: { eq: filter.state } };
  if (filter.due_on_or_before) f.dueDate = { lte: filter.due_on_or_before };
  if (filter.title_contains) f.title = { containsIgnoreCase: filter.title_contains };
  const data = await ctx.linear(`query FindIssues($filter: IssueFilter) { issues(filter: $filter, first: 50) { nodes { ${ISSUE_FIELDS} } } }`, { filter: f });
  return data?.issues?.nodes ?? [];
}

/** Re-read helper for tests and start: the secrets as the file holds them now. */
export function currentSecrets(path: string): Secrets {
  return loadSecrets(path);
}
