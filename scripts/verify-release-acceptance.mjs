import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { tmpdir } from "node:os"
import { validateReleaseManifest, verifyReleaseManifestFiles } from "./verify-release-manifest.mjs"

const SHA256 = /^[a-f0-9]{64}$/
const REQUIRED_CHECKS = [
  "clean-install",
  "first-launch",
  "no-provider-mode",
  "credential-manager",
  "first-meeting-analysis",
  "restart-persistence",
  "upgrade-preserves-data",
  "uninstall-data-policy",
  "sidecar-degrade-recover",
  "layout-keyboard-console",
]

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""))
}

function safeRelative(root, relativePath, label) {
  requireCondition(typeof relativePath === "string" && relativePath.length > 0 && !isAbsolute(relativePath), `${label} path must be relative`)
  const rootPath = resolve(root)
  const target = resolve(rootPath, relativePath)
  requireCondition(target.startsWith(`${rootPath}${sep}`), `${label} path escapes project root`)
  return target
}

function requireText(value, label, minimum = 1) {
  requireCondition(typeof value === "string" && value.trim().length >= minimum, `${label} is required`)
}

function containsCredential(value) {
  if (typeof value === "string") return /(?:bearer\s+[a-z0-9._-]{12,}|sk-[a-z0-9_-]{12,})/i.test(value)
  if (Array.isArray(value)) return value.some(containsCredential)
  if (value && typeof value === "object") return Object.values(value).some(containsCredential)
  return false
}

export function validateAcceptanceRecord(record, manifest) {
  requireCondition(record && typeof record === "object", "acceptance record must be an object")
  requireCondition(record.schemaVersion === 1, "unsupported acceptance schema version")
  requireCondition(record.product === manifest.product && record.version === manifest.version, "acceptance product/version does not match manifest")
  requireCondition(record.overallStatus === "passed", "acceptance record must remain pending until every check passes")
  requireText(record.tester, "tester")
  requireCondition(Number.isFinite(Date.parse(record.completedAt ?? "")), "completedAt must be an ISO timestamp")
  requireCondition(Date.parse(record.completedAt) >= Date.parse(manifest.generatedAt), "acceptance cannot predate the installer manifest")

  requireCondition(record.release && typeof record.release === "object", "release evidence is required")
  requireText(record.release.manifestPath, "release manifestPath")
  requireCondition(SHA256.test(record.release.manifestSha256 ?? ""), "release manifest SHA-256 is invalid")
  requireCondition(record.release.installer === manifest.installer, "accepted installer does not match manifest")
  requireCondition(record.release.installerSha256 === manifest.sha256, "accepted installer hash does not match manifest")
  requireCondition(record.release.installerSizeBytes === manifest.installerSizeBytes, "accepted installer size does not match manifest")

  const environment = record.environment
  requireCondition(environment && typeof environment === "object", "Windows environment evidence is required")
  requireText(environment.windowsEdition, "Windows edition")
  requireText(environment.windowsVersion, "Windows version")
  requireText(environment.windowsBuild, "Windows build")
  requireCondition(["x64", "arm64"].includes(environment.architecture), "Windows architecture must be x64 or arm64")
  requireCondition(environment.cleanMachine === true, "acceptance must run on a clean Windows environment")
  requireCondition(environment.nodeInstalled === false && environment.pythonInstalled === false && environment.databaseToolsInstalled === false, "acceptance environment must not depend on developer runtimes or database tools")

  requireCondition(Array.isArray(record.checks), "acceptance checks are required")
  const checkIds = record.checks.map((check) => check?.id)
  requireCondition(new Set(checkIds).size === checkIds.length, "acceptance check ids must be unique")
  requireCondition(checkIds.length === REQUIRED_CHECKS.length && REQUIRED_CHECKS.every((id) => checkIds.includes(id)), "acceptance checks do not match the required set")
  for (const check of record.checks) {
    requireCondition(check.status === "passed", `${check.id} must pass`)
    requireText(check.evidence, `${check.id} evidence`, 8)
  }
  requireCondition(Array.isArray(record.notes) && record.notes.every((note) => typeof note === "string"), "notes must be an array of strings")
  requireCondition(!containsCredential(record), "acceptance record appears to contain a credential")
  return record
}

export function verifyAcceptanceRecordFiles(recordPath, projectRoot) {
  const record = readJson(recordPath)
  const manifestPath = safeRelative(projectRoot, record?.release?.manifestPath, "release manifest")
  const manifest = readJson(manifestPath)
  const packageConfig = readJson(resolve(projectRoot, "package.json"))
  validateReleaseManifest(manifest, packageConfig.version)
  verifyReleaseManifestFiles(manifestPath, projectRoot)
  requireCondition(sha256(manifestPath) === record.release.manifestSha256, "release manifest hash does not match acceptance record")
  validateAcceptanceRecord(record, manifest)
  return { status: "passed", version: record.version, installer: record.release.installer, checks: record.checks.length }
}

export function createAcceptanceDraft(manifestPath, projectRoot, outputPath) {
  verifyReleaseManifestFiles(manifestPath, projectRoot)
  const manifest = readJson(manifestPath)
  const manifestRelativePath = relative(resolve(projectRoot), resolve(manifestPath)).replaceAll("\\", "/")
  safeRelative(projectRoot, manifestRelativePath, "release manifest")
  const draft = {
    schemaVersion: 1,
    product: manifest.product,
    version: manifest.version,
    overallStatus: "pending",
    tester: "",
    completedAt: "",
    release: {
      manifestPath: manifestRelativePath,
      manifestSha256: sha256(manifestPath),
      installer: manifest.installer,
      installerSha256: manifest.sha256,
      installerSizeBytes: manifest.installerSizeBytes,
    },
    environment: {
      windowsEdition: "",
      windowsVersion: "",
      windowsBuild: "",
      architecture: "x64",
      cleanMachine: false,
      nodeInstalled: null,
      pythonInstalled: null,
      databaseToolsInstalled: null,
    },
    checks: REQUIRED_CHECKS.map((id) => ({ id, status: "pending", evidence: "" })),
    notes: [],
  }
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8")
  return { status: "draft-created", output: resolve(outputPath), checks: draft.checks.length }
}

function verifyContract() {
  const projectRoot = mkdtempSync(join(tmpdir(), "apm-release-acceptance-"))
  try {
    const bundleRoot = join(projectRoot, "src-tauri", "target", "release", "bundle", "nsis")
    const sidecarRoot = join(projectRoot, "sidecar", "bin")
    mkdirSync(bundleRoot, { recursive: true })
    mkdirSync(sidecarRoot, { recursive: true })
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ version: "0.1.0" }))
    const installer = "Assistant.Product.Manager_0.1.0_x64-setup.exe"
    const sidecar = "apm-sidecar-x86_64-pc-windows-msvc.exe"
    const installerPath = join(bundleRoot, installer)
    const sidecarPath = join(sidecarRoot, sidecar)
    writeFileSync(installerPath, "installer-fixture")
    writeFileSync(sidecarPath, "sidecar-fixture")
    const manifest = {
      product: "Assistant Product Manager",
      version: "0.1.0",
      installer,
      installerSizeBytes: statSync(installerPath).size,
      sha256: sha256(installerPath),
      sidecar: { file: sidecar, relativePath: `sidecar/bin/${sidecar}`, sha256: sha256(sidecarPath), sizeBytes: statSync(sidecarPath).size, selfContained: true },
      generatedAt: "2026-07-17T00:00:00.000Z",
      acceptance: "manual-install-required",
    }
    const manifestPath = join(bundleRoot, "installer-manifest.json")
    const recordPath = join(bundleRoot, "release-acceptance.draft.json")
    writeFileSync(manifestPath, `\uFEFF${JSON.stringify(manifest)}`)
    createAcceptanceDraft(manifestPath, projectRoot, recordPath)
    const draft = JSON.parse(readFileSync(recordPath, "utf8"))
    let draftRejected = false
    try { validateAcceptanceRecord(draft, manifest) } catch { draftRejected = true }
    requireCondition(draftRejected, "pending acceptance draft was accepted")

    const accepted = {
      ...draft,
      overallStatus: "passed",
      tester: "release-tester",
      completedAt: "2026-07-17T01:00:00.000Z",
      environment: { windowsEdition: "Windows 11 Pro", windowsVersion: "24H2", windowsBuild: "26100.1", architecture: "x64", cleanMachine: true, nodeInstalled: false, pythonInstalled: false, databaseToolsInstalled: false },
      checks: draft.checks.map((check) => ({ ...check, status: "passed", evidence: `Observed ${check.id} successfully.` })),
    }
    writeFileSync(recordPath, JSON.stringify(accepted))
    verifyAcceptanceRecordFiles(recordPath, projectRoot)
    const invalidRecords = [
      { ...accepted, checks: accepted.checks.slice(1) },
      { ...accepted, environment: { ...accepted.environment, cleanMachine: false } },
      { ...accepted, checks: accepted.checks.map((check, index) => index === 0 ? { ...check, evidence: "Bearer abcdefghijklmnop" } : check) },
      { ...accepted, release: { ...accepted.release, manifestPath: "../installer-manifest.json" } },
    ]
    for (const invalid of invalidRecords) {
      writeFileSync(recordPath, JSON.stringify(invalid))
      let rejected = false
      try { verifyAcceptanceRecordFiles(recordPath, projectRoot) } catch { rejected = true }
      requireCondition(rejected, "invalid acceptance record was accepted")
    }
    writeFileSync(recordPath, JSON.stringify({ ...accepted, release: { ...accepted.release, manifestSha256: "a".repeat(64) } }))
    let hashRejected = false
    try { verifyAcceptanceRecordFiles(recordPath, projectRoot) } catch { hashRejected = true }
    requireCondition(hashRejected, "incorrect manifest hash was accepted")
  } finally {
    rmSync(projectRoot, { recursive: true, force: true })
  }
  return { status: "passed", contractCases: 8, requiredChecks: REQUIRED_CHECKS.length }
}

const args = process.argv.slice(2)
if (args[0] === "--record") {
  requireCondition(args[1] && args[2] === "--project-root" && args[3], "usage: --record <path> --project-root <path>")
  console.log(JSON.stringify(verifyAcceptanceRecordFiles(resolve(args[1]), resolve(args[3])), null, 2))
} else if (args[0] === "--create-draft") {
  requireCondition(args[1] && args[2] === "--manifest" && args[3] && args[4] === "--project-root" && args[5], "usage: --create-draft <output> --manifest <path> --project-root <path>")
  console.log(JSON.stringify(createAcceptanceDraft(resolve(args[3]), resolve(args[5]), resolve(args[1])), null, 2))
} else {
  console.log(JSON.stringify(verifyContract(), null, 2))
}
