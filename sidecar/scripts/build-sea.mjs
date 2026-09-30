import { build } from "esbuild"
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const sidecarRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const targetTriple = process.env.TAURI_ENV_TARGET_TRIPLE ?? "x86_64-pc-windows-msvc"
if (process.platform !== "win32") throw new Error("Node SEA packaging currently supports Windows only")
const targetArchitecture = targetTriple.split("-")[0]
const processArchitecture = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : process.arch
if (targetArchitecture !== processArchitecture) {
  throw new Error(`Node SEA packaging requires a ${targetArchitecture} Node runtime; current process is ${processArchitecture}`)
}

const buildRoot = join(sidecarRoot, ".sea")
const outputDirectory = join(sidecarRoot, "bin")
const bundlePath = join(buildRoot, "sidecar.cjs")
const blobPath = join(buildRoot, "sidecar.blob")
const outputPath = join(outputDirectory, `apm-sidecar-${targetTriple}.exe`)
const seaConfigPath = join(buildRoot, "sea-config.json")
const postjectCli = join(sidecarRoot, "node_modules", "postject", "dist", "cli.js")

await rm(buildRoot, { recursive: true, force: true })
await mkdir(outputDirectory, { recursive: true })
await mkdir(buildRoot, { recursive: true })
await build({ entryPoints: [join(sidecarRoot, "src", "index.mjs")], bundle: true, platform: "node", format: "cjs", outfile: bundlePath, minify: true })
await writeFile(seaConfigPath, JSON.stringify({ main: bundlePath, output: blobPath, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false }))

const sea = spawnSync(process.execPath, ["--experimental-sea-config", seaConfigPath], { stdio: "inherit" })
if (sea.status !== 0) throw new Error("Node SEA blob generation failed")
await copyFile(process.execPath, outputPath)
const fuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
const inject = spawnSync(process.execPath, [postjectCli, outputPath, "NODE_SEA_BLOB", blobPath, "--sentinel-fuse", fuse], { stdio: "inherit" })
if (inject.status !== 0) throw new Error("Node SEA resource injection failed")

const packageJson = JSON.parse(await readFile(join(sidecarRoot, "package.json"), "utf8"))
console.log(JSON.stringify({ event: "sidecar_packaged", targetTriple, output: outputPath, node: process.version, packageVersion: packageJson.version }))
