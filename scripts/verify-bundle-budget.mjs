import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

function requireCondition(condition, message) {
  if (!condition) throw new Error(message)
}

const assetsRoot = "dist/assets"
const files = readdirSync(assetsRoot).map((name) => ({ name, bytes: statSync(join(assetsRoot, name)).size }))
const javascript = files.filter((file) => file.name.endsWith(".js"))
const stylesheets = files.filter((file) => file.name.endsWith(".css"))
const entry = javascript.find((file) => /^index-[a-zA-Z0-9_-]+\.js$/.test(file.name))
const totalJavaScriptBytes = javascript.reduce((total, file) => total + file.bytes, 0)
const totalCssBytes = stylesheets.reduce((total, file) => total + file.bytes, 0)

requireCondition(Boolean(entry), "production entry JavaScript asset is missing")
requireCondition(entry.bytes <= 525 * 1024, `entry JavaScript exceeds 525 KiB: ${entry.bytes} bytes`)
requireCondition(totalJavaScriptBytes <= 1_100 * 1024, `total JavaScript exceeds 1,100 KiB: ${totalJavaScriptBytes} bytes`)
requireCondition(totalCssBytes <= 100 * 1024, `total CSS exceeds 100 KiB: ${totalCssBytes} bytes`)
for (const expectedChunk of ["meetings-page-", "settings-page-", "project-detail-sheet-"]) {
  requireCondition(javascript.some((file) => file.name.startsWith(expectedChunk)), `expected lazy chunk is missing: ${expectedChunk}`)
}

console.log(JSON.stringify({
  status: "passed",
  entry: entry.name,
  entryBytes: entry.bytes,
  totalJavaScriptBytes,
  totalCssBytes,
  javascriptFiles: javascript.length,
}, null, 2))
