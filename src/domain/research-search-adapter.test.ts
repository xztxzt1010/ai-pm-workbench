import { describe, expect, it } from "vitest";

import {
  normalizeResearchSearchResults,
  validateResearchSearchRequest,
} from "./research-search-adapter";

describe("research search adapter", () => {
  it("normalizes bounded web results without persisting them", () => {
    expect(
      normalizeResearchSearchResults(
        [{ title: " 产品研究 ", url: "https://example.com/a#x", snippet: " 摘要 " }],
        "2026-07-17T00:00:00.000Z",
      )[0],
    ).toMatchObject({
      title: "产品研究",
      url: "https://example.com/a",
      snippet: "摘要",
      accessedAt: "2026-07-17T00:00:00.000Z",
    });
  });

  it("rejects unsafe endpoints and credential-like query parameters", () => {
    expect(() =>
      validateResearchSearchRequest({ provider: "generic_json", query: "x", endpoint: "http://evil.example/api" }),
    ).toThrow();
    expect(() =>
      validateResearchSearchRequest({
        provider: "generic_json",
        query: "x",
        endpoint: "https://search.example.test/api?api_key=hidden",
      }),
    ).toThrow();
    expect(() =>
      validateResearchSearchRequest({
        provider: "generic_json",
        query: "x",
        endpoint: "https://search.example.test/api#fragment",
      }),
    ).toThrow();
  });

  it("rejects malformed, excessive, or control-character results", () => {
    expect(() =>
      normalizeResearchSearchResults([{ title: "", url: "https://example.com", snippet: "" }]),
    ).toThrow();
    expect(() =>
      normalizeResearchSearchResults([{ title: "标题", url: "file:///private", snippet: "摘要" }]),
    ).toThrow();
    expect(() =>
      normalizeResearchSearchResults([{ title: "标题", url: "https://example.com", snippet: "bad\nvalue" }]),
    ).toThrow();
    expect(() =>
      normalizeResearchSearchResults(
        Array.from({ length: 11 }, () => ({ title: "标题", url: "https://example.com", snippet: "摘要" })),
      ),
    ).toThrow();
  });

  it("bounds query, timeout, and pre-aborted requests", () => {
    expect(() =>
      validateResearchSearchRequest({
        provider: "generic_json",
        query: "x",
        endpoint: "https://search.example.test/api",
        timeoutMs: 31_000,
      }),
    ).toThrow("1000");
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      validateResearchSearchRequest({
        provider: "generic_json",
        query: "x",
        endpoint: "https://search.example.test/api",
        signal: controller.signal,
      }),
    ).toThrow("已取消");
  });
});
