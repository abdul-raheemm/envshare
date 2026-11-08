import { z } from "zod";
import { MAX_IMPORT_ENTRIES } from "@/lib/importLimits";

export const previewImportSchema = z.object({
  text: z.string().min(1, "Paste some .env text first"),
  autoFlagSensitive: z.boolean().default(false),
});

const tooManyKeys = (o: Record<string, unknown>) =>
  Object.keys(o).length <= MAX_IMPORT_ENTRIES;

export const applyImportSchema = z.object({
  text: z.string().min(1, "Paste some .env text first"),
  autoFlagSensitive: z.boolean().default(false),
  rowOverrides: z
    .record(
      z.string(),
      z.object({
        skip: z.boolean().optional(),
        isSensitive: z.boolean().optional(),
      })
    )
    .refine(tooManyKeys, "Too many row overrides")
    .default({}),
  expectedVersions: z
    .record(z.string(), z.number().int().positive())
    .refine(tooManyKeys, "Too many versions")
    .default({}),
});

export type ApplyImportInput = z.infer<typeof applyImportSchema>;