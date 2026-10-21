import test from "node:test";
import assert from "node:assert/strict";

const sidebarVisibility = await import("../../src/shared/constants/sidebarVisibility.ts");

function getToolsGroup() {
  const omniProxySection = sidebarVisibility.SIDEBAR_SECTIONS.find(
    (section) => section.id === "omni-proxy"
  );
  assert.ok(omniProxySection, "expected omni-proxy section to exist");

  const toolsGroup = omniProxySection.children.find(
    (
      child
    ): child is (typeof sidebarVisibility.SIDEBAR_SECTIONS)[number]["children"][number] & {
      type: "group";
    } =>
      "type" in child &&
      (child as { type: string }).type === "group" &&
      (child as { id: string }).id === "tools"
  );
  assert.ok(toolsGroup, "expected tools group to exist in omni-proxy section");
  return toolsGroup as {
    type: "group";
    id: string;
    items: readonly { id: string; href: string; i18nKey: string }[];
  };
}

test("TOOLS_GROUP items follow the sidebar rework order: cli-agents → acp-agents → cloud-agents → agent-bridge → traffic-inspector → discovery", () => {
  const toolsGroup = getToolsGroup();
  const itemIds = toolsGroup.items.map((item) => item.id);
  // cli-code moved out of TOOLS_GROUP into the AI Gate section in Phase 3 (ecf1201c);
  // agent-bridge/traffic-inspector from plans 11/12 (#2858); discovery from #5939.
  // Remaining items keep plan 14 (#2839) relative order.
  assert.deepEqual(
    itemIds,
    ["cli-agents", "acp-agents", "cloud-agents", "agent-bridge", "traffic-inspector", "discovery"],
    "TOOLS_GROUP items order must be cli-agents, acp-agents, cloud-agents, agent-bridge, traffic-inspector, discovery (cli-code lives in the AI Gate section)"
  );
});

test("TOOLS_GROUP no longer contains cli-code; the cli-code item lives in the AI Gate section with correct href and i18nKey", () => {
  const toolsGroup = getToolsGroup();
  assert.ok(
    !toolsGroup.items.some((item) => item.id === "cli-code"),
    "cli-code must not be in TOOLS_GROUP (moved to the AI Gate section)"
  );

  const aiGateSection = sidebarVisibility.SIDEBAR_SECTIONS.find(
    (section) => section.id === "ai-gate"
  );
  assert.ok(aiGateSection, "expected ai-gate section to exist");
  const cliCode = aiGateSection.children.find(
    (child) => "id" in child && child.id === "cli-code"
  ) as { id: string; href: string; i18nKey: string } | undefined;
  assert.ok(cliCode, "expected cli-code in the AI Gate section");
  assert.equal(cliCode.href, "/dashboard/cli-code");
  assert.equal(cliCode.i18nKey, "cliCode");
});

test("TOOLS_GROUP cli-agents item has correct href and i18nKey", () => {
  const toolsGroup = getToolsGroup();
  const cliAgents = toolsGroup.items.find((item) => item.id === "cli-agents");
  assert.ok(cliAgents, "expected cli-agents in TOOLS_GROUP");
  assert.equal(cliAgents.href, "/dashboard/cli-agents");
  assert.equal(cliAgents.i18nKey, "cliAgents");
});

test("TOOLS_GROUP acp-agents item has correct href and i18nKey", () => {
  const toolsGroup = getToolsGroup();
  const acpAgents = toolsGroup.items.find((item) => item.id === "acp-agents");
  assert.ok(acpAgents, "expected acp-agents in TOOLS_GROUP");
  assert.equal(acpAgents.href, "/dashboard/acp-agents");
  assert.equal(acpAgents.i18nKey, "acpAgents");
});

test("TOOLS_GROUP does NOT contain legacy cli-tools or agents entries", () => {
  const toolsGroup = getToolsGroup();
  const legacyIds = toolsGroup.items
    .map((item) => item.id)
    .filter((id) => id === "cli-tools" || id === "agents");
  assert.deepEqual(
    legacyIds,
    [],
    "TOOLS_GROUP must not contain legacy 'cli-tools' or 'agents' entries"
  );
});
