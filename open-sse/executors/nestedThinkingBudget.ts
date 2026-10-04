/**
 * Nested thinking-budget helpers for executor request bodies.
 *
 * Extracted from `base.ts` so the BaseExecutor file stays focused on the
 * request/response pipeline. The functions understand every provider
 * envelope that nests a thinking config (native Gemini, openai→gemini,
 * Antigravity Cloud Code) and mutate budgets in place.
 */

/**
 * True when the body opts into Claude extended thinking (`thinking.type` is
 * `enabled` or `adaptive`) — used to decide whether a request carries an
 * active thinking block that downstream transforms must respect.
 */
export function hasActiveClaudeThinking(body: Record<string, unknown>): boolean {
  const thinking = body.thinking as Record<string, unknown> | undefined;
  return thinking?.type === "enabled" || thinking?.type === "adaptive";
}

/**
 * Collect every `thinkingConfig` object in a transformed request body that holds
 * a thinking budget, wherever the provider's envelope nests it:
 *   - body.generationConfig.thinkingConfig            (native Gemini / openai→gemini)
 *   - body.request.generationConfig.thinkingConfig    (Antigravity Cloud Code envelope)
 * Returns only objects that actually carry a `thinkingBudget`/`thinking_budget`
 * field — a request without thinking config is never mutated.
 */
export function collectThinkingConfigs(body: unknown): Array<Record<string, unknown>> {
  if (!body || typeof body !== "object") return [];
  const root = body as Record<string, unknown>;
  const configs: Array<Record<string, unknown>> = [];
  const envelopes: unknown[] = [
    root.generationConfig,
    (root.request as Record<string, unknown> | undefined)?.generationConfig,
  ];
  for (const env of envelopes) {
    if (!env || typeof env !== "object") continue;
    const tc = (env as Record<string, unknown>).thinkingConfig;
    if (tc && typeof tc === "object") {
      const tcr = tc as Record<string, unknown>;
      if ("thinkingBudget" in tcr || "thinking_budget" in tcr) configs.push(tcr);
    }
  }
  return configs;
}

/**
 * Read the first thinking budget found in the body (any supported nest / naming).
 * Returns null when the body carries no readable numeric budget.
 */
export function readNestedThinkingBudget(body: unknown): number | null {
  for (const tc of collectThinkingConfigs(body)) {
    const raw = tc.thinkingBudget ?? tc.thinking_budget;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Clamp every thinking budget in the body down to `max` (only lowers; never
 * raises a budget already below max). Mutates in place. Returns true when at
 * least one budget was actually lowered (i.e. a retry would send a different
 * body) — false means the 400 was not caused by an over-max budget we hold, so
 * retrying would resend an identical body and loop.
 */
export function clampNestedThinkingBudget(body: unknown, max: number): boolean {
  let changed = false;
  for (const tc of collectThinkingConfigs(body)) {
    for (const key of ["thinkingBudget", "thinking_budget"] as const) {
      const n = Number(tc[key]);
      if (Number.isFinite(n) && n > max) {
        tc[key] = max;
        changed = true;
      }
    }
  }
  return changed;
}
