"use client";

import { Card } from "@/shared/components";
import { convertAmount } from "@/lib/usage/currency";
import type { BillingCurrency } from "@/lib/usage/currency";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";

const CHART_COLORS = [
  "#10b981",
  "#06b6d4",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#14b8a6",
  "#6366f1",
  "#ec4899",
];

function createCurrencyFormatter(locale: string, currency: BillingCurrency = "USD") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

interface UsageAnalyticsProviderRow {
  provider: string;
  requests: number;
  totalTokens: number;
  cost: number;
  currency?: BillingCurrency;
}

interface UsageAnalyticsTrendRow {
  date: string;
  cost: number;
}

export function ProviderSpendCard({
  title,
  rows,
  locale,
  baseCurrency = "USD",
  fxRateUsdCny = 7.1,
}: {
  title: string;
  rows: UsageAnalyticsProviderRow[];
  locale: string;
  baseCurrency?: BillingCurrency;
  fxRateUsdCny?: number;
}) {
  const baseFormatter = createCurrencyFormatter(locale, baseCurrency);
  const chartRows = rows.slice(0, 6).map((row, index) => {
    const rowCurrency = row.currency || "USD";
    const convertedCost =
      rowCurrency !== baseCurrency
        ? convertAmount(row.cost, rowCurrency, baseCurrency, fxRateUsdCny)
        : row.cost;
    return {
      name: row.provider,
      value: convertedCost,
      originalCost: row.cost,
      originalCurrency: rowCurrency,
      fill: CHART_COLORS[index % CHART_COLORS.length],
    };
  });

  function rowLabel(row: { originalCost: number; originalCurrency: string }): string {
    const symbol = row.originalCurrency === "CNY" ? "¥" : "$";
    const cost = row.originalCost || 0;
    if (cost < 0.01) return `${symbol}${cost.toFixed(6)}`;
    if (cost < 1) return `${symbol}${cost.toFixed(4)}`;
    return `${symbol}${cost.toFixed(2)}`;
  }

  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-4">
        {title}
      </h3>
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="w-full md:w-45 h-45">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartRows}
                dataKey="value"
                nameKey="name"
                innerRadius={45}
                outerRadius={72}
                paddingAngle={2}
              >
                {chartRows.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} stroke="none" />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number) => baseFormatter.format(value || 0)}
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "12px",
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-2">
          {chartRows.map((row) => (
            <div key={row.name} className="flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: row.fill }}
                />
                <span className="font-medium truncate max-w-[120px]">{row.name}</span>
              </div>
              <span className="text-text-muted shrink-0">{rowLabel(row)}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function CostTrendCard({
  title,
  rows,
  locale,
  currency = "USD",
}: {
  title: string;
  rows: UsageAnalyticsTrendRow[];
  locale: string;
  currency?: BillingCurrency;
}) {
  const currencyFormatter = createCurrencyFormatter(locale, currency);
  const chartRows = rows.map((row) => ({
    date: row.date.slice(5),
    cost: row.cost || 0,
  }));

  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-4">
        {title}
      </h3>
      <div className="h-55">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartRows} margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "var(--text-muted)" }}
              axisLine={false}
              tickLine={false}
              interval={Math.max(Math.floor(chartRows.length / 8), 0)}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "var(--text-muted)" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value) => currencyFormatter.format(value).replace(".00", "")}
              width={48}
            />
            <Tooltip
              formatter={(value: number) => currencyFormatter.format(value || 0)}
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "12px",
              }}
            />
            <Line
              type="monotone"
              dataKey="cost"
              stroke="#10b981"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export function WeeklyPatternCard({
  title,
  rows,
  locale,
  tokensLabel,
}: {
  title: string;
  rows: Array<{ day: string; avgTokens: number; totalTokens: number }>;
  locale: string;
  tokensLabel: string;
}) {
  const chartData = rows.map((row) => ({
    day: row.day,
    tokens: row.avgTokens || 0,
  }));

  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-4">
        {title}
      </h3>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="day"
              tick={{ fontSize: 11, fill: "var(--text-muted)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "var(--text-muted)" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value) =>
                new Intl.NumberFormat(locale, {
                  notation: "compact",
                }).format(Number(value || 0))
              }
              width={40}
            />
            <Tooltip
              formatter={(value: number) =>
                `${new Intl.NumberFormat(locale).format(value || 0)} ${tokensLabel}`
              }
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "12px",
              }}
            />
            <Bar dataKey="tokens" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
