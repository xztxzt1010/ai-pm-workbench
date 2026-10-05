import { existsSync, readFileSync } from "node:fs"

const evals = {
  "project-qa:v2": "src/domain/project-qa.test.ts",
  "research-insight:v1": "src/domain/research-insight-agent.test.ts",
  "risk-review:v1": "src/domain/risk-review-agent.test.ts",
  "risk-review:v2": "src/domain/risk-remediation-agent.test.ts",
  "dependency-remediation:v1": "src/domain/dependency-remediation-agent.test.ts",
  "release-preparation:v1": "src/domain/release-preparation-agent.test.ts",
  "release-review:v1": "src/domain/release-review-agent.test.ts",
  "competitor-review:v1": "src/domain/competitor-review-agent.test.ts",
  "research-plan-review:v1": "src/domain/research-plan-review-agent.test.ts",
  "knowledge-review:v1": "src/domain/knowledge-review-agent.test.ts",
  "plan-engineer:v1": "src/domain/plan-engineer-agent.test.ts",
  "plan-engineer:v2": "src/domain/plan-engineer-agent.test.ts",
}
const missing = Object.entries(evals).filter(([, file]) => !existsSync(file)).map(([id, file]) => `${id}: missing ${file}`)
for (const [id, file] of Object.entries(evals)) {
  if (existsSync(file)) {
    const source = readFileSync(file, "utf8")
    if (!source.includes("describe(") || !source.includes("it(") || !source.includes("expect(")) missing.push(`${id}: eval must contain describe/it/expect assertions in ${file}`)
  }
}
if (missing.length) throw new Error(missing.join("\n"))
console.log(JSON.stringify({ status: "passed", agents: Object.keys(evals).length, evalFiles: Object.values(evals) }, null, 2))
