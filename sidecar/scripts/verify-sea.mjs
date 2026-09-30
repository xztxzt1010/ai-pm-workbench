import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const sidecarRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const projectRoot = resolve(sidecarRoot, "..")
const targetTriple = process.env.TAURI_ENV_TARGET_TRIPLE ?? "x86_64-pc-windows-msvc"
const outputPath = join(sidecarRoot, "bin", `apm-sidecar-${targetTriple}.exe`)
const configPath = join(projectRoot, "src-tauri", "tauri.conf.json")

const metadata = await stat(outputPath).catch(() => undefined)
if (!metadata?.isFile()) throw new Error(`Self-contained Sidecar is missing: ${outputPath}`)
if (metadata.size < 50 * 1024 * 1024) throw new Error(`Self-contained Sidecar is unexpectedly small: ${metadata.size} bytes`)
const header = await readFile(outputPath, { encoding: null }).then((buffer) => buffer.subarray(0, 2).toString("ascii"))
if (header !== "MZ") throw new Error("Self-contained Sidecar is not a Windows PE executable")

const config = JSON.parse(await readFile(configPath, "utf8"))
if (!Array.isArray(config.bundle?.externalBin) || !config.bundle.externalBin.includes("../sidecar/bin/apm-sidecar")) {
  throw new Error("Tauri bundle.externalBin does not include the self-contained Sidecar contract")
}
const hash = createHash("sha256")
hash.update(await readFile(outputPath))
console.log(JSON.stringify({ event: "sidecar_verified", targetTriple, output: outputPath, sizeBytes: metadata.size, sha256: hash.digest("hex"), externalBin: "../sidecar/bin/apm-sidecar" }))
