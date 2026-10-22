// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import EvalsTab from "@/app/(dashboard)/dashboard/usage/components/EvalsTab";

// Static import: a dynamic import inside the test body charges the (large) usage
// page module graph against the 5000ms per-test timeout.
describe("EvalsTab memoization", () => {
  it("EvalsTab page module exports a default component", () => {
    expect(EvalsTab).toBeDefined();
    expect(typeof EvalsTab).toBe("function");
  });
});
