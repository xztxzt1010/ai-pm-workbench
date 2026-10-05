import { describe, expect, it } from "vitest";
import { normalizeResearchSource } from "./research-source-adapter";

describe("research source adapter", () => {
  it("normalizes web provenance without fetching it", () => {
    expect(
      normalizeResearchSource("https://example.com/a#quote", "2026-07-16"),
    ).toEqual({
      kind: "web",
      reference: "https://example.com/a",
      accessedAt: "2026-07-16",
    });
  });
  it("keeps manual and interview references available", () => {
    expect(
      normalizeResearchSource("interview://participant-1", "2026-07-16").kind,
    ).toBe("manual");
  });
  it("rejects executable or credential-bearing references", () => {
    expect(() =>
      normalizeResearchSource("javascript:alert(1)", "2026-07-16"),
    ).toThrow();
    expect(() =>
      normalizeResearchSource("https://user:pass@example.com", "2026-07-16"),
    ).toThrow();
  });
});
