export type KnowledgeReviewSeverity = "info" | "warning" | "blocker";
export type KnowledgeReviewCategory =
  | "missing_source"
  | "pending_confirmation"
  | "conflict"
  | "stale"
  | "provenance";

export interface KnowledgeReviewMemory {
  id: string;
  memoryType: string;
  status: string;
  title: string;
  content: string;
  sourceKind: string;
  sourceId?: string;
  validFrom?: string;
  validUntil?: string;
  conflictGroup?: string;
  confidence?: number;
  createdBy: string;
  updatedAt: string;
  sources: Array<{
    id: string;
    sourceKind: string;
    sourceId?: string;
    quote?: string;
    createdAt: string;
  }>;
  conflicts: Array<{
    relatedMemoryId: string;
    relatedTitle: string;
    relatedStatus: string;
    relationType: string;
    direction: string;
  }>;
}

export interface KnowledgeReviewCitation {
  memoryId: string;
  field: string;
  quote: string;
}
export interface KnowledgeReviewFinding {
  memoryId: string;
  severity: KnowledgeReviewSeverity;
  category: KnowledgeReviewCategory;
  summary: string;
  recommendation: string;
  citations: KnowledgeReviewCitation[];
}
export interface KnowledgeReviewOutput {
  schemaVersion: "1.0.0";
  findings: KnowledgeReviewFinding[];
  limitations: string[];
}
export const knowledgeReviewJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "findings", "limitations"],
  properties: {
    schemaVersion: { const: "1.0.0" },
    findings: { type: "array", maxItems: 30 },
    limitations: { type: "array", items: { type: "string" } },
  },
} as const;

export function validateKnowledgeReviewOutput(
  output: unknown,
  memories: KnowledgeReviewMemory[],
): KnowledgeReviewOutput {
  const value = output as Partial<KnowledgeReviewOutput>;
  if (
    value?.schemaVersion !== "1.0.0" ||
    !Array.isArray(value.findings) ||
    value.findings.length > 30 ||
    !Array.isArray(value.limitations)
  )
    throw new Error("知识管理审阅输出结构无效");
  const byId = new Map(memories.map((memory) => [memory.id, memory]));
  const findings = value.findings.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      !byId.has(item.memoryId) ||
      !["info", "warning", "blocker"].includes(item.severity) ||
      ![
        "missing_source",
        "pending_confirmation",
        "conflict",
        "stale",
        "provenance",
      ].includes(item.category) ||
      typeof item.summary !== "string" ||
      typeof item.recommendation !== "string" ||
      !Array.isArray(item.citations) ||
      item.citations.length === 0
    )
      throw new Error("知识管理审阅发现无效");
    const memory = byId.get(item.memoryId)!;
    for (const citation of item.citations) {
      if (
        !citation ||
        citation.memoryId !== memory.id ||
        typeof citation.field !== "string" ||
        typeof citation.quote !== "string" ||
        !citation.quote.trim()
      )
        throw new Error("知识管理审阅引用无效");
      const field = citation.field as keyof KnowledgeReviewMemory;
      const expected =
        typeof memory[field] === "string" || typeof memory[field] === "number"
          ? String(memory[field])
          : undefined;
      const sourceQuote = memory.sources.some(
        (source) =>
          citation.field === "sourceQuote" && source.quote === citation.quote,
      );
      const conflict = memory.conflicts.some(
        (item) =>
          (citation.field === "conflictTitle" &&
            item.relatedTitle === citation.quote) ||
          (citation.field === "conflictStatus" &&
            item.relatedStatus === citation.quote),
      );
      if (expected !== citation.quote && !sourceQuote && !conflict)
        throw new Error("知识管理审阅引用未命中快照");
    }
    return item as KnowledgeReviewFinding;
  });
  return {
    schemaVersion: "1.0.0",
    findings,
    limitations: value.limitations.map(String),
  };
}
