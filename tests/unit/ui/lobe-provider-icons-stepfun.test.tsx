import { describe, expect, it } from "vitest";
import { getLobeProviderIcon } from "@/shared/components/lobeProviderIcons";

// The icon registry pulls in several hundred @lobehub/icons modules. Importing it
// inside the test body makes that (heavy) transform count against the 5000ms
// per-test timeout; a static import moves the work into the collect phase.
describe("lobeProviderIcons Stepfun fallback", () => {
  it("loads the icon registry and resolves the color slot to the Mono component", () => {
    const monoIcon = getLobeProviderIcon("stepfun", "mono");
    const colorIcon = getLobeProviderIcon("stepfun", "color");

    expect(monoIcon).not.toBeNull();
    expect(colorIcon).toBe(monoIcon);
  });
});
