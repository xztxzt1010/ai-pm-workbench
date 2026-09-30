import { describe, expect, it, vi } from "vitest";

import { searchResearchSources } from "@/services/research-search-service";

describe("research search service", () => {
  it("uses the desktop transport after validating the request", async () => {
    const transport = vi.fn().mockResolvedValue([
      { title: "结果", url: "https://example.com/report#part", snippet: "摘要" },
    ]);
    const results = await searchResearchSources(
      { provider: "generic_json", query: " 产品 ", endpoint: "https://search.example.test/api", timeoutMs: 5_000 },
      transport,
    );
    expect(transport).toHaveBeenCalledWith({
      provider: "generic_json",
      query: "产品",
      endpoint: "https://search.example.test/api",
      timeoutMs: 5_000,
    });
    expect(results[0].url).toBe("https://example.com/report");
  });

  it("does not call the desktop transport for invalid input", async () => {
    const transport = vi.fn();
    await expect(
      searchResearchSources(
        { provider: "generic_json", query: "", endpoint: "https://search.example.test/api" },
        transport,
      ),
    ).rejects.toThrow("搜索词");
    expect(transport).not.toHaveBeenCalled();
  });

  it("normalizes transport failures into bounded external-service errors", async () => {
    const message = "上游不可用".repeat(200);
    await expect(
      searchResearchSources(
        { provider: "generic_json", query: "x", endpoint: "https://search.example.test/api" },
        vi.fn().mockRejectedValue(message),
      ),
    ).rejects.toMatchObject({ code: "external_service", message: message.slice(0, 300) });
  });
});
