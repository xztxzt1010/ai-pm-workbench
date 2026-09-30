import { invoke } from "@tauri-apps/api/core";

import { AppError } from "@/domain/app-error";
import {
  normalizeResearchSearchResults,
  validateResearchSearchRequest,
  type ResearchSearchAdapterRequest,
  type ResearchSearchResult,
  type ResearchSearchTransportResult,
} from "@/domain/research-search-adapter";
import type { ResearchSearchProvider } from "@/domain/research-search-settings";

export type ResearchSearchTransport = (request: {
  provider: ResearchSearchProvider;
  query: string;
  endpoint: string;
  timeoutMs: number;
}) => Promise<ResearchSearchTransportResult[]>;

const invokeResearchSearch: ResearchSearchTransport = (request) =>
  invoke<ResearchSearchTransportResult[]>("search_research_sources", { request });

export async function searchResearchSources(
  request: ResearchSearchAdapterRequest,
  transport: ResearchSearchTransport = invokeResearchSearch,
): Promise<ResearchSearchResult[]> {
  const validated = validateResearchSearchRequest(request);
  let values: ResearchSearchTransportResult[];
  try {
    values = await transport(validated);
  } catch (error) {
    const message =
      typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : "外部研究搜索失败";
    throw new AppError("external_service", message.slice(0, 300));
  }
  if (request.signal?.aborted)
    throw new AppError("external_service", "搜索请求已取消");
  return normalizeResearchSearchResults(values);
}
