/**
 * Reset-usage period whitelist for the storage tab (client mirror of
 * src/lib/db/cleanup.ts::RESET_USAGE_HISTORY_PERIODS — kept local so the
 * client component never imports the server DB module).
 */
// Whitelist mirrored from src/lib/db/cleanup.ts::RESET_USAGE_HISTORY_PERIODS.
export const RESET_USAGE_PERIOD_VALUES = [
  "5m",
  "1h",
  "3h",
  "6h",
  "12h",
  "1d",
  "7d",
  "30d",
  "all",
] as const;
