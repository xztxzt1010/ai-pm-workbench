import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { createServer } from "node:http"
import test from "node:test"

const token = "process-test-session-token-that-is-long-enough"

// Cold-start measurement 2026-09-30: 10 runs, p50 ≈ 546 ms, max 8453 ms (first
// process after dependency install). 5 s was flaky under that tail; 20 s keeps a
// bounded budget while covering the measured cold-start distribution.
const READY_TIMEOUT_MS = 20_000

function sanitizeStderr(raw) {
  return raw
    .split(token).join("[redacted-session-token]")
    .replace(/(api[_-]?key|password|secret|authorization|bearer)\s*[:=]\s*['"]?[^'"\s,;]+/gi, "$1=[redacted]")
}

function spawnSidecar(extraEnv = {}) {
  return spawn(process.execPath, ["src/index.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, APM_SIDECAR_TOKEN: token, APM_SIDECAR_PORT: "0", ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  })
}

async function waitForReady(child, { timeoutMs = READY_TIMEOUT_MS } = {}) {
  let stderr = ""
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8") })
  const lines = createInterface({ input: child.stdout })
  const startedAt = Date.now()

  const ready = await new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(value)
    }
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
      finish(reject, new Error(
        `Sidecar did not become ready within ${timeoutMs}ms. ` +
        `child.exitCode=${child.exitCode} child.signalCode=${child.signalCode} child.killed=${child.killed}. ` +
        `stderr(sanitized)=${JSON.stringify(sanitizeStderr(stderr))}`
      ))
    }, timeoutMs)
    lines.once("line", (line) => {
      try {
        const event = JSON.parse(line)
        finish(resolve, {
          line,
          event,
          host: event.host,
          port: event.port,
          readyMs: Date.now() - startedAt,
          stderr: () => stderr,
        })
      } catch (error) {
        finish(reject, error)
      }
    })
    child.once("exit", (code, signal) => {
      finish(reject, new Error(
        `Sidecar exited before ready (code=${code} signal=${signal}). ` +
        `stderr(sanitized)=${JSON.stringify(sanitizeStderr(stderr))}`
      ))
    })
  })
  return ready
}

async function ensureNoResidual(child) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM")
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2_000)
      child.once("exit", () => { clearTimeout(timer); resolve() })
    })
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL")
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 1_000)
        child.once("exit", () => { clearTimeout(timer); resolve() })
      })
    }
  }
  return { exitCode: child.exitCode, signalCode: child.signalCode }
}

test("entry process publishes a token-free ready event and serves authenticated health", async (context) => {
  const child = spawnSidecar()
  context.after(async () => {
    const residual = await ensureNoResidual(child)
    assert.notEqual(residual.exitCode === null && residual.signalCode === null, true, "sidecar child must not linger after test")
  })

  const ready = await waitForReady(child)

  assert.equal(ready.event.event, "ready")
  assert.equal(ready.event.host, "127.0.0.1")
  assert.equal(ready.line.includes(token), false)

  const response = await fetch(`http://${ready.event.host}:${ready.event.port}/health`, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(response.status, 200)
  const unauthorizedShutdown = await fetch(`http://${ready.event.host}:${ready.event.port}/shutdown`, { method: "POST", headers: { authorization: "Bearer wrong-session-token-that-is-long-enough" } })
  assert.equal(unauthorizedShutdown.status, 401)
  const stillHealthy = await fetch(`http://${ready.event.host}:${ready.event.port}/health`, { headers: { authorization: `Bearer ${token}` } })
  assert.equal(stillHealthy.status, 200)
  const exit = new Promise((resolve) => child.once("exit", resolve))
  const shutdown = await fetch(`http://${ready.event.host}:${ready.event.port}/shutdown`, { method: "POST", headers: { authorization: `Bearer ${token}` } })
  assert.equal(shutdown.status, 202)
  assert.equal(await exit, 0)
})

test("entry process reaches a loopback OpenAI-compatible provider without leaking credentials", async (context) => {
  const providerToken = "provider-process-secret"
  const provider = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/v1/models") {
      assert.equal(request.headers.authorization, `Bearer ${providerToken}`)
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ data: [{ id: "local-test-model" }], internal: "provider-private" }))
      return
    }
    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      assert.equal(request.headers.authorization, `Bearer ${providerToken}`)
      const chunks = []
      request.on("data", (chunk) => chunks.push(chunk))
      request.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
        assert.equal(body.model, "local-test-model")
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "cross-process-ok" }) } }], usage: { prompt_tokens: 5, completion_tokens: 2 }, internal: "provider-private" }))
      })
      return
    }
    if (request.method === "POST" && request.url === "/search") {
      assert.equal(request.headers.authorization, undefined)
      const chunks = []
      request.on("data", (chunk) => chunks.push(chunk))
      request.on("end", () => {
        assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString("utf8")), { query: "product research" })
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ results: [{ title: "Cross-process source", url: "https://example.test/report#detail", snippet: "Verified summary" }], internal: "search-private" }))
      })
      return
    }
    response.writeHead(404).end()
  })
  await new Promise((resolve, reject) => { provider.once("error", reject); provider.listen(0, "127.0.0.1", resolve) })
  context.after(() => provider.close())
  const providerAddress = provider.address()
  assert.ok(providerAddress && typeof providerAddress !== "string")
  const endpoint = `http://127.0.0.1:${providerAddress.port}`

  const child = spawnSidecar()
  context.after(async () => {
    const residual = await ensureNoResidual(child)
    assert.notEqual(residual.exitCode === null && residual.signalCode === null, true, "sidecar child must not linger after test")
  })
  const ready = await waitForReady(child)
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" }
  const probe = await fetch(`http://${ready.host}:${ready.port}/v1/provider/test`, {
    method: "POST", headers, body: JSON.stringify({ kind: "openai_compatible", endpoint, model: "local-test-model", apiKey: providerToken }),
  })
  assert.equal(probe.status, 200)
  const probePayload = await probe.json()
  assert.equal(probePayload.state, "available")
  assert.doesNotMatch(JSON.stringify(probePayload), /provider-process-secret|provider-private/)

  const generation = await fetch(`http://${ready.host}:${ready.port}/v1/generate`, {
    method: "POST", headers, body: JSON.stringify({ kind: "openai_compatible", endpoint, model: "local-test-model", apiKey: providerToken, system: "Return JSON", prompt: "synthetic", responseSchema: { type: "object", required: ["summary"], properties: { summary: { type: "string" } } }, maxOutputTokens: 128 }),
  })
  assert.equal(generation.status, 200)
  const generationPayload = await generation.json()
  assert.equal(generationPayload.state, "succeeded")
  assert.equal(generationPayload.output.summary, "cross-process-ok")
  assert.doesNotMatch(JSON.stringify(generationPayload), /provider-process-secret|provider-private/)
  const researchSearch = await fetch(`http://${ready.host}:${ready.port}/v1/research/search`, {
    method: "POST", headers, body: JSON.stringify({ provider: "generic_json", query: "product research", endpoint: `${endpoint}/search`, timeoutMs: 8_000 }),
  })
  assert.equal(researchSearch.status, 200)
  const researchPayload = await researchSearch.json()
  assert.deepEqual(researchPayload.results, [{ title: "Cross-process source", url: "https://example.test/report", snippet: "Verified summary" }])
  assert.doesNotMatch(JSON.stringify(researchPayload), /search-private/)
  const exit = new Promise((resolve) => child.once("exit", resolve))
  const shutdown = await fetch(`http://${ready.host}:${ready.port}/shutdown`, { method: "POST", headers })
  assert.equal(shutdown.status, 202)
  assert.equal(await exit, 0)
  assert.doesNotMatch(ready.stderr(), /provider-process-secret|provider-private|search-private/)
})
