/**
 * Window list for the quota-cutoff modal.
 *
 * The modal used to offer only the windows the connection can currently report a
 * percentage for. That hides the family wildcards a provider registers for
 * per-model windows (`5h:*`, `weekly:*`, `monthly:*`): they never appear in the
 * usage payload because they are not a single window, so an operator could not
 * configure them from the dashboard at all — only through the API.
 *
 * The list is therefore: observed windows first (they have live numbers), then
 * every window the provider registers but did not report, deduplicated.
 */

export interface ObservedQuotaWindow {
  name: string;
  isCredits?: boolean;
}

export interface CutoffWindowOption {
  key: string;
  displayName: string;
}

/** Human label for a wildcard family key (`5h:*` → `5h — all models`). */
export function cutoffWindowLabel(key: string): string {
  const wildcard = /^(.+):\*$/.exec(key);
  if (wildcard) return `${wildcard[1]} — all models`;
  return key;
}

export function buildCutoffWindows(
  observed: readonly ObservedQuotaWindow[],
  registered: readonly string[]
): CutoffWindowOption[] {
  const seen = new Set<string>();
  const options: CutoffWindowOption[] = [];

  for (const window of observed) {
    if (!window || typeof window.name !== "string" || !window.name) continue;
    if (window.isCredits) continue;
    if (seen.has(window.name)) continue;
    seen.add(window.name);
    options.push({ key: window.name, displayName: cutoffWindowLabel(window.name) });
  }

  for (const name of registered) {
    if (typeof name !== "string" || !name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    options.push({ key: name, displayName: cutoffWindowLabel(name) });
  }

  return options;
}
