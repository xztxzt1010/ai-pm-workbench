import { invoke } from "@tauri-apps/api/core";
import { AppError } from "@/domain/app-error";
import type { ResearchType } from "@/domain/research-entry";
import { normalizeResearchSource } from "@/domain/research-source-adapter";
export interface ResearchEntryRecord {
  id: string;
  projectId: string;
  planId?: string | null;
  researchType: ResearchType;
  title: string;
  sourceRef: string;
  accessedAt: string;
  insight: string;
  personaSuggestion: string;
  createdAt: string;
  updatedAt: string;
}
function requireDesktop(value: boolean) {
  if (!value) throw new AppError("permission", "研究记录仅在桌面应用中保存");
}
export async function createResearchEntry(
  desktopRuntime: boolean,
  input: {
    id: string;
    projectId: string;
    planId?: string;
    researchType: ResearchType;
    title: string;
    sourceRef: string;
    accessedAt: string;
    insight: string;
    personaSuggestion: string;
  },
): Promise<ResearchEntryRecord> {
  requireDesktop(desktopRuntime);
  const source = normalizeResearchSource(input.sourceRef, input.accessedAt);
  return invoke<ResearchEntryRecord>("create_research_entry", {
    request: {
      ...input,
      sourceRef: source.reference,
      accessedAt: source.accessedAt,
    },
  });
}
export async function listResearchEntries(
  desktopRuntime: boolean,
  projectId: string,
): Promise<ResearchEntryRecord[]> {
  if (!desktopRuntime) return [];
  return invoke<ResearchEntryRecord[]>("list_research_entries", { projectId });
}
