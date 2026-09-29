// The umbrella description (SYS §6.1) and the lightmap reply (DICT §2, SYS §6.5).
import { stepRow, type StepsCatalogue } from "./catalogue";

export interface LightmapInput {
  task_row: string;
  steps: string[];
  read_first: string[];
  outputs: string[];
  closes_when: string;
}

export interface DescriptionInput {
  variant: string;
  asker: string;
  today: string;
  thread_permalink: string;
  source?: string;
  origin_key?: string;
  waits_on?: string;
  rule_id?: string;
  lightmap: LightmapInput;
}

/** The lines from `Flow:` to `Closes when:` (SYS §6.1). */
export function lightmapLines(cat: StepsCatalogue, d: DescriptionInput): string[] {
  const name = cat.variants[d.variant]?.name ?? d.variant;
  const lines = [`Flow: ${d.variant} · ${name} · Task row: ${d.lightmap.task_row}`];
  if (d.rule_id) lines.push(`Rule in force: ${d.rule_id}`);
  lines.push("Steps:");
  for (const id of d.lightmap.steps) {
    const row = stepRow(cat, d.variant, id);
    lines.push(`- ${id} · ${row?.who ?? ""} · ${row?.does ?? ""}`);
  }
  lines.push(`Read first: ${d.lightmap.read_first.join("; ")}`);
  lines.push(`Outputs land in: ${d.lightmap.outputs.join("; ")}`);
  lines.push(`Closes when: ${d.lightmap.closes_when}`);
  return lines;
}

/** The umbrella description, exactly SYS §6.1; ends with the `Closes when:` line and a newline. */
export function buildDescription(cat: StepsCatalogue, d: DescriptionInput): string {
  const head = [`Thread: ${d.thread_permalink}`, `Source: ${d.asker} · ${d.today}${d.source ? ` · ${d.source}` : ""}`];
  if (d.origin_key) head.push(`Origin: ${d.origin_key}`);
  if (d.waits_on) head.push(`Waits on: ${d.waits_on}`);
  return [...head, "", "## Lightmap", "", ...lightmapLines(cat, d)].join("\n") + "\n";
}

/** The lightmap reply (DICT §2): `<url|key> · variant · ask`, then the lines from `Flow:` down. No trailing newline. */
export function buildLightmapReply(cat: StepsCatalogue, d: DescriptionInput & { key: string; url: string; ask: string }): string {
  return [`<${d.url}|${d.key}> · ${d.variant} · ${d.ask}`, ...lightmapLines(cat, d)].join("\n");
}
