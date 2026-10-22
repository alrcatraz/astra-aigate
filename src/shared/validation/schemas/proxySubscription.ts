import { z } from "zod";

/**
 * Schemas for POST/PATCH /api/v1/management/proxy-subscriptions (t06 gate).
 *
 * These encode the behaviour of the original hand-rolled `parsePayload` (create)
 * and inline whitelist (PATCH) so validation is declarative without changing
 * semantics: trim-on-read, `mode: "rule"` requires at least one string
 * `ruleProvider`, `updateIntervalMinutes` falls back to 60, `enabled` defaults
 * false, and error messages match verbatim so existing tests hold.
 *
 * The PATCH schema is fully optional (partial update) and drops unknown keys the
 * same way the old whitelist did — only the declared fields pass through.
 */
export const proxySubscriptionCreateSchema = z
  .object({
    name: z.string().trim().min(1, "name is required"),
    url: z.string().trim().min(1, "url is required"),
    mode: z.enum(["rule", "global"]).default("global"),
    ruleProviders: z
      .array(z.string())
      .transform((xs) => xs.filter((x) => x.length > 0))
      .default([]),
    localCoreEndpoint: z
      .string()
      .transform((s) => s.trim())
      .optional(),
    updateIntervalMinutes: z.number().catch(60),
    enabled: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "rule" && value.ruleProviders.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ruleProviders is required when mode is 'rule'",
        path: ["ruleProviders"],
      });
    }
  })
  .transform((value) => ({
    name: value.name,
    url: value.url,
    mode: value.mode,
    ruleProviders: value.ruleProviders.length > 0 ? value.ruleProviders : null,
    localCoreEndpoint:
      value.localCoreEndpoint && value.localCoreEndpoint.length > 0
        ? value.localCoreEndpoint
        : null,
    updateIntervalMinutes: value.updateIntervalMinutes,
    enabled: value.enabled,
  }));

export const proxySubscriptionUpdateSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    url: z.string().trim().min(1).optional(),
    mode: z.enum(["rule", "global"]).optional(),
    enabled: z.boolean().optional(),
    localCoreEndpoint: z
      .string()
      .transform((s) => s.trim())
      .optional(),
    updateIntervalMinutes: z.number().optional(),
    ruleProviders: z.array(z.string()).optional(),
  })
  .strict();
