import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

const SHA256 = /^[a-f0-9]{64}$/
const SEMVER = /^\d+\.\d+\.\d+$/

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function safeRelative(root, relativePath, label) {
  requireCondition(typeof relativePath === "string" && relativePath.length > 0 && !isAbsolute(relativePath), `${label} path must be relative`)
  const rootPath = resolve(root)
  const target = resolve(rootPath, relativePath)
  requireCondition(target.startsWith(`${rootPath}${sep}`), `${label} path escapes project root`)
  return target
}

export function validateReleaseManifest(manifest, expectedVersion) {
  requireCondition(manifest && typeof manifest === "object", "manifest must be an object")
  requireCondition(manifest.product === "Assistant Product Manager", "unexpected manifest product")
  requireCondition(SEMVER.test(manifest.version ?? "") && manifest.version === expectedVersion, "manifest version does not match package version")
  requireCondition(typeof manifest.installer === "string" && basename(manifest.installer) === manifest.installer && manifest.installer.toLowerCase().endsWith(".exe"), "installer must be a safe .exe basename")
  requireCondition(Number.isSafeInteger(manifest.installerSizeBytes) && manifest.installerSizeBytes > 0, "installer size must be a positive integer")
  requireCondition(SHA256.test(manifest.sha256 ?? ""), "installer SHA-256 must be lowercase hexadecimal")
  requireCondition(manifest.sidecar && typeof manifest.sidecar === "object", "sidecar manifest is required")
  requireCondition(typeof manifest.sidecar.file === "string" && basename(manifest.sidecar.file) === manifest.sidecar.file && /^apm-sidecar-[a-z0-9_-]+\.exe$/i.test(manifest.sidecar.file), "sidecar file name is invalid")
  requireCondition(typeof manifest.sidecar.relativePath === "string", "sidecar relativePath is required")
  requireCondition(!isAbsolute(manifest.sidecar.relativePath) && !manifest.sidecar.relativePath.split(/[\\/]/).includes(".."), "sidecar relativePath must stay inside project root")
  requireCondition(Number.isSafeInteger(manifest.sidecar.sizeBytes) && manifest.sidecar.sizeBytes > 0, "sidecar size must be a positive integer")
  requireCondition(SHA256.test(manifest.sidecar.sha256 ?? ""), "sidecar SHA-256 must be lowercase hexadecimal")
  requireCondition(manifest.sidecar.selfContained === true, "sidecar must be self-contained")
  requireCondition(Number.isFinite(Date.parse(manifest.generatedAt ?? "")), "generatedAt must be an ISO timestamp")
  requireCondition(manifest.acceptance === "manual-install-required", "manual installation acceptance must remain required")
  return manifest
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""))
}

export function verifyReleaseManifestFiles(manifestPath, projectRoot) {
  const packageConfig = readJson(resolve(projectRoot, "package.json"))
  const manifest = validateReleaseManifest(readJson(manifestPath), packageConfig.version)
  const installerPath = resolve(dirname(manifestPath), manifest.installer)
  const sidecarPath = safeRelative(projectRoot, manifest.sidecar.relativePath, "sidecar")
  requireCondition(existsSync(installerPath) && statSync(installerPath).isFile(), "installer file is missing")
  requireCondition(existsSync(sidecarPath) && statSync(sidecarPath).isFile(), "sidecar file is missing")
  requireCondition(statSync(installerPath).size === manifest.installerSizeBytes, "installer size does not match manifest")
  requireCondition(statSync(sidecarPath).size === manifest.sidecar.sizeBytes, "sidecar size does not match manifest")
  requireCondition(sha256(installerPath) === manifest.sha256, "installer hash does not match manifest")
  requireCondition(sha256(sidecarPath) === manifest.sidecar.sha256, "sidecar hash does not match manifest")
  return { status: "passed", installer: manifest.installer, sidecar: manifest.sidecar.file, version: manifest.version }
}

function verifyContract() {
  const hash = "a".repeat(64)
  const fixture = { product: "Assistant Product Manager", version: "0.1.0", installer: "Assistant.Product.Manager_0.1.0_x64-setup.exe", installerSizeBytes: 1, sha256: hash, sidecar: { file: "apm-sidecar-x86_64-pc-windows-msvc.exe", relativePath: "sidecar/bin/apm-sidecar-x86_64-pc-windows-msvc.exe", sha256: hash, sizeBytes: 1, selfContained: true }, generatedAt: "2026-07-17T00:00:00.000Z", acceptance: "manual-install-required" }
  validateReleaseManifest(fixture, "0.1.0")
  for (const invalid of [
    { ...fixture, installer: "../escape.exe" },
    { ...fixture, sha256: "ABC" },
    { ...fixture, acceptance: "accepted" },
    { ...fixture, sidecar: { ...fixture.sidecar, selfContained: false } },
    { ...fixture, sidecar: { ...fixture.sidecar, relativePath: "../escape.exe" } },
  ]) {
    let rejected = false
    try { validateReleaseManifest(invalid, "0.1.0") } catch { rejected = true }
    requireCondition(rejected, "invalid release manifest fixture was accepted")
  }
  const projectRoot = mkdtempSync(join(tmpdir(), "apm-release-manifest-"))
  try {
    const bundleRoot = join(projectRoot, "bundle")
    const sidecarRoot = join(projectRoot, "sidecar", "bin")
    mkdirSync(bundleRoot, { recursive: true })
    mkdirSync(sidecarRoot, { recursive: true })
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ version: "0.1.0" }))
    const installerPath = join(bundleRoot, fixture.installer)
    const sidecarPath = join(sidecarRoot, fixture.sidecar.file)
    writeFileSync(installerPath, "installer-fixture")
    writeFileSync(sidecarPath, "sidecar-fixture")
    const fileFixture = {
      ...fixture,
      installerSizeBytes: statSync(installerPath).size,
      sha256: sha256(installerPath),
      sidecar: { ...fixture.sidecar, sizeBytes: statSync(sidecarPath).size, sha256: sha256(sidecarPath) },
    }
    const manifestPath = join(bundleRoot, "installer-manifest.json")
    writeFileSync(manifestPath, `\uFEFF${JSON.stringify(fileFixture)}`)
    verifyReleaseManifestFiles(manifestPath, projectRoot)
    writeFileSync(sidecarPath, "tampered-sidecar")
    let tamperRejected = false
    try { verifyReleaseManifestFiles(manifestPath, projectRoot) } catch { tamperRejected = true }
    requireCondition(tamperRejected, "tampered release file was accepted")
  } finally {
    rmSync(projectRoot, { recursive: true, force: true })
  }
  return { status: "passed", contractCases: 8 }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args[0] === "--manifest") {
    requireCondition(args[1] && args[2] === "--project-root" && args[3], "usage: --manifest <path> --project-root <path>")
    console.log(JSON.stringify(verifyReleaseManifestFiles(resolve(args[1]), resolve(args[3])), null, 2))
  } else {
    console.log(JSON.stringify(verifyContract(), null, 2))
  }
}
