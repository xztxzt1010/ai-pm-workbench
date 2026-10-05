import { readFileSync } from "node:fs"

const EXPECTED_VERSION = "0.2.0"
const failures = []

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function requireEq(label, actual, expected) {
  if (actual !== expected) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

const pkg = readJson("package.json")
requireEq("package.json version", pkg.version, EXPECTED_VERSION)
requireEq("package.json private", pkg.private, true)
requireEq("package.json license", pkg.license, "MIT")

const rootLock = readJson("package-lock.json")
requireEq("package-lock.json top-level version", rootLock.version, EXPECTED_VERSION)
requireEq("package-lock.json packages[''].version", rootLock.packages?.[""]?.version, EXPECTED_VERSION)

const sidecarPkg = readJson("sidecar/package.json")
requireEq("sidecar/package.json version", sidecarPkg.version, EXPECTED_VERSION)
requireEq("sidecar/package.json private", sidecarPkg.private, true)
requireEq("sidecar/package.json license", sidecarPkg.license, "MIT")

const sidecarLock = readJson("sidecar/package-lock.json")
requireEq("sidecar/package-lock.json top-level version", sidecarLock.version, EXPECTED_VERSION)
requireEq("sidecar/package-lock.json packages[''].version", sidecarLock.packages?.[""]?.version, EXPECTED_VERSION)

const tauri = readJson("src-tauri/tauri.conf.json")
requireEq("tauri.conf.json version", tauri.version, EXPECTED_VERSION)

const cargoToml = readFileSync("src-tauri/Cargo.toml", "utf8")
const cargoVersion = cargoToml.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1]
const cargoLicense = cargoToml.match(/^\s*license\s*=\s*"([^"]*)"/m)?.[1]
requireEq("Cargo.toml package version", cargoVersion, EXPECTED_VERSION)
requireEq("Cargo.toml package license", cargoLicense, "MIT")

const cargoLock = readFileSync("src-tauri/Cargo.lock", "utf8")
const appEntry = cargoLock.match(/\[\[package\]\]\s+name\s*=\s*"app"\s+version\s*=\s*"([^"]+)"/)
requireEq("Cargo.lock app package version", appEntry?.[1], EXPECTED_VERSION)

if (failures.length) {
  throw new Error(`version metadata mismatch:\n${failures.join("\n")}`)
}

console.log(
  JSON.stringify(
    {
      status: "passed",
      expectedVersion: EXPECTED_VERSION,
      matrix: {
        package: pkg.version,
        packageLockTop: rootLock.version,
        packageLockPkg0: rootLock.packages[""].version,
        sidecarPackage: sidecarPkg.version,
        sidecarLockTop: sidecarLock.version,
        sidecarLockPkg0: sidecarLock.packages[""].version,
        tauri: tauri.version,
        cargoToml: cargoVersion,
        cargoLockApp: appEntry[1],
      },
      private: { root: pkg.private, sidecar: sidecarPkg.private },
      license: { root: pkg.license, sidecar: sidecarPkg.license, cargo: cargoLicense },
    },
    null,
    2,
  ),
)
