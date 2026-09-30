import { AppError } from "@/domain/app-error";
import { normalizeResearchSource } from "@/domain/research-source-adapter";
import type { ResearchSearchProvider } from "@/domain/research-search-settings";

export interface ResearchSearchResult {
  id: string;
  title: string;
  url: string;
  snippet: string;
  accessedAt: string;
}
export interface ResearchSearchAdapterRequest {
  provider: ResearchSearchProvider;
  query: string;
  endpoint: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}
export type ResearchSearchTransportResult = Pick<ResearchSearchResult, "title" | "url" | "snippet">;

export function validateResearchSearchEndpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("validation", "搜索适配器端点无效");
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    throw new AppError("validation", "搜索适配器仅允许 HTTPS 或本机回环 HTTP");
  if (url.username || url.password)
    throw new AppError("validation", "搜索适配器端点不得包含凭据");
  if (url.hash)
    throw new AppError("validation", "搜索适配器端点不得包含片段");
  for (const key of url.searchParams.keys()) {
    if (/^(?:api[_-]?key|access[_-]?token|token|secret|password)$/i.test(key))
      throw new AppError("validation", "search endpoint query must not contain credentials");
  }
  return url;
}

export function validateResearchSearchRequest(
  request: ResearchSearchAdapterRequest,
): { provider: ResearchSearchProvider; query: string; endpoint: string; timeoutMs: number } {
  if (request.provider !== "wikipedia_zh" && request.provider !== "generic_json")
    throw new AppError("validation", "搜索提供商无效");
  const query = request.query.trim();
  if (!query || query.length > 200)
    throw new AppError("validation", "搜索词不能为空且不能超过 200 字符");
  const endpoint = validateResearchSearchEndpoint(request.endpoint);
  const timeoutMs = request.timeoutMs ?? 8_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000)
    throw new AppError("validation", "搜索超时必须在 1000–30000 毫秒之间");
  if (request.signal?.aborted)
    throw new AppError("external_service", "搜索请求已取消");
  return { provider: request.provider, query, endpoint: endpoint.toString(), timeoutMs };
}

export function normalizeResearchSearchResults(
  values: ResearchSearchTransportResult[],
  accessedAt = new Date().toISOString(),
): ResearchSearchResult[] {
  if (!Array.isArray(values) || values.length > 10)
    throw new AppError("external_service", "搜索适配器结果数量无效");
  return values
    .map((item, index) => {
      if (!item || typeof item !== "object")
        throw new AppError("external_service", "搜索适配器结果项无效");
      const raw = item as Record<string, unknown>;
      const title = typeof raw.title === "string" ? raw.title.trim() : "";
      const url = typeof raw.url === "string" ? raw.url : "";
      const snippet = typeof raw.snippet === "string" ? raw.snippet.trim() : "";
      if (!title || title.length > 300 || !snippet || snippet.length > 2_000 || /[\u0000-\u001f\u007f]/.test(`${title}${snippet}`))
        throw new AppError("external_service", "搜索适配器结果缺少标题或摘要");
      const normalized = normalizeResearchSource(url, accessedAt);
      if (normalized.kind !== "web")
        throw new AppError("external_service", "搜索结果必须是网页来源");
      return {
        id: `${index + 1}:${normalized.reference}`,
        title,
        url: normalized.reference,
        snippet,
        accessedAt,
      };
    });
}
