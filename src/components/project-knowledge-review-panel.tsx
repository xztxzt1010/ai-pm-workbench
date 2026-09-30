import { useEffect, useState } from "react";
import { loadProviderConfig } from "@/data/provider-settings";
import {
  listProjectMemories,
  listProjectMemoryConflicts,
  listProjectMemorySources,
} from "@/services/project-memory-service";
import { generateKnowledgeReview } from "@/services/structured-generation-service";
import type {
  KnowledgeReviewMemory,
  KnowledgeReviewOutput,
} from "@/domain/knowledge-review-agent";

export function ProjectKnowledgeReviewPanel({
  projectId,
  desktopRuntime,
  readOnly,
}: {
  projectId: string;
  desktopRuntime: boolean;
  readOnly?: boolean;
}) {
  const [memories, setMemories] = useState<KnowledgeReviewMemory[]>([]);
  const [review, setReview] = useState<KnowledgeReviewOutput>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!desktopRuntime) return;
    void listProjectMemories(true, projectId, undefined, 50).then(
      async (rows) => {
        const enriched = await Promise.all(
          rows.map(async (row) => {
            const [sources, conflicts] = await Promise.all([
              listProjectMemorySources(true, projectId, row.id),
              listProjectMemoryConflicts(true, projectId, row.id),
            ]);
            return { ...row, sources, conflicts };
          }),
        );
        setMemories(enriched);
      },
    );
  }, [desktopRuntime, projectId]);
  async function runReview() {
    setBusy(true);
    try {
      const result = await generateKnowledgeReview(
        projectId,
        memories,
        await loadProviderConfig(true),
        desktopRuntime,
      );
      setReview(result.output);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-900">知识管理审阅</h3>
          <p className="text-xs text-slate-500">
            只读检查来源缺口、待确认记忆和冲突关系
          </p>
        </div>
        <button
          className="rounded-md bg-slate-900 px-3 py-2 text-xs text-white disabled:opacity-50"
          disabled={readOnly || busy || !memories.length}
          onClick={() => void runReview()}
        >
          {busy ? "审阅中…" : "运行审阅"}
        </button>
      </div>
      {review && (
        <div className="mt-3 space-y-2">
          {review.findings.map((finding, index) => (
            <div
              key={`${finding.memoryId}-${index}`}
              className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm"
            >
              <div className="font-medium">
                {finding.severity} · {finding.category}
              </div>
              <div>{finding.summary}</div>
              <div className="text-xs text-slate-500">
                建议：{finding.recommendation}
              </div>
            </div>
          ))}
          {!review.findings.length && (
            <div className="text-sm text-slate-500">
              未发现需要复查的知识问题。
            </div>
          )}
        </div>
      )}
    </section>
  );
}
