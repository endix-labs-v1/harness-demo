// The step catalogue (REF §3, T6 Spec Req 4): bots/data/steps.json, parsed strictly.
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { botsDir } from "../../core/paths";

const StepSchema = z
  .object({
    id: z.string().regex(/^OPS-F\d-\d{2}$/),
    who: z.string(),
    does: z.string(),
    output: z.string().nullable(),
    sub_issue: z.boolean(),
  })
  .strict();

const VariantSchema = z
  .object({
    name: z.string(),
    flow: z.string().regex(/^F\d$/),
    umbrella: z.boolean(),
    sub_issues: z.boolean(),
    includes: z.array(z.string()),
    steps: z.array(StepSchema).min(1),
  })
  .strict();

export const StepsCatalogueSchema = z
  .object({ source: z.string(), variants: z.record(z.string(), VariantSchema) })
  .strict()
  .superRefine((cat, ctx) => {
    for (const [key, v] of Object.entries(cat.variants)) {
      for (const inc of v.includes) {
        if (!(inc in cat.variants)) ctx.addIssue({ code: "custom", message: `${key} includes ${inc}, which is not a variant`, path: ["variants", key, "includes"] });
      }
    }
  });

export type StepsCatalogue = z.infer<typeof StepsCatalogueSchema>;
export type CatalogueStep = z.infer<typeof StepSchema>;

/** Reads bots/data/steps.json (a relative path is taken from the repo root, as `bots/` is). Throws on any failure. */
export function loadCatalogue(path?: string): StepsCatalogue {
  const file = path ? (isAbsolute(path) ? path : resolve(botsDir(), "..", path)) : join(botsDir(), "data", "steps.json");
  return StepsCatalogueSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

/** The variant's step IDs, then each included variant's, in order; [] for a variant not in the file. */
export function allowedSteps(cat: StepsCatalogue, variant: string): string[] {
  const v = cat.variants[variant];
  if (!v) return [];
  const out = v.steps.map((s) => s.id);
  for (const inc of v.includes) for (const s of cat.variants[inc]?.steps ?? []) out.push(s.id);
  return out;
}

/** The row of one step as the catalogue gives it for that variant (its own steps first, then its includes). */
export function stepRow(cat: StepsCatalogue, variant: string, id: string): CatalogueStep | undefined {
  const v = cat.variants[variant];
  if (!v) return undefined;
  return v.steps.find((s) => s.id === id) ?? v.includes.map((inc) => cat.variants[inc]?.steps.find((s) => s.id === id)).find(Boolean);
}
