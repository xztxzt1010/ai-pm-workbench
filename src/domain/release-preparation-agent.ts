import { AppError } from "@/domain/app-error";
import { validateReleaseDraft } from "@/domain/release";
import type { ReleaseRecord } from "@/services/release-service";

export interface ReleasePreparationSource { id: string; projectId: string; title: string; scope: string[]; checklist: string[]; rollbackPlan: string; result: string; retrospective: string; followUp: string[]; status: ReleaseRecord["status"]; targetDate: string; createdAt: string; updatedAt: string }
export type ReleasePreparationCitationField = Exclude<keyof ReleasePreparationSource, "id" | "projectId" | "createdAt" | "updatedAt">;
export interface ReleasePreparationCitation { field: ReleasePreparationCitationField; quote: string }
export interface ReleasePreparationChanges { scope?: string[]; checklist?: string[]; rollbackPlan?: string; targetDate?: string }
export interface ReleasePreparationProposal { releaseId: string; expectedUpdatedAt: string; priority: "immediate" | "next" | "monitor"; changes: ReleasePreparationChanges; rationale: string; citations: ReleasePreparationCitation[] }
export interface ReleasePreparationOutput { schemaVersion: "1.0.0"; proposals: ReleasePreparationProposal[]; limitations: string[] }

const priorities = ["immediate", "next", "monitor"] as const;
const changeKeys = ["scope", "checklist", "rollbackPlan", "targetDate"] as const;
const citationFields: ReleasePreparationCitationField[] = ["title", "scope", "checklist", "rollbackPlan", "result", "retrospective", "followUp", "status", "targetDate"];
const listSchema = { type: "array", maxItems: 100, items: { type: "string", minLength: 1, maxLength: 1000 } } as const;
export const releasePreparationJsonSchema = {
  type: "object", additionalProperties: false, required: ["schemaVersion", "proposals", "limitations"], properties: {
    schemaVersion: { const: "1.0.0" }, proposals: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false,
      required: ["releaseId", "expectedUpdatedAt", "priority", "changes", "rationale", "citations"], properties: {
        releaseId: { type: "string", minLength: 1, maxLength: 200 }, expectedUpdatedAt: { type: "string", minLength: 1, maxLength: 100 }, priority: { type: "string", enum: priorities },
        changes: { type: "object", additionalProperties: false, minProperties: 1, properties: { scope: listSchema, checklist: listSchema, rollbackPlan: { type: "string", minLength: 1, maxLength: 5000 }, targetDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } } },
        rationale: { type: "string", minLength: 1, maxLength: 2000 }, citations: { type: "array", minItems: 1, maxItems: 8, items: { type: "object", additionalProperties: false, required: ["field", "quote"], properties: { field: { type: "string", enum: citationFields }, quote: { type: "string", minLength: 1, maxLength: 5000 } } } },
      } } }, limitations: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 300 } },
  },
} as const;

function parseList(value: string, label: string): string[] { try { const parsed = JSON.parse(value); if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) throw new Error(); return parsed; } catch { throw new AppError("validation", `${label}数据已损坏`); } }
export function releaseRecordToPreparationSource(record: ReleaseRecord): ReleasePreparationSource { return { id: record.id, projectId: record.projectId, title: record.title, scope: parseList(record.scopeJson, "发布范围"), checklist: parseList(record.checklistJson, "检查清单"), rollbackPlan: record.rollbackPlan, result: record.result, retrospective: record.retrospective, followUp: parseList(record.followUpJson, "跟进事项"), status: record.status, targetDate: record.targetDate, createdAt: record.createdAt, updatedAt: record.updatedAt }; }

export function validateReleasePreparationOutput(output: unknown, sources: ReleasePreparationSource[]): ReleasePreparationOutput {
  if (!output || typeof output !== "object") throw new AppError("validation", "发布准备提案输出必须是对象");
  const candidate = output as Partial<ReleasePreparationOutput>;
  if (candidate.schemaVersion !== "1.0.0" || !Array.isArray(candidate.proposals) || candidate.proposals.length > 20 || !Array.isArray(candidate.limitations) || candidate.limitations.length > 10) throw new AppError("validation", "发布准备提案输出契约无效");
  const seen = new Set<string>();
  const proposals = candidate.proposals.map((proposal) => {
    const source = sources.find((item) => item.id === proposal?.releaseId);
    if (!source || !["planned", "ready"].includes(source.status) || seen.has(source.id) || proposal.expectedUpdatedAt !== source.updatedAt || !priorities.includes(proposal.priority) || !proposal.changes || typeof proposal.changes !== "object" || Array.isArray(proposal.changes) || !proposal.rationale?.trim() || proposal.rationale.length > 2000 || !Array.isArray(proposal.citations) || !proposal.citations.length || proposal.citations.length > 8) throw new AppError("validation", "发布提案必须唯一绑定当前发布前快照和证据");
    seen.add(source.id);
    if (!Object.keys(proposal.changes).length || Object.keys(proposal.changes).some((key) => !changeKeys.includes(key as (typeof changeKeys)[number]))) throw new AppError("validation", "发布提案包含未授权字段");
    const merged = validateReleaseDraft({ title: source.title, scope: proposal.changes.scope ?? source.scope, checklist: proposal.changes.checklist ?? source.checklist, rollbackPlan: proposal.changes.rollbackPlan ?? source.rollbackPlan, targetDate: proposal.changes.targetDate ?? source.targetDate, result: source.result, retrospective: source.retrospective, followUp: source.followUp });
    const changes: ReleasePreparationChanges = {};
    if (proposal.changes.scope !== undefined && JSON.stringify(merged.scope) !== JSON.stringify(source.scope)) changes.scope = merged.scope;
    if (proposal.changes.checklist !== undefined && JSON.stringify(merged.checklist) !== JSON.stringify(source.checklist)) changes.checklist = merged.checklist;
    if (proposal.changes.rollbackPlan !== undefined && merged.rollbackPlan !== source.rollbackPlan && merged.rollbackPlan) changes.rollbackPlan = merged.rollbackPlan;
    if (proposal.changes.targetDate !== undefined && merged.targetDate !== source.targetDate) changes.targetDate = merged.targetDate;
    if (!Object.keys(changes).length) throw new AppError("validation", "发布提案没有实际字段变化");
    const citations = proposal.citations.map((citation) => { const stored = source[citation.field]; const exact = citationFields.includes(citation.field) && (Array.isArray(stored) ? stored.includes(citation.quote) : String(stored) === citation.quote); if (!exact) throw new AppError("validation", "发布提案引用未精确命中当前字段"); return citation; });
    return { releaseId: source.id, expectedUpdatedAt: source.updatedAt, priority: proposal.priority, changes, rationale: proposal.rationale.trim(), citations };
  });
  if (candidate.limitations.some((item) => typeof item !== "string" || !item.trim() || item.length > 300)) throw new AppError("validation", "发布准备限制条件无效");
  return { schemaVersion: "1.0.0", proposals, limitations: candidate.limitations.map((item) => item.trim()) };
}
