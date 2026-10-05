import { AppError } from "@/domain/app-error";

export type ResearchSourceKind = "web" | "manual";

export interface NormalizedResearchSource {
  kind: ResearchSourceKind;
  reference: string;
  accessedAt: string;
}

/** Normalizes provenance only; it never fetches external content or treats a URL as evidence. */
export function normalizeResearchSource(
  reference: string,
  accessedAt: string,
): NormalizedResearchSource {
  const value = reference.trim();
  if (!value || value.length > 2_000)
    throw new AppError("validation", "研究来源不能为空且不能超过 2000 字符");
  if (/^(javascript|data|file|vbscript):/i.test(value) || /[\r\n]/.test(value))
    throw new AppError("validation", "研究来源协议或格式不安全");
  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new AppError("validation", "研究来源 URL 无效");
    }
    if (url.username || url.password || !url.hostname)
      throw new AppError("validation", "研究来源 URL 不得包含凭据");
    url.hash = "";
    return { kind: "web", reference: url.toString(), accessedAt };
  }
  return { kind: "manual", reference: value, accessedAt };
}
