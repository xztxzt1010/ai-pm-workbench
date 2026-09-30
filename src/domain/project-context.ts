import type {
  ConfirmationItem,
  Milestone,
  Project,
  RequirementDocument,
} from "@/domain/models";

export const projectContextSectionKeys = [
  "goal",
  "requirements",
  "prd",
  "technical_solution",
  "development",
  "testing",
  "risks",
  "decisions",
] as const;

export type ProjectContextSectionKey =
  (typeof projectContextSectionKeys)[number];
export type ProjectContextStatus = "available" | "stale" | "missing";

export interface ProjectContextSource {
  id: string;
  kind:
    | "project"
    | "requirement"
    | "product_document"
    | "knowledge_item"
    | "risk"
    | "decision"
    | "release";
  title: string;
  version: string;
  updatedAt: string;
  owner?: string;
  locator: string;
  summary: string;
  formal: boolean;
}

export function projectContextRecordLocator(
  kind: ProjectContextSource["kind"],
  id: string,
) {
  if (!id.trim()) throw new Error("上下文记录定位 ID 不能为空");
  if (kind === "project") return "project-settings";
  const prefixes: Record<
    Exclude<ProjectContextSource["kind"], "project">,
    string
  > = {
    requirement: "project-requirement",
    product_document: "project-document",
    knowledge_item: "project-knowledge-item",
    risk: "project-risk",
    decision: "project-decision",
    release: "project-release",
  };
  return `${prefixes[kind]}-${id}`;
}

export interface ProjectContextSection {
  key: ProjectContextSectionKey;
  label: string;
  status: ProjectContextStatus;
  summary: string;
  updatedAt?: string;
  owner?: string;
  sources: ProjectContextSource[];
  candidateSources: ProjectContextSource[];
  omittedSourceCount: number;
  omittedCandidateCount: number;
  gap?: string;
}

export interface ProjectContextSnapshot {
  schemaVersion: "apm-project-context:v1";
  project: Pick<Project, "id" | "name" | "status" | "archivedAt">;
  generatedAt: string;
  freshnessDays: number;
  sourceLimitPerSection: number;
  includePersonalKnowledge: false;
  sections: ProjectContextSection[];
  totals: { available: number; stale: number; missing: number };
}

interface DocumentInput {
  id: string;
  projectId: string;
  title: string;
  documentType: "prd" | "design_brief" | "markdown";
  status: "draft" | "confirmed" | "archived";
  versionNumber: number;
  contentMarkdown: string;
  updatedAt: string;
}

interface KnowledgeInput {
  id: string;
  projectId?: string;
  title: string;
  itemType:
    | "meeting_record"
    | "technical_discussion"
    | "product_idea"
    | "ai_learning"
    | "project_decision";
  status: "draft" | "confirmed" | "archived";
  contentVersion: number;
  contentMarkdown: string;
  updatedAt: string;
}

interface RiskInput {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: "open" | "mitigated" | "accepted" | "closed";
  owner: string;
  updatedAt: string;
}

interface DecisionInput {
  id: string;
  projectId: string;
  title: string;
  decision: string;
  status: "proposed" | "confirmed" | "revisit" | "archived";
  versionNumber: number;
  createdBy: "user" | "agent";
  updatedAt: string;
}

interface ReleaseInput {
  id: string;
  projectId: string;
  title: string;
  status: "planned" | "ready" | "released" | "reviewed" | "cancelled";
  result: string;
  retrospective: string;
  updatedAt: string;
}

export interface BuildProjectContextInput {
  project: Project;
  milestones: Milestone[];
  confirmations: ConfirmationItem[];
  requirements: RequirementDocument[];
  documents: DocumentInput[];
  knowledgeItems: KnowledgeInput[];
  risks: RiskInput[];
  decisions: DecisionInput[];
  releases: ReleaseInput[];
  generatedAt: string;
  freshnessDays?: number;
  sourceLimitPerSection?: number;
}

const labels: Record<ProjectContextSectionKey, string> = {
  goal: "项目目标",
  requirements: "用户需求",
  prd: "PRD",
  technical_solution: "技术方案",
  development: "开发状态",
  testing: "测试状态",
  risks: "风险列表",
  decisions: "决策历史",
};

function compact(value: string, maxLength = 360) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1)}…`
    : normalized;
}

function latest(sources: ProjectContextSource[]) {
  return [...sources].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

function section(
  key: ProjectContextSectionKey,
  summary: string,
  formalSources: ProjectContextSource[],
  candidates: ProjectContextSource[],
  generatedAt: string,
  freshnessDays: number,
  limit: number,
  gap?: string,
): ProjectContextSection {
  const sortedSources = latest(formalSources);
  const sortedCandidates = latest(candidates);
  const updatedAt = sortedSources[0]?.updatedAt;
  const age = updatedAt ? Date.parse(generatedAt) - Date.parse(updatedAt) : 0;
  const status: ProjectContextStatus = !sortedSources.length
    ? "missing"
    : age > freshnessDays * 86_400_000
      ? "stale"
      : "available";
  return {
    key,
    label: labels[key],
    status,
    summary,
    updatedAt,
    owner: sortedSources.find((source) => source.owner)?.owner,
    sources: sortedSources.slice(0, limit),
    candidateSources: sortedCandidates.slice(0, limit),
    omittedSourceCount: Math.max(0, sortedSources.length - limit),
    omittedCandidateCount: Math.max(0, sortedCandidates.length - limit),
    gap: status === "missing" ? gap : undefined,
  };
}

function assertProject(
  projectId: string,
  records: Array<{ projectId?: string }>,
  label: string,
) {
  if (records.some((record) => record.projectId !== projectId)) {
    throw new Error(`${label}包含跨项目来源`);
  }
}

export function buildProjectContext(
  input: BuildProjectContextInput,
): ProjectContextSnapshot {
  const freshnessDays = input.freshnessDays ?? 30;
  const sourceLimit = input.sourceLimitPerSection ?? 5;
  if (
    !Number.isInteger(freshnessDays) ||
    freshnessDays < 1 ||
    freshnessDays > 365
  )
    throw new Error("上下文新鲜度天数无效");
  if (!Number.isInteger(sourceLimit) || sourceLimit < 1 || sourceLimit > 20)
    throw new Error("上下文来源限额无效");
  const projectId = input.project.id;
  assertProject(projectId, input.milestones, "里程碑");
  assertProject(projectId, input.confirmations, "确认事项");
  assertProject(
    projectId,
    input.requirements.map((item) => item.card),
    "需求",
  );
  assertProject(projectId, input.documents, "产品文档");
  assertProject(projectId, input.knowledgeItems, "知识记录");
  assertProject(projectId, input.risks, "风险");
  assertProject(projectId, input.decisions, "决策");
  assertProject(projectId, input.releases, "发布");

  const projectSource: ProjectContextSource = {
    id: input.project.id,
    kind: "project",
    title: input.project.name,
    version: input.project.updatedAt,
    updatedAt: input.project.updatedAt,
    owner: input.project.owner,
    locator: projectContextRecordLocator("project", input.project.id),
    summary: compact(input.project.goal),
    formal: true,
  };
  const confirmedRequirements = input.requirements.filter(
    (item) =>
      item.card.status === "confirmed" && item.currentVersion.isConfirmed,
  );
  const requirementSources = confirmedRequirements.map<ProjectContextSource>(
    (item) => ({
      id: item.card.id,
      kind: "requirement",
      title: item.currentVersion.title,
      version: String(item.currentVersion.versionNumber),
      updatedAt: item.card.updatedAt,
      locator: projectContextRecordLocator("requirement", item.card.id),
      summary: compact(item.currentVersion.content.description),
      formal: true,
    }),
  );
  const prdSources = input.documents
    .filter(
      (item) => item.documentType === "prd" && item.status === "confirmed",
    )
    .map<ProjectContextSource>((item) => ({
      id: item.id,
      kind: "product_document",
      title: item.title,
      version: String(item.versionNumber),
      updatedAt: item.updatedAt,
      locator: projectContextRecordLocator("product_document", item.id),
      summary: compact(item.contentMarkdown),
      formal: true,
    }));
  const technicalCandidates = input.knowledgeItems
    .filter(
      (item) =>
        item.itemType === "technical_discussion" && item.status === "confirmed",
    )
    .map<ProjectContextSource>((item) => ({
      id: item.id,
      kind: "knowledge_item",
      title: item.title,
      version: String(item.contentVersion),
      updatedAt: item.updatedAt,
      locator: projectContextRecordLocator("knowledge_item", item.id),
      summary: compact(item.contentMarkdown),
      formal: false,
    }));
  const riskSources = input.risks.map<ProjectContextSource>((item) => ({
    id: item.id,
    kind: "risk",
    title: item.title,
    version: item.updatedAt,
    updatedAt: item.updatedAt,
    owner: item.owner || undefined,
    locator: projectContextRecordLocator("risk", item.id),
    summary: compact(`${item.status} · ${item.description}`),
    formal: true,
  }));
  const formalDecisions = input.decisions.filter(
    (item) => item.status === "confirmed" || item.status === "revisit",
  );
  const decisionSources = formalDecisions.map<ProjectContextSource>((item) => ({
    id: item.id,
    kind: "decision",
    title: item.title,
    version: String(item.versionNumber),
    updatedAt: item.updatedAt,
    locator: projectContextRecordLocator("decision", item.id),
    summary: compact(item.decision),
    formal: true,
  }));
  const testCandidates = input.releases
    .filter((item) => item.status === "released" || item.status === "reviewed")
    .map<ProjectContextSource>((item) => ({
      id: item.id,
      kind: "release",
      title: item.title,
      version: item.updatedAt,
      updatedAt: item.updatedAt,
      locator: projectContextRecordLocator("release", item.id),
      summary: compact(
        item.result || item.retrospective || "发布记录未填写结果",
      ),
      formal: false,
    }));
  const openRisks = input.risks.filter(
    (item) => item.status !== "closed",
  ).length;
  const pendingRequirements =
    input.requirements.length - confirmedRequirements.length;
  const pendingDecisions = input.decisions.length - formalDecisions.length;
  const pendingConfirmations = input.confirmations.filter(
    (item) => item.status === "pending",
  ).length;
  const sections = [
    section(
      "goal",
      compact(input.project.goal) || "未填写项目目标",
      input.project.goal.trim() ? [projectSource] : [],
      [],
      input.generatedAt,
      freshnessDays,
      sourceLimit,
      "项目设置中尚未填写目标",
    ),
    section(
      "requirements",
      `已确认 ${confirmedRequirements.length} 条；非正式/未确认 ${pendingRequirements} 条`,
      requirementSources,
      [],
      input.generatedAt,
      freshnessDays,
      sourceLimit,
      "尚无已确认的用户需求",
    ),
    section(
      "prd",
      `已确认 PRD ${prdSources.length} 份`,
      prdSources,
      [],
      input.generatedAt,
      freshnessDays,
      sourceLimit,
      "尚无已确认的 PRD",
    ),
    section(
      "technical_solution",
      technicalCandidates.length
        ? `已有 ${technicalCandidates.length} 条已确认技术讨论，但它们不等同于正式技术方案`
        : "尚无正式技术方案或候选技术讨论",
      [],
      technicalCandidates,
      input.generatedAt,
      freshnessDays,
      sourceLimit,
      "当前模型没有独立技术方案正式对象；技术讨论仅作为候选材料",
    ),
    section(
      "development",
      `项目状态 ${input.project.status}，进度 ${input.project.progress}%；里程碑 ${input.milestones.length} 个；待确认事项 ${pendingConfirmations} 个`,
      [projectSource],
      [],
      input.generatedAt,
      freshnessDays,
      sourceLimit,
    ),
    section(
      "testing",
      testCandidates.length
        ? `已有 ${testCandidates.length} 条发布结果候选，但它们不等同于正式测试状态`
        : "尚无正式测试报告或测试状态",
      [],
      testCandidates,
      input.generatedAt,
      freshnessDays,
      sourceLimit,
      "当前模型没有独立测试报告/缺陷/覆盖率正式对象；发布记录仅作为候选材料",
    ),
    section(
      "risks",
      `风险 ${input.risks.length} 条，其中未关闭 ${openRisks} 条`,
      riskSources,
      [],
      input.generatedAt,
      freshnessDays,
      sourceLimit,
      "尚无正式风险记录；这不代表项目没有风险",
    ),
    section(
      "decisions",
      `正式决策 ${formalDecisions.length} 条；提议或归档 ${pendingDecisions} 条`,
      decisionSources,
      [],
      input.generatedAt,
      freshnessDays,
      sourceLimit,
      "尚无已确认或待复查的正式决策",
    ),
  ];
  return {
    schemaVersion: "apm-project-context:v1",
    project: {
      id: input.project.id,
      name: input.project.name,
      status: input.project.status,
      archivedAt: input.project.archivedAt,
    },
    generatedAt: input.generatedAt,
    freshnessDays,
    sourceLimitPerSection: sourceLimit,
    includePersonalKnowledge: false,
    sections,
    totals: {
      available: sections.filter((item) => item.status === "available").length,
      stale: sections.filter((item) => item.status === "stale").length,
      missing: sections.filter((item) => item.status === "missing").length,
    },
  };
}

export function renderProjectContextMarkdown(snapshot: ProjectContextSnapshot) {
  const lines = [
    `# ${snapshot.project.name} · 项目上下文包`,
    "",
    `- Schema：${snapshot.schemaVersion}`,
    `- 项目 ID：${snapshot.project.id}`,
    `- 项目状态：${snapshot.project.status}${snapshot.project.archivedAt ? "（已归档，只读）" : ""}`,
    `- 生成时间：${snapshot.generatedAt}`,
    `- 新鲜度提示：正式来源超过 ${snapshot.freshnessDays} 天未更新时标记为“过期”`,
    `- 每类来源上限：${snapshot.sourceLimitPerSection}`,
    "- 个人知识：未加入（必须显式选择并审计）",
    "",
    "> 本包只包含有界摘要和精确来源身份。缺口及候选材料不是项目事实。",
  ];
  for (const item of snapshot.sections) {
    const status =
      item.status === "available"
        ? "已有"
        : item.status === "stale"
          ? "过期"
          : "缺失";
    lines.push("", `## ${item.label} · ${status}`, "", item.summary);
    if (item.updatedAt) lines.push("", `- 最后更新：${item.updatedAt}`);
    if (item.owner) lines.push(`- 负责人：${item.owner}`);
    if (item.gap) lines.push(`- 信息缺口：${item.gap}`);
    if (item.sources.length) {
      lines.push("", "### 正式来源", "");
      for (const source of item.sources)
        lines.push(
          `- [${source.kind}] ${source.title} · ID ${source.id} · 版本 ${source.version} · ${source.updatedAt}\n  - 摘要：${source.summary}`,
        );
      if (item.omittedSourceCount)
        lines.push(`- 另有 ${item.omittedSourceCount} 条正式来源因预算未展开`);
    }
    if (item.candidateSources.length) {
      lines.push("", "### 候选材料（非正式事实）", "");
      for (const source of item.candidateSources)
        lines.push(
          `- [${source.kind}] ${source.title} · ID ${source.id} · 版本 ${source.version} · ${source.updatedAt}\n  - 摘要：${source.summary}`,
        );
      if (item.omittedCandidateCount)
        lines.push(
          `- 另有 ${item.omittedCandidateCount} 条候选材料因预算未展开`,
        );
    }
  }
  return `${lines.join("\n")}\n`;
}
