export const HIDEABLE_SIDEBAR_ITEM_IDS = [
  // Home
  "home",
  // AI Gate — platform-level consumer access (Phase 3)
  "endpoints",
  "api-manager",
  "mcp-servers",
  "cli-code",
  // OmniProxy — flat
  "providers",
  "embedded-services",
  "combos",
  "combos-live",
  "auto-combo",
  "combos-playground",
  "quota",
  // OmniProxy > Compression Context (Settings → Combos → engines → Studio)
  "context",
  "compression",
  "compression-live",
  "context-settings",
  "context-combos",
  "context-caveman",
  "context-rtk",
  "context-headroom",
  "context-session-dedup",
  "context-ccr",
  "context-llmlingua",
  "context-lite",
  "context-aggressive",
  "context-ultra",
  "context-omniglyph",
  "compression-studio",
  "compression-exclusions",
  // OmniProxy > Tools
  "cli-agents",
  "acp-agents",
  "cloud-agents",
  "agent-bridge",
  "traffic-inspector",
  "discovery",
  // OmniProxy > Integrations
  "api-endpoints",
  "webhooks",
  // OmniProxy — proxy tools
  "mitm-proxy",
  "1proxy",
  // Analytics
  "analytics",
  "analytics-combo-health",
  "analytics-utilization",
  "costs",
  "cache",
  "analytics-compression",
  "analytics-search",
  "analytics-evals",
  "analytics-limits",
  "provider-stats",
  // Monitoring — flat
  "activity",
  "logs",
  "logs-proxy",
  "logs-console",
  "logs-timeline",
  "logs-activity",
  "health",
  "runtime",
  "system-1proxy",
  "system-mitm-proxy",
  // Costs section
  "costs-pricing",
  "costs-budget",
  "costs-free-tiers",
  "costs-quota-share",
  "free-provider-rankings",
  // Monitoring > Audit
  "audit",
  "audit-mcp",
  "audit-a2a",
  // Dev Tools
  "translator",
  "playground",
  "search-tools",
  // Agentic Features
  "memory",
  "skills",
  "agent-skills",
  "chaos-config",
  "mcp",
  "a2a",
  "plugins",
  // Gamification
  "leaderboard",
  "profile",
  "tokens",
  "gamification-admin",
  // Other Features — flat
  "media",
  "relay",
  "media-providers",
  // Other Features > Batch
  "batch",
  "batch-files",
  // Configuration
  "settings-general",
  "settings-appearance",
  "settings-ai",
  "settings-routing",
  "settings-resilience",
  "settings-advanced",
  "settings-security",
  "settings-access-tokens",
  "settings-feature-flags",
  "settings-cache",
  "settings-sidebar",
  "settings-pricing",
  // Help
  "docs",
  "issues",
  "changelog",
] as const;

export type HideableSidebarItemId = (typeof HIDEABLE_SIDEBAR_ITEM_IDS)[number];

/** Sidebar entries that are intentionally always available and cannot be hidden by presets. */
export type AlwaysVisibleSidebarItemId = "proxy";

export type SidebarItemId = HideableSidebarItemId | AlwaysVisibleSidebarItemId;

export type SidebarSectionId =
  | "home"
  | "ai-gate"
  | "omni-proxy"
  | "analytics"
  | "costs"
  | "monitoring"
  | "devtools"
  | "agentic-features"
  | "other-features"
  | "configuration"
  | "help";

export interface SidebarItemDefinition {
  id: SidebarItemId;
  href: string;
  i18nKey: string;
  subtitleKey?: string;
  /** Literal label shown when `i18nKey` has no translation (avoids per-locale edits). */
  labelFallback?: string;
  /** Literal subtitle shown when `subtitleKey` is absent/untranslated. */
  subtitleFallback?: string;
  icon: string;
  exact?: boolean;
  external?: boolean;
}

export interface SidebarItemGroup {
  type: "group";
  id: string;
  titleKey: string;
  titleFallback: string;
  items: readonly SidebarItemDefinition[];
}

export type SidebarSectionChild = SidebarItemDefinition | SidebarItemGroup;

export interface SidebarSectionDefinition {
  id: SidebarSectionId;
  titleKey: string;
  titleFallback: string;
  children: readonly SidebarSectionChild[];
  showTitle?: boolean;
  visibility?: "always" | "debug";
  defaultPinned?: boolean;
}

export type SidebarPresetId = "all" | "minimal" | "developer" | "admin";

export interface SidebarPresetDefinition {
  id: SidebarPresetId;
  icon: string;
  hiddenItems: HideableSidebarItemId[];
}

export type SidebarItemOrder = Partial<Record<SidebarSectionId, string[]>>;
