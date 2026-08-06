import { SELF_ACCOUNT_QUOTA_SCOPE, SELF_USAGE_SCOPE } from "@/shared/constants/selfServiceScopes";
import { API_KEY_BYPASS_PROVIDER_QUOTA_SCOPE } from "@/shared/constants/apiKeyPolicyScopes";
import { MCP_ADMIN_SCOPE, MCP_READ_SCOPE, MCP_WRITE_SCOPE } from "@/shared/constants/mcpScopes";

const MANAGEMENT_SCOPE = "manage";

export interface CreateScopeOptions {
  manageEnabled: boolean;
  selfUsageEnabled?: boolean;
  selfAccountQuotaEnabled?: boolean;
  bypassProviderQuotaPolicyEnabled?: boolean;
  mcpAdminEnabled?: boolean;
  mcpReadEnabled?: boolean;
  mcpWriteEnabled?: boolean;
  /** Dynamic per-service scopes (svc:<id>), one entry per proxied service. */
  serviceScopes?: string[];
}

export interface PermissionScopeOptions {
  manageEnabled: boolean;
  selfUsageEnabled: boolean;
  selfAccountQuotaEnabled: boolean;
  bypassProviderQuotaPolicyEnabled: boolean;
  mcpAdminEnabled?: boolean;
  mcpReadEnabled?: boolean;
  mcpWriteEnabled?: boolean;
  /** Complete list of wanted service scopes (svc:<id>); svc:* not listed are dropped. */
  serviceScopes?: string[];
}

export function buildApiKeyCreateScopes(options: CreateScopeOptions): string[] {
  const scopes: string[] = [];
  const selfUsageEnabled = options.selfUsageEnabled ?? true;
  if (options.manageEnabled) scopes.push(MANAGEMENT_SCOPE);
  if (selfUsageEnabled) scopes.push(SELF_USAGE_SCOPE);
  if (selfUsageEnabled && options.selfAccountQuotaEnabled === true) {
    scopes.push(SELF_ACCOUNT_QUOTA_SCOPE);
  }
  if (options.bypassProviderQuotaPolicyEnabled === true) {
    scopes.push(API_KEY_BYPASS_PROVIDER_QUOTA_SCOPE);
  }
  if (options.mcpAdminEnabled === true) scopes.push(MCP_ADMIN_SCOPE);
  if (options.mcpReadEnabled === true) scopes.push(MCP_READ_SCOPE);
  if (options.mcpWriteEnabled === true) scopes.push(MCP_WRITE_SCOPE);
  const extraScopes = new Set(options.serviceScopes ?? []);
  for (const scope of extraScopes) scopes.push(scope);
  return scopes;
}

export function mergeApiKeyPermissionScopes(
  currentScopes: readonly string[] | null | undefined,
  options: PermissionScopeOptions
): string[] {
  const scopes = new Set((currentScopes ?? []).filter((scope) => typeof scope === "string"));

  setScope(scopes, MANAGEMENT_SCOPE, options.manageEnabled);
  setScope(scopes, SELF_USAGE_SCOPE, options.selfUsageEnabled);
  setScope(
    scopes,
    SELF_ACCOUNT_QUOTA_SCOPE,
    options.selfUsageEnabled && options.selfAccountQuotaEnabled
  );
  setScope(scopes, API_KEY_BYPASS_PROVIDER_QUOTA_SCOPE, options.bypassProviderQuotaPolicyEnabled);
  setScope(scopes, MCP_ADMIN_SCOPE, options.mcpAdminEnabled === true);
  setScope(scopes, MCP_READ_SCOPE, options.mcpReadEnabled === true);
  setScope(scopes, MCP_WRITE_SCOPE, options.mcpWriteEnabled === true);

  // Dynamic service scopes: keep svc:* exactly matching the wanted list,
  // drop any svc:* the caller unchecked (unknown scopes are preserved).
  const wantedServices = new Set(options.serviceScopes ?? []);
  for (const scope of [...scopes]) {
    if (scope.startsWith("svc:") && !wantedServices.has(scope)) scopes.delete(scope);
  }
  for (const scope of wantedServices) scopes.add(scope);

  return [...scopes];
}

function setScope(scopes: Set<string>, scope: string, enabled: boolean): void {
  if (enabled) {
    scopes.add(scope);
  } else {
    scopes.delete(scope);
  }
}
