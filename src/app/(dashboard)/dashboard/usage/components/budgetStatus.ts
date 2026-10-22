/**
 * Budget status model for the usage Budget tab, extracted from BudgetTab.tsx:
 * the row/summary shapes, the status classifier, the spend projection and
 * the status to style map that render together.
 */

export type ApiKey = {
  id: string;
  name?: string;
  provider?: string;
};

export type BudgetSummary = {
  dailyLimitUsd?: number;
  weeklyLimitUsd?: number;
  monthlyLimitUsd?: number;
  warningThreshold?: number | null;
  resetInterval?: "daily" | "weekly" | "monthly" | null;
  resetTime?: string | null;
  totalCostToday?: number;
  totalCostMonth?: number;
  totalCostPeriod?: number;
  activeLimitUsd?: number;
  budgetResetAt?: number | null;
  nextResetAt?: number | null;
  periodStartAt?: number | null;
  budgetCheck?: { allowed: boolean; remaining?: number };
};

export type KeyRow = ApiKey & { budget: BudgetSummary | null };

export type StatusKey = "all" | "blocked" | "alerting" | "warning" | "safe" | "no-limit";

export function statusOf(row: KeyRow): StatusKey {
  const b = row.budget;
  if (!b) return "no-limit";
  const limit = b.activeLimitUsd || b.dailyLimitUsd || b.monthlyLimitUsd || 0;
  if (limit <= 0) return "no-limit";
  const used = b.totalCostPeriod ?? b.totalCostToday ?? 0;
  const pct = limit > 0 ? (used / limit) * 100 : 0;
  const warnPct = (b.warningThreshold ?? 0.8) * 100;
  if (pct >= 100) return "blocked";
  if (pct >= warnPct) return "alerting";
  if (pct >= 50) return "warning";
  return "safe";
}

export function pctUsed(row: KeyRow): number {
  const b = row.budget;
  if (!b) return 0;
  const limit = b.activeLimitUsd || b.dailyLimitUsd || b.monthlyLimitUsd || 0;
  if (limit <= 0) return 0;
  const used = b.totalCostPeriod ?? b.totalCostToday ?? 0;
  return (used / limit) * 100;
}

// Project end-of-month spend based on current burn rate. Simple linear
// extrapolation: (monthly cost so far) / (days elapsed) * (days in month).
export function projectEndOfMonth(monthlyCost: number, now = new Date()): number {
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  if (dayOfMonth <= 0) return monthlyCost;
  const burnRate = monthlyCost / dayOfMonth;
  return burnRate * daysInMonth;
}

export const STATUS_META: Record<StatusKey, { tone: string; bg: string; dot: string }> = {
  all: { tone: "text-text-main", bg: "bg-bg-subtle", dot: "var(--color-text-muted)" },
  blocked: {
    tone: "text-red-400",
    bg: "bg-red-500/10 border-red-500/30",
    dot: "#ef4444",
  },
  alerting: {
    tone: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/30",
    dot: "#f59e0b",
  },
  warning: {
    tone: "text-yellow-400",
    bg: "bg-yellow-500/10 border-yellow-500/30",
    dot: "#eab308",
  },
  safe: {
    tone: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/30",
    dot: "#22c55e",
  },
  "no-limit": {
    tone: "text-text-muted",
    bg: "bg-bg-subtle border-border",
    dot: "var(--color-text-muted)",
  },
};
