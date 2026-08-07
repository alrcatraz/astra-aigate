/**
 * MCP Admin Tools — the tool set exposed by the `aigate-mcp` endpoint.
 *
 * These are management tools for the MCP gateway registry itself (the
 * mcp_servers table), exposed over MCP so an agent can inspect and
 * administer the gateway without touching the dashboard. Secrets are
 * never echoed back: auth_secret is masked in outputs.
 *
 * Tool domain: `mcp_` prefix — the domain filter in createMcpServer()
 * (server.ts) selects exactly this set for the aigate-mcp endpoint.
 */

import { z } from "zod";

import {
  createMcpServer as createRegistryEntry,
  deleteMcpServer,
  getMcpServer,
  listMcpServers,
  updateMcpServer,
  type McpAuthType,
  type McpServerKind,
} from "@/lib/db/mcpServers";
import { resolveMcpEndpoint } from "@/lib/api/mcpEndpoint";
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from "@/shared/constants/mcpScopes";

type TextToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type ScopeEnforcedHandler = (
  toolName: string,
  handler: (args: unknown, extra?: { authInfo?: unknown }) => Promise<TextToolResult>,
  toolScopes?: readonly string[],
  options?: { audit?: boolean }
) => (args: unknown, extra?: { authInfo?: unknown }) => Promise<TextToolResult>;

const MASKED_SECRET = "••••••••";

function jsonResult(data: unknown): TextToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string): TextToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Summary view for list endpoints — no connection secrets at all. */
function toSummary(row: {
  id: string;
  name: string;
  kind: string;
  group_id: string;
  enabled: boolean;
  system: boolean;
  source: string;
  required_scope: string | null;
}): {
  id: string;
  name: string;
  kind: string;
  group_id: string;
  enabled: boolean;
  system: boolean;
  source: string;
  required_scope: string | null;
} {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    group_id: row.group_id,
    enabled: row.enabled,
    system: row.system,
    source: row.source,
    required_scope: row.required_scope,
  };
}

const listServersInput = z.object({
  group_id: z.string().optional().describe("Filter by group (aigate | custom)"),
  include_disabled: z.boolean().optional().describe("Include disabled entries (default false)"),
});

const getServerInput = z.object({
  id: z.string().describe("Registry id, e.g. aigate-omniroute"),
});

const registerServerInput = z.object({
  id: z.string().optional().describe("Stable id (defaults to a slug of name)"),
  name: z.string().min(1).describe("Display name"),
  group_id: z.string().default("custom").describe("aigate | custom"),
  kind: z.enum(["builtin", "stdio", "http"]).default("http").describe("Connection kind"),
  command: z.string().optional().describe("Executable path (kind=stdio)"),
  args: z.string().optional().describe("Space-separated args (kind=stdio)"),
  url: z.string().url().optional().describe("Endpoint URL (kind=http)"),
  auth_type: z.enum(["none", "bearer", "header"]).default("none").describe("Downstream auth type"),
  auth_secret: z
    .string()
    .optional()
    .describe("Downstream secret (encrypted at rest; omitted from outputs)"),
  enabled: z.boolean().default(true).describe("Endpoint on/off"),
});

const unregisterServerInput = z.object({
  id: z.string().describe("Registry id to remove (system entries are protected)"),
});

const healthInput = z.object({
  id: z.string().describe("Registry id to probe"),
});

export function registerMcpAdminTools(
  server: {
    registerTool: (name: string, config: Record<string, unknown>, handler: unknown) => unknown;
  },
  withScopeEnforcement: ScopeEnforcedHandler
): void {
  server.registerTool(
    "mcp_list_servers",
    {
      description:
        "List MCP gateway registry entries (id, kind, enabled, system flag). Secrets are never included.",
      inputSchema: listServersInput,
    },
    withScopeEnforcement(
      "mcp_list_servers",
      async (args) => {
        const parsed = listServersInput.parse(args ?? {});
        const rows = await listMcpServers({
          groupId: parsed.group_id,
          includeDisabled: parsed.include_disabled === true,
        });
        return jsonResult(rows.map(toSummary));
      },
      [MCP_READ_SCOPE],
      { audit: true }
    )
  );

  server.registerTool(
    "mcp_get_server",
    {
      description:
        "Get one MCP gateway registry entry by id, including connection details. auth_secret is masked.",
      inputSchema: getServerInput,
    },
    withScopeEnforcement(
      "mcp_get_server",
      async (args) => {
        const parsed = getServerInput.parse(args ?? {});
        const row = await getMcpServer(parsed.id);
        if (!row) {
          return errorResult(`MCP server not found: ${parsed.id}`);
        }
        return jsonResult({ ...row, auth_secret: row.auth_secret ? MASKED_SECRET : null });
      },
      [MCP_READ_SCOPE],
      { audit: true }
    )
  );

  server.registerTool(
    "mcp_register_server",
    {
      description:
        "Create or update an MCP gateway registry entry. Pass id to update an existing entry, omit to create.",
      inputSchema: registerServerInput,
    },
    withScopeEnforcement(
      "mcp_register_server",
      async (args) => {
        const parsed = registerServerInput.parse(args ?? {});
        const kind: McpServerKind = parsed.kind;
        const authType: McpAuthType = parsed.auth_type;
        const input = {
          id: parsed.id,
          name: parsed.name,
          group_id: parsed.group_id,
          kind,
          command: parsed.command ?? null,
          args: parsed.args ?? null,
          url: parsed.url ?? null,
          auth_type: authType,
          auth_secret: parsed.auth_secret ?? null,
          enabled: parsed.enabled,
        };
        let row;
        if (parsed.id) {
          const existing = await getMcpServer(parsed.id);
          if (existing) {
            row = await updateMcpServer(parsed.id, input);
          } else {
            row = await createRegistryEntry(input);
          }
        } else {
          row = await createRegistryEntry(input);
        }
        return jsonResult({
          ...toSummary(row),
          auth_secret: row.auth_secret ? MASKED_SECRET : null,
        });
      },
      [MCP_WRITE_SCOPE],
      { audit: true }
    )
  );

  server.registerTool(
    "mcp_unregister_server",
    {
      description:
        "Remove an MCP gateway registry entry. System entries (preset) are protected and rejected.",
      inputSchema: unregisterServerInput,
    },
    withScopeEnforcement(
      "mcp_unregister_server",
      async (args) => {
        const parsed = unregisterServerInput.parse(args ?? {});
        const row = await getMcpServer(parsed.id);
        if (!row) {
          return errorResult(`MCP server not found: ${parsed.id}`);
        }
        if (row.system) {
          return errorResult(
            `Refusing to remove system entry "${parsed.id}" — presets can be disabled but not deleted.`
          );
        }
        await deleteMcpServer(parsed.id);
        return jsonResult({ deleted: parsed.id });
      },
      [MCP_WRITE_SCOPE],
      { audit: true }
    )
  );

  server.registerTool(
    "mcp_server_health",
    {
      description:
        "Probe an MCP gateway endpoint: registry state plus endpoint availability (404 unknown / 503 disabled / ok).",
      inputSchema: healthInput,
    },
    withScopeEnforcement(
      "mcp_server_health",
      async (args) => {
        const parsed = healthInput.parse(args ?? {});
        const row = await getMcpServer(parsed.id);
        if (!row) {
          return errorResult(`MCP server not found: ${parsed.id}`);
        }
        const resolved = await resolveMcpEndpoint(parsed.id);
        return jsonResult({
          id: row.id,
          name: row.name,
          kind: row.kind,
          enabled: row.enabled,
          system: row.system,
          available: resolved.ok === true,
          status:
            resolved.ok === true
              ? "ok"
              : resolved.response.status === 404
                ? "not-found"
                : "disabled",
        });
      },
      [MCP_READ_SCOPE],
      { audit: true }
    )
  );
}
