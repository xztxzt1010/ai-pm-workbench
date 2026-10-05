// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  loadResearchSearchConfig,
  persistResearchSearchConfig,
} from "@/data/research-search-settings";

describe("research search settings persistence", () => {
  beforeEach(() => localStorage.clear());

  it("persists non-sensitive adapter metadata in browser preview", async () => {
    await persistResearchSearchConfig(
      {
        provider: "generic_json",
        endpoint: "https://search.example.test/api",
        enabled: true,
        timeoutMs: 5_000,
      },
      false,
    );
    expect(await loadResearchSearchConfig(false)).toMatchObject({
      provider: "generic_json",
      endpoint: "https://search.example.test/api",
      enabled: true,
      timeoutMs: 5_000,
    });
  });

  it("migrates legacy custom endpoints to the generic provider", async () => {
    localStorage.setItem(
      "assistant-product-manager.research-search-config.v1",
      JSON.stringify({ endpoint: "https://legacy.example.test/api", enabled: true, timeoutMs: 5_000 }),
    );
    expect(await loadResearchSearchConfig(false)).toMatchObject({
      provider: "generic_json",
      endpoint: "https://legacy.example.test/api",
    });
  });

  it("falls back to disabled defaults for tampered storage", async () => {
    localStorage.setItem(
      "assistant-product-manager.research-search-config.v1",
      JSON.stringify({
        endpoint: "file:///secret",
        enabled: true,
        timeoutMs: 5_000,
      }),
    );
    expect(await loadResearchSearchConfig(false)).toMatchObject({
      provider: "wikipedia_zh",
      endpoint: "https://zh.wikipedia.org/w/api.php",
      enabled: false,
    });
  });
});
