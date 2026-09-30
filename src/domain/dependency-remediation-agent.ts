import { AppError } from "@/domain/app-error";
import { validateProjectDependencyDraft } from "@/domain/project-dependency";
import type { ProjectDependencyRecord } from "@/services/project-dependency-service";

export type DependencyRemediationSource = ProjectDependencyRecord;
export type DependencyCitationField = Exclude<
  keyof DependencyRemediationSource,
  "id" | "projectId" | "createdAt" | "updatedAt"
>;
export interface DependencyCitation {
  field: DependencyCitationField;
  quote: string;
}
export interface ProjectDependencyUpdateChanges {
  owner?: string;
  dueDate?: string;
  resolution?: string;
}
export interface DependencyRemediationProposal {
  dependencyId: string;
  expectedUpdatedAt: string;
  priority: "immediate" | "next" | "monitor";
  changes: ProjectDependencyUpdateChanges;
  rationale: string;
  citations: DependencyCitation[];
}
export interface DependencyRemediationOutput {
  schemaVersion: "1.0.0";
  proposals: DependencyRemediationProposal[];
  limitations: string[];
}

const priorities = ["immediate", "next", "monitor"] as const;
const changeKeys = ["owner", "dueDate", "resolution"] as const;
const citationFields: DependencyCitationField[] = [
  "title", "description", "dependencyType", "owner", "dueDate", "status", "resolution",
];

export const dependencyRemediationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "proposals", "limitations"],
  properties: {
    schemaVersion: { const: "1.0.0" },
    proposals: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["dependencyId", "expectedUpdatedAt", "priority", "changes", "rationale", "citations"],
        properties: {
          dependencyId: { type: "string", minLength: 1, maxLength: 200 },
          expectedUpdatedAt: { type: "string", minLength: 1, maxLength: 100 },
          priority: { type: "string", enum: priorities },
          changes: {
            type: "object",
            additionalProperties: false,
            minProperties: 1,
            properties: {
              owner: { type: "string", minLength: 1, maxLength: 200 },
              dueDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              resolution: { type: "string", minLength: 1, maxLength: 5000 },
            },
          },
          rationale: { type: "string", minLength: 1, maxLength: 2000 },
          citations: {
            type: "array", minItems: 1, maxItems: 8,
            items: {
              type: "object", additionalProperties: false, required: ["field", "quote"],
              properties: {
                field: { type: "string", enum: citationFields },
                quote: { type: "string", minLength: 1, maxLength: 5000 },
              },
            },
          },
        },
      },
    },
    limitations: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 300 } },
  },
} as const;

export function validateDependencyRemediationOutput(
  output: unknown,
  sources: DependencyRemediationSource[],
): DependencyRemediationOutput {
  if (!output || typeof output !== "object")
    throw new AppError("validation", "依赖处置 Agent 输出必须是对象");
  const candidate = output as Partial<DependencyRemediationOutput>;
  if (candidate.schemaVersion !== "1.0.0" || !Array.isArray(candidate.proposals) || candidate.proposals.length > 20 || !Array.isArray(candidate.limitations) || candidate.limitations.length > 10)
    throw new AppError("validation", "依赖处置 Agent 输出契约无效");
  const seen = new Set<string>();
  const proposals = candidate.proposals.map((proposal) => {
    const source = sources.find((item) => item.id === proposal?.dependencyId);
    if (!source || source.status === "resolved" || seen.has(source.id) || proposal.expectedUpdatedAt !== source.updatedAt || !priorities.includes(proposal.priority) || !proposal.changes || typeof proposal.changes !== "object" || Array.isArray(proposal.changes) || !proposal.rationale?.trim() || proposal.rationale.trim().length > 2000 || !Array.isArray(proposal.citations) || !proposal.citations.length || proposal.citations.length > 8)
      throw new AppError("validation", "依赖提案必须唯一绑定当前未解决依赖快照和证据");
    seen.add(source.id);
    const entries = Object.entries(proposal.changes);
    if (!entries.length || entries.some(([key]) => !changeKeys.includes(key as (typeof changeKeys)[number])))
      throw new AppError("validation", "依赖提案包含未授权字段");
    const merged = validateProjectDependencyDraft({
      title: source.title,
      description: source.description,
      dependencyType: source.dependencyType,
      owner: proposal.changes.owner ?? source.owner,
      dueDate: proposal.changes.dueDate ?? source.dueDate,
      resolution: proposal.changes.resolution ?? source.resolution,
    });
    const changes: ProjectDependencyUpdateChanges = {};
    if (proposal.changes.owner !== undefined && merged.owner !== source.owner && merged.owner) changes.owner = merged.owner;
    if (proposal.changes.dueDate !== undefined && merged.dueDate !== source.dueDate) changes.dueDate = merged.dueDate;
    if (proposal.changes.resolution !== undefined && merged.resolution !== source.resolution && merged.resolution) changes.resolution = merged.resolution;
    if (!Object.keys(changes).length) throw new AppError("validation", "依赖提案没有产生实际字段变化");
    const citations = proposal.citations.map((citation) => {
      if (!citationFields.includes(citation.field) || citation.quote !== String(source[citation.field]))
        throw new AppError("validation", "依赖提案引用未精确命中当前字段");
      return citation;
    });
    return { dependencyId: source.id, expectedUpdatedAt: source.updatedAt, priority: proposal.priority, changes, rationale: proposal.rationale.trim(), citations };
  });
  if (candidate.limitations.some((item) => typeof item !== "string" || !item.trim() || item.length > 300))
    throw new AppError("validation", "依赖处置限制条件无效");
  return { schemaVersion: "1.0.0", proposals, limitations: candidate.limitations.map((item) => item.trim()) };
}
