import { createSidecarServer, listenOnLoopback } from "./server.mjs"

const token = process.env.APM_SIDECAR_TOKEN
const requestedPort = Number(process.env.APM_SIDECAR_PORT ?? "0")
const server = createSidecarServer({ token })

async function main() {
  try {
    const address = await listenOnLoopback(server, requestedPort)
    process.stdout.write(`${JSON.stringify({ event: "ready", ...address, protocolVersion: 1 })}\n`)
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ event: "startup_failed", message: error instanceof Error ? error.message : "Unknown startup error" })}\n`)
    process.exitCode = 1
    return
  }

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => server.close(() => process.exit(0)))
  }
}

void main()
