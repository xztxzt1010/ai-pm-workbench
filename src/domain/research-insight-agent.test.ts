import { describe, expect, it } from "vitest"
import { validateResearchAgentOutput, type ResearchAgentSource } from "./research-insight-agent"
const sources: ResearchAgentSource[] = [{ entryId: "e1", title: "访谈", insight: "用户难以统一判断跨模块待办优先级", sourceRef: "interview://1" }]
describe("research insight agent fixed eval", () => {
  it("accepts exact current-project citations", () => expect(validateResearchAgentOutput({ schemaVersion: "1.0.0", findings: [{ title: "统一驾驶舱", statement: "需要统一优先级视图", citations: [{ entryId: "e1", quote: "跨模块待办优先级", sourceRef: "interview://1" }] }], limitations: ["仅包含一次访谈"] }, sources).findings).toHaveLength(1))
  it("rejects invented or cross-project evidence", () => expect(() => validateResearchAgentOutput({ schemaVersion: "1.0.0", findings: [{ title: "错误", statement: "虚构", citations: [{ entryId: "other", quote: "不存在", sourceRef: "web://x" }] }], limitations: [] }, sources)).toThrow("未精确命中"))
})
