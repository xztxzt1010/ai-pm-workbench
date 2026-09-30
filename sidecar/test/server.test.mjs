import assert from "node:assert/strict"
import { once } from "node:events"
import test from "node:test"

import { createSidecarServer, listenOnLoopback } from "../src/server.mjs"

const token = "test-session-token-that-is-long-enough"

async function withServer(run, options = {}) {
  const server = createSidecarServer({ token, ...options })
  const address = await listenOnLoopback(server)
  try { await run(address) }
  finally {
    server.close()
    if (server.listening) await once(server, "close")
  }
}

test("binds only to IPv4 loopback and requires the session token", async () => {
  await withServer(async ({ host, port }) => {
    assert.equal(host, "127.0.0.1")
    const unauthorized = await fetch(`http://${host}:${port}/health`)
    assert.equal(unauthorized.status, 401)
    assert.deepEqual(await unauthorized.json(), { error: "unauthorized" })

    const authorized = await fetch(`http://${host}:${port}/health`, { headers: { authorization: `Bearer ${token}` } })
    assert.equal(authorized.status, 200)
    assert.deepEqual(await authorized.json(), { status: "ok", runtime: "apm-sidecar", protocolVersion: 1 })
    assert.equal(authorized.headers.get("cache-control"), "no-store")
  })
})

test("rejects short tokens, invalid ports, and unknown routes", async () => {
  assert.throws(() => createSidecarServer({ token: "short" }), /32-512/)
  const invalidPortServer = createSidecarServer({ token })
  await assert.rejects(() => listenOnLoopback(invalidPortServer, 70000), /0 and 65535/)

  await withServer(async ({ host, port }) => {
    const response = await fetch(`http://${host}:${port}/unknown`, { headers: { authorization: `Bearer ${token}` } })
    assert.equal(response.status, 404)
  })
})

test("provider test endpoint never returns provider response bodies", async () => {
  const providerFetch = async (url, options) => {
    assert.match(url, /\/v1\/models$/)
    assert.equal(options.headers.authorization, "Bearer transient-secret")
    return new Response(JSON.stringify({ data: [{ id: "secret-model" }] }), { status: 200 })
  }
  await withServer(async ({ host, port }) => {
      const response = await fetch(`http://${host}:${port}/v1/provider/test`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ kind: "openai", endpoint: "https://api.example.test/v1", model: "test", apiKey: "transient-secret" }),
      })
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { state: "available", message: "Provider 连接成功" })
    }, { fetchImpl: providerFetch })
})

test("research search proxies a bounded contract without exposing upstream fields", async () => {
  const searchFetch = async (url, options) => {
    assert.equal(url, "https://search.example.test/api")
    assert.equal(options.method, "POST")
    assert.deepEqual(JSON.parse(options.body), { query: "产品研究" })
    return new Response(JSON.stringify({
      results: [{ title: " 产品研究 ", url: "https://example.com/report#section", snippet: " 摘要 " }],
      upstreamDiagnostic: "must-not-leak",
    }), { status: 200 })
  }
  await withServer(async ({ host, port }) => {
    const response = await fetch(`http://${host}:${port}/v1/research/search`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ provider: "generic_json", query: "产品研究", endpoint: "https://search.example.test/api", timeoutMs: 8_000 }),
    })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.deepEqual(payload, {
      state: "succeeded",
      message: "搜索完成，共 1 条结果",
      results: [{ title: "产品研究", url: "https://example.com/report", snippet: "摘要" }],
    })
    assert.doesNotMatch(JSON.stringify(payload), /upstreamDiagnostic|must-not-leak/)
  }, { fetchImpl: searchFetch })
})

test("research search rejects unsafe endpoints and malformed results before returning data", async () => {
  let fetchCount = 0
  const searchFetch = async () => {
    fetchCount += 1
    return new Response(JSON.stringify({ results: [{ title: "", url: "file:///secret", snippet: "x" }] }), { status: 200 })
  }
  await withServer(async ({ host, port }) => {
    const call = (endpoint) => fetch(`http://${host}:${port}/v1/research/search`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ provider: "generic_json", query: "x", endpoint, timeoutMs: 8_000 }),
    })
    const unsafe = await call("https://search.example.test/api?api_key=hidden")
    assert.deepEqual(await unsafe.json(), { state: "invalid", message: "搜索请求或端点无效", results: [] })
    assert.equal(fetchCount, 0)

    const malformed = await call("https://search.example.test/api")
    assert.deepEqual(await malformed.json(), { state: "failed", message: "搜索适配器结果项无效", results: [] })
    assert.equal(fetchCount, 1)
  }, { fetchImpl: searchFetch })
})

test("research search bounds request settings and upstream response size", async () => {
  const oversizedFetch = async () => new Response(JSON.stringify({ results: [], padding: "x".repeat(257 * 1024) }), { status: 200 })
  await withServer(async ({ host, port }) => {
    const call = (body) => fetch(`http://${host}:${port}/v1/research/search`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    const invalidTimeout = await call({ provider: "generic_json", query: "x", endpoint: "https://search.example.test/api", timeoutMs: 999 })
    assert.deepEqual(await invalidTimeout.json(), { state: "invalid", message: "搜索请求或端点无效", results: [] })

    const oversized = await call({ provider: "generic_json", query: "x", endpoint: "https://search.example.test/api", timeoutMs: 8_000 })
    assert.deepEqual(await oversized.json(), { state: "failed", message: "搜索适配器响应超过 256 KiB 限制", results: [] })
  }, { fetchImpl: oversizedFetch })
})

test("built-in Chinese Wikipedia search uses the official GET contract and a bounded cache", async () => {
  let fetchCount = 0
  const wikipediaFetch = async (url, options) => {
    fetchCount += 1
    const parsed = new URL(url)
    assert.equal(parsed.origin + parsed.pathname, "https://zh.wikipedia.org/w/api.php")
    assert.equal(parsed.searchParams.get("action"), "query")
    assert.equal(parsed.searchParams.get("list"), "search")
    assert.equal(parsed.searchParams.get("srsearch"), "产品管理")
    assert.equal(parsed.searchParams.get("srlimit"), "10")
    assert.equal(options.method, "GET")
    assert.match(options.headers["user-agent"], /AssistantProductManager\/0\.1/)
    return new Response(JSON.stringify({ query: { search: [{ title: "产品管理", snippet: "<span class=\"searchmatch\">产品</span>&nbsp;规划与管理" }] } }), { status: 200 })
  }
  await withServer(async ({ host, port }) => {
    const call = () => fetch(`http://${host}:${port}/v1/research/search`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ provider: "wikipedia_zh", query: "产品管理", endpoint: "https://zh.wikipedia.org/w/api.php", timeoutMs: 8_000 }),
    })
    const first = await (await call()).json()
    assert.deepEqual(first.results, [{ title: "产品管理", url: "https://zh.wikipedia.org/wiki/%E4%BA%A7%E5%93%81%E7%AE%A1%E7%90%86", snippet: "产品 规划与管理" }])
    const cached = await (await call()).json()
    assert.match(cached.message, /缓存/)
    assert.deepEqual(cached.results, first.results)
    assert.equal(fetchCount, 1)
  }, { fetchImpl: wikipediaFetch })
})

test("built-in Wikipedia cache evicts the oldest query after fifty entries", async () => {
  let fetchCount = 0
  const wikipediaFetch = async () => {
    fetchCount += 1
    return new Response(JSON.stringify({ query: { search: [{ title: "结果", snippet: "摘要" }] } }), { status: 200 })
  }
  await withServer(async ({ host, port }) => {
    const call = (query) => fetch(`http://${host}:${port}/v1/research/search`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ provider: "wikipedia_zh", query, endpoint: "https://zh.wikipedia.org/w/api.php", timeoutMs: 8_000 }),
    })
    for (let index = 0; index < 51; index += 1) assert.equal((await (await call(`query-${index}`)).json()).state, "succeeded")
    assert.equal(fetchCount, 51)
    assert.equal((await (await call("query-0")).json()).state, "succeeded")
    assert.equal(fetchCount, 52)
  }, { fetchImpl: wikipediaFetch })
})

test("provider contract covers Anthropic Messages and keeps credentials out of output", async () => {
  const providerFetch = async (url, options) => {
    assert.match(url, /\/v1\/messages$/)
    assert.equal(options.headers["x-api-key"], "anthropic-transient-secret")
    assert.equal(options.headers["anthropic-version"], "2023-06-01")
    const body = JSON.parse(options.body)
    assert.equal(body.max_tokens, 128)
    assert.equal(body.messages[0].role, "user")
    return new Response(JSON.stringify({
      content: [{ type: "text", text: JSON.stringify({ answer: "ok" }) }],
      usage: { input_tokens: 8, output_tokens: 3 },
      provider_internal: "must-not-leak",
    }), { status: 200 })
  }
  await withServer(async ({ host, port }) => {
    const response = await fetch(`http://${host}:${port}/v1/generate`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        kind: "anthropic", endpoint: "https://api.anthropic.test/v1", model: "claude-test", apiKey: "anthropic-transient-secret",
        system: "Return JSON.", prompt: "Synthetic test", responseSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false }, maxOutputTokens: 128,
      }),
    })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.deepEqual(payload, { state: "succeeded", message: "结构化生成完成", output: { answer: "ok" }, usage: { inputTokens: 8, outputTokens: 3 } })
    assert.doesNotMatch(JSON.stringify(payload), /anthropic-transient-secret|provider_internal/)
  }, { fetchImpl: providerFetch })
})

test("provider contract supports CC Switch loopback and OpenAI-compatible model paths", async () => {
  const seen = []
  const providerFetch = async (url, options) => {
    seen.push({ url, authorization: options.headers.authorization })
    return new Response(JSON.stringify({ data: [{ id: "hidden-model" }] }), { status: 200 })
  }
  await withServer(async ({ host, port }) => {
    for (const input of [
      { kind: "cc_switch", endpoint: "http://127.0.0.1:15721", model: "current", apiKey: "" },
      { kind: "openai_compatible", endpoint: "https://provider.example.test/custom", model: "local", apiKey: "compat-secret" },
    ]) {
      const response = await fetch(`http://${host}:${port}/v1/provider/test`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(input),
      })
      assert.deepEqual(await response.json(), { state: "available", message: "Provider 连接成功" })
    }
  }, { fetchImpl: providerFetch })
  assert.deepEqual(seen, [
    { url: "http://127.0.0.1:15721/v1/models", authorization: undefined },
    { url: "https://provider.example.test/custom/v1/models", authorization: "Bearer compat-secret" },
  ])
})

test("provider contract normalizes upstream failure without returning body text", async () => {
  const providerFetch = async () => new Response(JSON.stringify({ error: { message: "secret upstream diagnostic" } }), { status: 429 })
  await withServer(async ({ host, port }) => {
    const response = await fetch(`http://${host}:${port}/v1/provider/test`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ kind: "openai", endpoint: "https://api.example.test/v1", model: "test", apiKey: "secret" }),
    })
    assert.deepEqual(await response.json(), { state: "unavailable", message: "Provider 返回 HTTP 429" })
  }, { fetchImpl: providerFetch })
})

test("provider test rejects unsafe endpoints and oversized requests before network access", async () => {
  const providerFetch = async () => { throw new Error("network must not be called") }
  await withServer(async ({ host, port }) => {
    const unsafe = await fetch(`http://${host}:${port}/v1/provider/test`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ kind: "openai_compatible", endpoint: "http://192.168.1.5:8000", model: "test", apiKey: "" }),
    })
    assert.equal(unsafe.status, 200)
    assert.deepEqual(await unsafe.json(), { state: "invalid", message: "连接配置无效" })

    const oversized = await fetch(`http://${host}:${port}/v1/provider/test`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "x".repeat(17 * 1024),
    })
    assert.equal(oversized.status, 413)
    assert.deepEqual(await oversized.json(), { state: "invalid", message: "请求格式无效" })
  }, { fetchImpl: providerFetch })
})

test("structured generation returns parsed JSON and token usage without raw provider data", async () => {
  const providerFetch = async (url, options) => {
    assert.match(url, /\/v1\/chat\/completions$/)
    assert.equal(options.method, "POST")
    assert.equal(options.headers.authorization, "Bearer transient-secret")
    const body = JSON.parse(options.body)
    assert.equal(body.max_tokens, 512)
    assert.equal(body.response_format.type, "json_object")
    return new Response(JSON.stringify({
      id: "provider-request-id-must-not-leak",
      choices: [{ message: { content: JSON.stringify({ summary: "ok" }) } }],
      usage: { prompt_tokens: 21, completion_tokens: 7 },
      internal: "provider-body-must-not-leak",
    }), { status: 200 })
  }
  await withServer(async ({ host, port }) => {
    const response = await fetch(`http://${host}:${port}/v1/generate`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        kind: "openai",
        endpoint: "https://api.example.test/v1",
        model: "test-model",
        apiKey: "transient-secret",
        system: "Return a summary.",
        prompt: "Meeting text",
        responseSchema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
        maxOutputTokens: 512,
      }),
    })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.deepEqual(payload, {
      state: "succeeded",
      message: "结构化生成完成",
      output: { summary: "ok" },
      usage: { inputTokens: 21, outputTokens: 7 },
    })
    assert.doesNotMatch(JSON.stringify(payload), /transient-secret|provider-request-id|provider-body/)
  }, { fetchImpl: providerFetch })
})

test("structured generation rejects excessive output limits before provider access", async () => {
  const providerFetch = async () => { throw new Error("network must not be called") }
  await withServer(async ({ host, port }) => {
    const response = await fetch(`http://${host}:${port}/v1/generate`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ kind: "openai", endpoint: "https://api.example.test/v1", model: "test", apiKey: "secret", system: "", prompt: "x", responseSchema: {}, maxOutputTokens: 9_000 }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { state: "invalid", message: "生成限制或输出 Schema 无效" })
  }, { fetchImpl: providerFetch })
})

test("structured generation rejects JSON that violates the requested schema", async () => {
  const providerFetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ wrong: true }) } }],
    usage: {},
  }), { status: 200 })
  await withServer(async ({ host, port }) => {
    const response = await fetch(`http://${host}:${port}/v1/generate`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        kind: "openai", endpoint: "https://api.example.test/v1", model: "test", apiKey: "secret",
        system: "", prompt: "x", maxOutputTokens: 100,
        responseSchema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false },
      }),
    })
    assert.deepEqual(await response.json(), { state: "failed", message: "Provider 输出不符合约定 Schema" })
  }, { fetchImpl: providerFetch })
})

function validGenerateInput(overrides = {}) {
  return {
    kind: "openai",
    endpoint: "https://api.example.test/v1",
    model: "test-model",
    apiKey: "test-key",
    system: "Return JSON.",
    prompt: "Make a summary.",
    responseSchema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
    maxOutputTokens: 512,
    ...overrides,
  }
}

// A. Provider 健康测试异常
test("provider health reports ordinary upstream errors as unavailable without leaking the message", async () => {
  const upstream = async () => {
    throw new Error("upstream exploded SIDECAR-SECRET-HEALTH-ERROR")
  }
  await withServer(async ({ host, port }) => {
    const response = await fetch(`http://${host}:${port}/v1/provider/test`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ kind: "openai", endpoint: "https://api.example.test/v1", model: "test", apiKey: "secret" }),
    })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.deepEqual(payload, { state: "unavailable", message: "Provider 暂时不可访问" })
    assert.doesNotMatch(JSON.stringify(payload), /SIDECAR-SECRET-HEALTH-ERROR/)
  }, { fetchImpl: upstream })
})

test("provider health reports AbortError as a timeout without waiting five seconds", async () => {
  const upstream = async () => {
    const error = new Error("aborted")
    error.name = "AbortError"
    throw error
  }
  await withServer(async ({ host, port }) => {
    const response = await fetch(`http://${host}:${port}/v1/provider/test`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ kind: "openai", endpoint: "https://api.example.test/v1", model: "test", apiKey: "secret" }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { state: "unavailable", message: "Provider 请求超时" })
  }, { fetchImpl: upstream })
})

test("provider health endpoint survives both upstream failure modes", async () => {
  let calls = 0
  const upstream = async () => {
    calls += 1
    if (calls === 1) throw new Error("SIDECAR-SECRET-HEALTH-ERROR")
    const error = new Error("aborted")
    error.name = "AbortError"
    throw error
  }
  await withServer(async ({ host, port }) => {
    const call = () => fetch(`http://${host}:${port}/v1/provider/test`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ kind: "openai", endpoint: "https://api.example.test/v1", model: "test", apiKey: "secret" }),
    })
    assert.equal((await (await call()).json()).state, "unavailable")
    assert.equal((await (await call()).json()).state, "unavailable")
    const health = await fetch(`http://${host}:${port}/health`, { headers: { authorization: `Bearer ${token}` } })
    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), { status: "ok", runtime: "apm-sidecar", protocolVersion: 1 })
  }, { fetchImpl: upstream })
})

// B. 结构化生成异常
test("structured generation never reads a non-ok upstream body into the response", async () => {
  const upstream = async () => new Response(JSON.stringify({ error: { message: "SIDECAR-SECRET-HTTP-503" } }), { status: 503 })
  await withServer(async ({ host, port }) => {
    const response = await fetch(`http://${host}:${port}/v1/generate`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(validGenerateInput()),
    })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.deepEqual(payload, { state: "failed", message: "Provider 返回 HTTP 503" })
    assert.doesNotMatch(JSON.stringify(payload), /SIDECAR-SECRET-HTTP-503/)
  }, { fetchImpl: upstream })
})

test("structured generation masks thrown upstream errors instead of leaking them", async () => {
  const upstream = async () => {
    throw new Error("upstream blew up SIDECAR-SECRET-GENERATE-ERROR")
  }
  await withServer(async ({ host, port }) => {
    const response = await fetch(`http://${host}:${port}/v1/generate`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(validGenerateInput()),
    })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.deepEqual(payload, { state: "failed", message: "Provider 生成请求失败" })
    assert.doesNotMatch(JSON.stringify(payload), /SIDECAR-SECRET-GENERATE-ERROR/)
  }, { fetchImpl: upstream })
})

test("structured generation reports AbortError as a timeout without waiting sixty seconds", async () => {
  const upstream = async () => {
    const error = new Error("aborted")
    error.name = "AbortError"
    throw error
  }
  await withServer(async ({ host, port }) => {
    const response = await fetch(`http://${host}:${port}/v1/generate`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(validGenerateInput()),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { state: "failed", message: "Provider 生成请求超时" })
  }, { fetchImpl: upstream })
})

test("structured generation normalizes invalid upstream JSON and stays available", async () => {
  const upstream = async () => new Response("not json at all SIDECAR-SECRET-BAD-JSON {{{{", { status: 200 })
  await withServer(async ({ host, port }) => {
    const response = await fetch(`http://${host}:${port}/v1/generate`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(validGenerateInput()),
    })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.deepEqual(payload, { state: "failed", message: "Provider 生成请求失败" })
    assert.doesNotMatch(JSON.stringify(payload), /SIDECAR-SECRET-BAD-JSON/)
    const health = await fetch(`http://${host}:${port}/health`, { headers: { authorization: `Bearer ${token}` } })
    assert.equal(health.status, 200)
  }, { fetchImpl: upstream })
})

test("structured generation caps upstream responses at 2 MiB without echoing the body", async () => {
  const hugeBody = `{"choices":[{"message":{"content":"SIDECAR-SECRET-HUGE-` + "x".repeat(2 * 1024 * 1024 + 4096) + `"}}]}`
  const upstream = async () => new Response(hugeBody, { status: 200 })
  await withServer(async ({ host, port }) => {
    const response = await fetch(`http://${host}:${port}/v1/generate`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(validGenerateInput()),
    })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.deepEqual(payload, { state: "failed", message: "Provider 响应超过 2 MiB 限制" })
    assert.doesNotMatch(JSON.stringify(payload), /SIDECAR-SECRET-HUGE/)
    assert.ok(JSON.stringify(payload).length < 200)
  }, { fetchImpl: upstream })
})

// C. 生成请求预算边界
test("generation request bodies over 512 KiB are rejected before any upstream access", async () => {
  let calls = 0
  const upstream = async () => {
    calls += 1
    throw new Error("must not be reached")
  }
  await withServer(async ({ host, port }) => {
    const response = await fetch(`http://${host}:${port}/v1/generate`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "x".repeat(513 * 1024),
    })
    assert.equal(response.status, 413)
    assert.deepEqual(await response.json(), { state: "invalid", message: "请求格式无效" })
    assert.equal(calls, 0)
  }, { fetchImpl: upstream })
})

test("every over-limit generation field fails before upstream access", async () => {
  let calls = 0
  const upstream = async () => {
    calls += 1
    throw new Error("must not be reached")
  }
  const cases = [
    ["model", "m".repeat(201), "生成配置无效"],
    ["apiKey", "k".repeat(513), "生成输入无效"],
    ["system", "s".repeat(20_001), "生成输入无效"],
    ["prompt", "p".repeat(400_001), "生成输入无效"],
    ["responseSchema", { type: "object", properties: { big: { type: "string", description: "d".repeat(70 * 1024) } } }, "输出 Schema 过大"],
    ["maxOutputTokens", 0, "生成限制或输出 Schema 无效"],
    ["maxOutputTokens", 512.5, "生成限制或输出 Schema 无效"],
    ["maxOutputTokens", 8_193, "生成限制或输出 Schema 无效"],
  ]
  await withServer(async ({ host, port }) => {
    for (const [field, value, message] of cases) {
      const response = await fetch(`http://${host}:${port}/v1/generate`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(validGenerateInput({ [field]: value })),
      })
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { state: "invalid", message }, `field: ${field}`)
    }
    assert.equal(calls, 0)
  }, { fetchImpl: upstream })
})

test("the legal maximum output token boundary is accepted", async () => {
  const upstream = async (url, options) => {
    assert.match(url, /\/v1\/chat\/completions$/)
    assert.equal(JSON.parse(options.body).max_tokens, 8_192)
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ summary: "ok" }) } }],
      usage: {},
    }), { status: 200 })
  }
  await withServer(async ({ host, port }) => {
    const response = await fetch(`http://${host}:${port}/v1/generate`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(validGenerateInput({ maxOutputTokens: 8_192 })),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      state: "succeeded",
      message: "结构化生成完成",
      output: { summary: "ok" },
      usage: { inputTokens: null, outputTokens: null },
    })
  }, { fetchImpl: upstream })
})

// D. 搜索异常与预算
test("search masks thrown upstream errors and timeouts with empty results", async () => {
  const searchCall = (host, port) => fetch(`http://${host}:${port}/v1/research/search`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ provider: "generic_json", query: "产品研究", endpoint: "https://search.example.test/api", timeoutMs: 8_000 }),
  })
  const throws = async () => {
    throw new Error("SIDECAR-SECRET-SEARCH-ERROR")
  }
  await withServer(async ({ host, port }) => {
    const response = await (await searchCall(host, port)).json()
    assert.deepEqual(response, { state: "failed", message: "搜索适配器暂时不可访问", results: [] })
    assert.doesNotMatch(JSON.stringify(response), /SIDECAR-SECRET-SEARCH-ERROR/)
  }, { fetchImpl: throws })

  const aborts = async () => {
    const error = new Error("aborted")
    error.name = "AbortError"
    throw error
  }
  await withServer(async ({ host, port }) => {
    assert.deepEqual(await (await searchCall(host, port)).json(), { state: "failed", message: "搜索请求超时", results: [] })
  }, { fetchImpl: aborts })
})

test("search rejects over-long queries and oversized request bodies before upstream access", async () => {
  let calls = 0
  const upstream = async () => {
    calls += 1
    throw new Error("must not be reached")
  }
  await withServer(async ({ host, port }) => {
    const longQuery = await fetch(`http://${host}:${port}/v1/research/search`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ provider: "generic_json", query: "q".repeat(201), endpoint: "https://search.example.test/api", timeoutMs: 8_000 }),
    })
    assert.deepEqual(await longQuery.json(), { state: "invalid", message: "搜索请求或端点无效", results: [] })

    const oversized = await fetch(`http://${host}:${port}/v1/research/search`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "x".repeat(17 * 1024),
    })
    assert.equal(oversized.status, 413)
    assert.deepEqual(await oversized.json(), { state: "invalid", message: "请求格式无效", results: [] })
    assert.equal(calls, 0)
  }, { fetchImpl: upstream })
})

test("generic search caps valid upstream results at ten", async () => {
  const results = Array.from({ length: 12 }, (_, index) => ({
    title: `标题 ${index + 1}`,
    url: `https://example.com/r/${index + 1}`,
    snippet: `摘要 ${index + 1}`,
  }))
  const upstream = async () => new Response(JSON.stringify({ results }), { status: 200 })
  await withServer(async ({ host, port }) => {
    const response = await (await fetch(`http://${host}:${port}/v1/research/search`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ provider: "generic_json", query: "产品研究", endpoint: "https://search.example.test/api", timeoutMs: 8_000 }),
    })).json()
    assert.equal(response.state, "succeeded")
    assert.equal(response.message, "搜索完成，共 10 条结果")
    assert.equal(response.results.length, 10)
    assert.deepEqual(response.results[0], { title: "标题 1", url: "https://example.com/r/1", snippet: "摘要 1" })
    assert.deepEqual(response.results[9], { title: "标题 10", url: "https://example.com/r/10", snippet: "摘要 10" })
    assert.doesNotMatch(JSON.stringify(response), /标题 11|标题 12/)
  }, { fetchImpl: upstream })
})

test("a failed search result is never cached and the query hits upstream again", async () => {
  let calls = 0
  const upstream = async () => {
    calls += 1
    return new Response(JSON.stringify({ query: { search: [{ title: "", snippet: "" }] } }), { status: 200 })
  }
  await withServer(async ({ host, port }) => {
    const call = () => fetch(`http://${host}:${port}/v1/research/search`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ provider: "wikipedia_zh", query: "产品管理", endpoint: "https://zh.wikipedia.org/w/api.php", timeoutMs: 8_000 }),
    })
    assert.deepEqual(await (await call()).json(), { state: "failed", message: "搜索适配器结果结构无效", results: [] })
    assert.deepEqual(await (await call()).json(), { state: "failed", message: "搜索适配器结果结构无效", results: [] })
    assert.equal(calls, 2)
  }, { fetchImpl: upstream })
})
