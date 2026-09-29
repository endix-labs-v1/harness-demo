import type { ToolContext } from "../tools/define";

export interface GithubReader {
  read(path: string, ref?: string): Promise<{ path: string; sha: string; text: string; permalink_template: string }>;
}

export const GITHUB_MISSING = "GITHUB_READ_TOKEN is not set yet (PPL §2.6).";

/** Read-only GitHub (Req 21): the SHA a ref resolves to, then the file at that SHA. No write method. */
export function makeGithub(token: string, repo: string, fetchImpl: typeof fetch = fetch): GithubReader {
  const headers = { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" };
  return {
    async read(path, ref = "main") {
      const c = await fetchImpl(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`, { headers: { ...headers, Accept: "application/vnd.github+json" } });
      if (!c.ok) throw new Error(`GitHub ${c.status} for ${repo}@${ref}`);
      const sha = ((await c.json()) as { sha: string }).sha;
      const clean = path.replace(/^\/+/, "");
      const f = await fetchImpl(`https://api.github.com/repos/${repo}/contents/${clean}?ref=${sha}`, { headers: { ...headers, Accept: "application/vnd.github.raw+json" } });
      if (!f.ok) throw new Error(`GitHub ${f.status} for ${clean}@${sha}`);
      const text = await f.text();
      return { path: clean, sha, text, permalink_template: `https://github.com/${repo}/blob/${sha}/${clean}#L{a}-L{b}` };
    },
  };
}

export async function githubRead(ctx: Pick<ToolContext, "github">, path: string, ref = "main") {
  if (!ctx.github) return { error: GITHUB_MISSING };
  return ctx.github.read(path, ref);
}
