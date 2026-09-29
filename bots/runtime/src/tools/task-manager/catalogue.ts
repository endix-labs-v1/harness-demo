import { readFileSync } from "node:fs";
import { join } from "node:path";
import { botsDir } from "../../core/paths";

// The step catalogue's `sub_issue` flags (T7 Spec Req 4; T6 Spec Req 2 and 3).

interface CatStep {
  id: string;
  sub_issue?: boolean;
  output?: string | null;
}
interface CatVariant {
  steps?: CatStep[];
  includes?: string[];
}
interface Catalogue {
  variants?: Record<string, CatVariant>;
}

export function defaultStepsPath(): string {
  return join(botsDir(), "data", "steps.json");
}

function load(path: string): Catalogue {
  return JSON.parse(readFileSync(path, "utf8")) as Catalogue;
}

function findStep(cat: Catalogue, variant: string, stepId: string, seen = new Set<string>()): CatStep | null {
  if (seen.has(variant)) return null;
  seen.add(variant);
  const v = cat.variants?.[variant];
  if (!v) return null;
  const own = (v.steps ?? []).find((s) => s.id === stepId);
  if (own) return own;
  for (const inc of v.includes ?? []) {
    const s = findStep(cat, inc, stepId, seen);
    if (s) return s;
  }
  return null;
}

/** The step's `sub_issue` in the variant or one of its `includes`; null when it isn't there. */
export function subIssueFlag(stepId: string, variant: string, path: string = defaultStepsPath()): boolean | null {
  const s = findStep(load(path), variant, stepId);
  if (!s) return null;
  return s.sub_issue === true;
}
