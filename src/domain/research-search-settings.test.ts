import { describe, expect, it } from "vitest";
import { validateResearchSearchConfig } from "@/domain/research-search-settings";

describe("research search settings", () => {
  it("accepts a safe enabled endpoint and bounded timeout", () => {
    expect(
      validateResearchSearchConfig({
        provider: "generic_json",
        endpoint: "https://search.example.test/api",
        enabled: true,
        timeoutMs: 8_000,
      }).valid,
    ).toBe(true);
  });

  it("accepts only the fixed official endpoint for the built-in Wikipedia provider", () => {
    expect(
      validateResearchSearchConfig({
        provider: "wikipedia_zh",
        endpoint: "https://zh.wikipedia.org/w/api.php",
        enabled: true,
        timeoutMs: 8_000,
      }).valid,
    ).toBe(true);
    expect(
      validateResearchSearchConfig({
        provider: "wikipedia_zh",
        endpoint: "https://example.test/wiki-api",
        enabled: true,
        timeoutMs: 8_000,
      }).valid,
    ).toBe(false);
  });

  it("rejects unsafe endpoints and unbounded timeouts", () => {
    expect(
      validateResearchSearchConfig({
        provider: "generic_json",
        endpoint: "http://example.test/api",
        enabled: true,
        timeoutMs: 8_000,
      }).valid,
    ).toBe(false);
    expect(
      validateResearchSearchConfig({
        provider: "generic_json",
        endpoint: "https://example.test/api",
        enabled: true,
        timeoutMs: 60_000,
      }).valid,
    ).toBe(false);
  });
});
