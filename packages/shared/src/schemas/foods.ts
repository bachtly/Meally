import { z } from "zod";

const name = (max: number) => z.string().trim().min(1, "Name is required").max(max);
const optName = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const foodNameSchema = name(100);
export const foodCreateSchema = z.object({
  name: foodNameSchema,
  pluralName: optName(100),
  aliases: z.array(foodNameSchema).max(30).optional(),
  aisleId: z.string().max(100).nullish(),
});
export const foodPatchSchema = z.object({
  name: foodNameSchema.optional(),
  pluralName: z.string().trim().max(100).nullable().optional(),
  aliases: z.array(foodNameSchema).max(30).optional(),
  aisleId: z.string().max(100).nullable().optional(),
});

export const unitKinds = ["mass", "volume", "count"] as const;
export const unitCreateSchema = z.object({
  name: name(40),
  plural: optName(40),
  abbreviation: optName(20),
  kind: z.enum(unitKinds).default("count"),
  /** Multiplier to the base unit (ml for volume, g for mass). Needed for conversion. */
  factor: z
    .number()
    .positive()
    .max(1_000_000)
    .nullish()
    .transform((v) => v ?? null),
});
export const unitPatchSchema = z.object({
  name: name(40).optional(),
  plural: z.string().trim().max(40).nullable().optional(),
  abbreviation: z.string().trim().max(20).nullable().optional(),
  kind: z.enum(unitKinds).optional(),
  factor: z.number().positive().max(1_000_000).nullable().optional(),
});

export interface Food {
  id: string;
  name: string;
  pluralName: string | null;
  aliases: string[];
  aisleId: string | null;
  /** Recipes using this food. */
  count: number;
}
export interface UnitItem {
  key: string;
  name: string;
  plural: string;
  abbreviation: string | null;
  kind: "mass" | "volume" | "count";
  factor: number | null;
  builtIn: boolean;
  /** Present for custom units only. */
  id?: string;
  count: number;
}
