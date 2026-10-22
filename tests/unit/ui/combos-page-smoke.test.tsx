// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

// Resolved at module scope: the combos page pulls in a very large module graph
// (~3.5s on its own, more when the suite runs files in parallel), which used to
// blow the 5s per-test budget inside the test body.
const mod = await import("@/app/(dashboard)/dashboard/combos/page");

describe("combos page memoization", () => {
  it("combos page module exports a default component", () => {
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe("function");
  });
});
