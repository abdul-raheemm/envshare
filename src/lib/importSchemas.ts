import { z } from "zod";

export const previewImportSchema = z.object({
  text: z.string().min(1, "Paste some .env text first"),
  autoFlagSensitive: z.boolean().default(false),
});