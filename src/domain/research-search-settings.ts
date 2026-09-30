import { validateResearchSearchEndpoint } from "@/domain/research-search-adapter";

export type ResearchSearchProvider = "wikipedia_zh" | "generic_json";

export const WIKIPEDIA_ZH_SEARCH_ENDPOINT = "https://zh.wikipedia.org/w/api.php";

export interface ResearchSearchConfig {
  provider: ResearchSearchProvider;
  endpoint: string;
  enabled: boolean;
  timeoutMs: number;
  updatedAt: string;
}

export const defaultResearchSearchConfig: ResearchSearchConfig = {
  provider: "wikipedia_zh",
  endpoint: WIKIPEDIA_ZH_SEARCH_ENDPOINT,
  enabled: false,
  timeoutMs: 8_000,
  updatedAt: new Date(0).toISOString(),
};

export function validateResearchSearchConfig(
  config: Omit<ResearchSearchConfig, "updatedAt">,
): { valid: boolean; message: string } {
  if (!config.enabled) return { valid: true, message: "外部搜索未启用" };
  if (!(["wikipedia_zh", "generic_json"] as const).includes(config.provider))
    return { valid: false, message: "搜索提供商无效" };
  if (
    config.provider === "wikipedia_zh" &&
    config.endpoint !== WIKIPEDIA_ZH_SEARCH_ENDPOINT
  )
    return { valid: false, message: "中文维基百科必须使用内置官方端点" };
  try {
    validateResearchSearchEndpoint(config.endpoint);
  } catch (error) {
    return {
      valid: false,
      message: error instanceof Error ? error.message : "搜索端点无效",
    };
  }
  if (
    !Number.isInteger(config.timeoutMs) ||
    config.timeoutMs < 1_000 ||
    config.timeoutMs > 30_000
  )
    return { valid: false, message: "搜索超时必须在 1000–30000 毫秒之间" };
  return { valid: true, message: "搜索配置有效" };
}
