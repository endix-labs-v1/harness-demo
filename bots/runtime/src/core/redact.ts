// Redaction (SEC §3, Req 22). Each prefix is written with a bracket so the secret scan
// never matches this source.
export const REDACTION_PATTERNS: RegExp[] = [
  /xox[abpe]-\S+/,
  /xap[p]-\S+/,
  /li[n]_(api|oauth)_\S+/,
  /nt[n]_\S+/,
  /secre[t]_\S+/,
  /gh[pous]_\S+/,
  /github_pa[t]_\S+/,
  /https:\/\/hooks[.]slack[.]com\/\S+/,
];

const GLOBAL = REDACTION_PATTERNS.map((p) => new RegExp(p.source, "g"));

export const REDACTED = "[redacted]";

function redactString(s: string, values: string[]): string {
  let out = s;
  for (const v of values) if (v) out = out.split(v).join(REDACTED);
  for (const p of GLOBAL) out = out.replace(p, REDACTED);
  return out;
}

/** Walks the value and redacts every string: each non-empty secret value (longest first), then each pattern. */
export function redact<T>(value: T, redactionValues: string[] = []): T {
  const values = [...new Set(redactionValues.filter((v) => v.length > 0))].sort((a, b) => b.length - a.length);
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return redactString(v, values);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = walk(x);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}
