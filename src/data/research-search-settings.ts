import { openDesktopDatabase } from "@/data/desktop-database";
import {
  defaultResearchSearchConfig,
  validateResearchSearchConfig,
  WIKIPEDIA_ZH_SEARCH_ENDPOINT,
  type ResearchSearchConfig,
} from "@/domain/research-search-settings";

const BROWSER_KEY = "assistant-product-manager.research-search-config.v1";
const APP_KEY = "research_search_config";

function parse(value: unknown): ResearchSearchConfig {
  if (!value || typeof value !== "object") return defaultResearchSearchConfig;
  const candidate = value as Partial<ResearchSearchConfig>;
  const provider =
    candidate.provider === "wikipedia_zh" || candidate.provider === "generic_json"
      ? candidate.provider
      : typeof candidate.endpoint === "string" && candidate.endpoint
        ? "generic_json"
        : defaultResearchSearchConfig.provider;
  const config: ResearchSearchConfig = {
    provider,
    endpoint:
      provider === "wikipedia_zh"
        ? WIKIPEDIA_ZH_SEARCH_ENDPOINT
        : typeof candidate.endpoint === "string"
          ? candidate.endpoint
          : "",
    enabled: candidate.enabled === true,
    timeoutMs:
      typeof candidate.timeoutMs === "number" ? candidate.timeoutMs : 8_000,
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : defaultResearchSearchConfig.updatedAt,
  };
  return validateResearchSearchConfig(config).valid
    ? config
    : defaultResearchSearchConfig;
}

export async function loadResearchSearchConfig(
  desktopRuntime: boolean,
): Promise<ResearchSearchConfig> {
  if (!desktopRuntime) {
    try {
      return parse(JSON.parse(localStorage.getItem(BROWSER_KEY) ?? "null"));
    } catch {
      return defaultResearchSearchConfig;
    }
  }
  const db = await openDesktopDatabase();
  const rows = await db.select<Array<{ value_json: string }>>(
    "SELECT value_json FROM app_settings WHERE key = $1 LIMIT 1",
    [APP_KEY],
  );
  if (!rows[0]) return defaultResearchSearchConfig;
  try {
    return parse(JSON.parse(rows[0].value_json));
  } catch {
    return defaultResearchSearchConfig;
  }
}

export async function persistResearchSearchConfig(
  config: Omit<ResearchSearchConfig, "updatedAt">,
  desktopRuntime: boolean,
): Promise<ResearchSearchConfig> {
  const validation = validateResearchSearchConfig(config);
  if (!validation.valid) throw new Error(validation.message);
  const next: ResearchSearchConfig = {
    ...config,
    endpoint:
      config.provider === "wikipedia_zh"
        ? WIKIPEDIA_ZH_SEARCH_ENDPOINT
        : config.endpoint.trim(),
    updatedAt: new Date().toISOString(),
  };
  if (!desktopRuntime) {
    localStorage.setItem(BROWSER_KEY, JSON.stringify(next));
    return next;
  }
  const db = await openDesktopDatabase();
  await db.execute(
    `INSERT INTO app_settings (key, value_json, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    [APP_KEY, JSON.stringify(next), next.updatedAt],
  );
  return next;
}
