import { timingSafeEqual } from "node:crypto"
import { createServer } from "node:http"
import Ajv2020 from "ajv/dist/2020.js"

import { runtimeMetadata } from "./runtime.mjs"

const LOOPBACK_HOST = "127.0.0.1"
const MAX_REQUEST_BYTES = 16 * 1024
const MAX_GENERATION_REQUEST_BYTES = 512 * 1024
const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_SEARCH_RESPONSE_BYTES = 256 * 1024
const RESEARCH_SEARCH_CACHE_TTL_MS = 5 * 60 * 1_000
const RESEARCH_SEARCH_CACHE_MAX_ENTRIES = 50
const WIKIPEDIA_ZH_ENDPOINT = "https://zh.wikipedia.org/w/api.php"
const WIKIMEDIA_USER_AGENT = "AssistantProductManager/0.1 (local desktop research preview)"
const PROVIDER_KINDS = new Set(["cc_switch", "openai", "anthropic", "openai_compatible"])
const schemaValidator = new Ajv2020({ strict: false, allErrors: false, $data: false })

function validToken(value) {
  return typeof value === "string" && value.length >= 32 && value.length <= 512
}

function tokenMatches(header, expectedToken) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false
  const provided = Buffer.from(header.slice(7), "utf8")
  const expected = Buffer.from(expectedToken, "utf8")
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body)
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  })
  response.end(payload)
}

function readJsonBody(request, maxBytes = MAX_REQUEST_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0
    let tooLarge = false
    const chunks = []
    request.on("data", (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        tooLarge = true
        return
      }
      chunks.push(chunk)
    })
    request.on("end", () => {
      if (tooLarge) {
        reject(new Error("request_too_large"))
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      } catch {
        reject(new Error("invalid_json"))
      }
    })
    request.on("error", reject)
  })
}

function providerModelsUrl(endpoint) {
  const normalized = endpoint.replace(/\/+$/, "")
  return normalized.endsWith("/v1") ? `${normalized}/models` : `${normalized}/v1/models`
}

function providerGenerateUrl(kind, endpoint) {
  const normalized = endpoint.replace(/\/+$/, "")
  const path = kind === "anthropic" ? "messages" : "chat/completions"
  return normalized.endsWith("/v1") ? `${normalized}/${path}` : `${normalized}/v1/${path}`
}

async function readLimitedResponse(response, maxBytes = MAX_PROVIDER_RESPONSE_BYTES, tooLargeCode = "provider_response_too_large") {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new Error(tooLargeCode)
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks).toString("utf8")
}

function validResearchSearchEndpoint(value) {
  try {
    const url = new URL(value)
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost"
    if (url.username || url.password || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) return false
    for (const key of url.searchParams.keys()) {
      if (/^(?:api[_-]?key|access[_-]?token|token|secret|password)$/i.test(key)) return false
    }
    return value.length <= 2_000
  } catch {
    return false
  }
}

function normalizeSearchResult(item) {
  if (!item || typeof item !== "object") return null
  const title = typeof item.title === "string" ? item.title.trim() : ""
  const snippet = typeof item.snippet === "string" ? item.snippet.trim() : ""
  if (!title || title.length > 300 || !snippet || snippet.length > 2_000) return null
  try {
    const url = new URL(item.url)
    if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password || !url.hostname || url.toString().length > 2_000) return null
    url.hash = ""
    return { title, url: url.toString(), snippet }
  } catch {
    return null
  }
}

function plainTextFromMediaWikiSnippet(value) {
  if (typeof value !== "string") return ""
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&(#(?:x[0-9a-f]+|[0-9]+)|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
      if (entity[0] !== "#") return named[entity.toLowerCase()] ?? ""
      const hexadecimal = entity[1]?.toLowerCase() === "x"
      const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10)
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : ""
    })
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeWikipediaSearchResults(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.query?.search)) return null
  const results = payload.query.search.slice(0, 10).map((item) => {
    const title = typeof item?.title === "string" ? item.title.trim() : ""
    const snippet = plainTextFromMediaWikiSnippet(item?.snippet)
    if (!title || title.length > 300 || !snippet || snippet.length > 2_000) return null
    return {
      title,
      url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`,
      snippet,
    }
  })
  return results.some((item) => item === null) ? null : results
}

function cachedResearchSearch(cache, key) {
  const cached = cache.get(key)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    cache.delete(key)
    return null
  }
  return cached.results
}

function cacheResearchSearch(cache, key, results) {
  if (cache.size >= RESEARCH_SEARCH_CACHE_MAX_ENTRIES && !cache.has(key)) {
    cache.delete(cache.keys().next().value)
  }
  cache.set(key, { expiresAt: Date.now() + RESEARCH_SEARCH_CACHE_TTL_MS, results })
}

async function searchResearchSources(input, fetchImpl, cache) {
  if (!input || typeof input !== "object") return { state: "invalid", message: "搜索请求无效", results: [] }
  const query = typeof input.query === "string" ? input.query.trim() : ""
  const timeoutMs = input.timeoutMs ?? 8_000
  const provider = input.provider
  if (!query || query.length > 200 || !["wikipedia_zh", "generic_json"].includes(provider) || typeof input.endpoint !== "string" || !validResearchSearchEndpoint(input.endpoint) || (provider === "wikipedia_zh" && input.endpoint !== WIKIPEDIA_ZH_ENDPOINT) || !Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    return { state: "invalid", message: "搜索请求或端点无效", results: [] }
  }
  const cacheKey = provider === "wikipedia_zh" ? `${provider}:${query.toLocaleLowerCase("zh-CN")}` : null
  const cached = cacheKey ? cachedResearchSearch(cache, cacheKey) : null
  if (cached) return { state: "succeeded", message: `搜索完成，共 ${cached.length} 条结果（缓存）`, results: cached }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const wikipediaUrl = new URL(WIKIPEDIA_ZH_ENDPOINT)
    if (provider === "wikipedia_zh") {
      for (const [key, value] of Object.entries({ action: "query", list: "search", srsearch: query, srlimit: "10", srprop: "snippet", format: "json", formatversion: "2", utf8: "1" })) wikipediaUrl.searchParams.set(key, value)
    }
    const response = await fetchImpl(provider === "wikipedia_zh" ? wikipediaUrl.toString() : input.endpoint, provider === "wikipedia_zh" ? {
      method: "GET",
      headers: { accept: "application/json", "user-agent": WIKIMEDIA_USER_AGENT, "api-user-agent": WIKIMEDIA_USER_AGENT },
      signal: controller.signal,
    } : {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    })
    if (!response.ok) return { state: "failed", message: `搜索适配器返回 HTTP ${response.status}`, results: [] }
    let payload
    try { payload = JSON.parse(await readLimitedResponse(response, MAX_SEARCH_RESPONSE_BYTES, "search_response_too_large")) }
    catch (error) {
      if (error?.message === "search_response_too_large") return { state: "failed", message: "搜索适配器响应超过 256 KiB 限制", results: [] }
      return { state: "failed", message: "搜索适配器返回的 JSON 无效", results: [] }
    }
    const results = provider === "wikipedia_zh"
      ? normalizeWikipediaSearchResults(payload)
      : payload && typeof payload === "object" && Array.isArray(payload.results)
        ? payload.results.slice(0, 10).map(normalizeSearchResult)
        : null
    if (!results) return { state: "failed", message: "搜索适配器结果结构无效", results: [] }
    if (results.some((item) => item === null)) return { state: "failed", message: "搜索适配器结果项无效", results: [] }
    if (cacheKey) cacheResearchSearch(cache, cacheKey, results)
    return { state: "succeeded", message: `搜索完成，共 ${results.length} 条结果`, results }
  } catch (error) {
    return { state: "failed", message: error?.name === "AbortError" ? "搜索请求超时" : "搜索适配器暂时不可访问", results: [] }
  } finally {
    clearTimeout(timeout)
  }
}

function validProviderEndpoint(kind, endpoint) {
  try {
    const url = new URL(endpoint)
    if (url.username || url.password || url.search || url.hash) return false
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost"
    if (kind === "cc_switch") return url.protocol === "http:" && loopback
    if (kind === "openai" || kind === "anthropic") return url.protocol === "https:"
    return kind === "openai_compatible" && (url.protocol === "https:" || (url.protocol === "http:" && loopback))
  } catch {
    return false
  }
}

async function testProviderConnection(input, fetchImpl) {
  if (!input || typeof input !== "object") return { state: "invalid", message: "连接配置无效" }
  const { kind, endpoint, model, apiKey } = input
  if (!PROVIDER_KINDS.has(kind) || typeof endpoint !== "string" || !validProviderEndpoint(kind, endpoint) || typeof model !== "string" || !model || model.length > 200) {
    return { state: "invalid", message: "连接配置无效" }
  }
  if (typeof apiKey !== "string" || apiKey.length > 512) return { state: "invalid", message: "凭据无效" }

  const headers = { accept: "application/json" }
  if (kind === "anthropic") {
    if (apiKey) headers["x-api-key"] = apiKey
    headers["anthropic-version"] = "2023-06-01"
  } else if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5_000)
  try {
    const response = await fetchImpl(providerModelsUrl(endpoint), { headers, signal: controller.signal })
    return response.ok
      ? { state: "available", message: "Provider 连接成功" }
      : { state: "unavailable", message: `Provider 返回 HTTP ${response.status}` }
  } catch (error) {
    return { state: "unavailable", message: error?.name === "AbortError" ? "Provider 请求超时" : "Provider 暂时不可访问" }
  } finally {
    clearTimeout(timeout)
  }
}

async function generateStructuredOutput(input, fetchImpl) {
  if (!input || typeof input !== "object") return { state: "invalid", message: "生成请求无效" }
  const { kind, endpoint, model, apiKey, system, prompt, responseSchema, maxOutputTokens } = input
  if (!PROVIDER_KINDS.has(kind) || !validProviderEndpoint(kind, endpoint) || typeof model !== "string" || !model || model.length > 200) {
    return { state: "invalid", message: "生成配置无效" }
  }
  if (typeof apiKey !== "string" || apiKey.length > 512 || typeof system !== "string" || system.length > 20_000 || typeof prompt !== "string" || !prompt || prompt.length > 400_000) {
    return { state: "invalid", message: "生成输入无效" }
  }
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 8_192 || !responseSchema || typeof responseSchema !== "object" || Array.isArray(responseSchema)) {
    return { state: "invalid", message: "生成限制或输出 Schema 无效" }
  }
  const schemaText = JSON.stringify(responseSchema)
  if (schemaText.length > 64 * 1024) return { state: "invalid", message: "输出 Schema 过大" }
  let validateOutput
  try { validateOutput = schemaValidator.compile(responseSchema) }
  catch { return { state: "invalid", message: "输出 Schema 无法编译" } }

  const headers = { accept: "application/json", "content-type": "application/json" }
  let body
  const schemaInstruction = `\nReturn only valid JSON matching this schema: ${schemaText}`
  if (kind === "anthropic") {
    if (apiKey) headers["x-api-key"] = apiKey
    headers["anthropic-version"] = "2023-06-01"
    body = { model, max_tokens: maxOutputTokens, system: `${system}${schemaInstruction}`, messages: [{ role: "user", content: prompt }] }
  } else {
    if (apiKey) headers.authorization = `Bearer ${apiKey}`
    body = { model, max_tokens: maxOutputTokens, response_format: { type: "json_object" }, messages: [{ role: "system", content: `${system}${schemaInstruction}` }, { role: "user", content: prompt }] }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)
  try {
    const response = await fetchImpl(providerGenerateUrl(kind, endpoint), { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal })
    if (!response.ok) return { state: "failed", message: `Provider 返回 HTTP ${response.status}` }
    const raw = JSON.parse(await readLimitedResponse(response))
    const content = kind === "anthropic"
      ? raw?.content?.find((item) => item?.type === "text")?.text
      : raw?.choices?.[0]?.message?.content
    if (typeof content !== "string") return { state: "failed", message: "Provider 未返回结构化文本" }
    let output
    try { output = JSON.parse(content) }
    catch { return { state: "failed", message: "Provider 返回的内容不是有效 JSON" } }
    if (!validateOutput(output)) return { state: "failed", message: "Provider 输出不符合约定 Schema" }
    const inputTokens = kind === "anthropic" ? raw?.usage?.input_tokens : raw?.usage?.prompt_tokens
    const outputTokens = kind === "anthropic" ? raw?.usage?.output_tokens : raw?.usage?.completion_tokens
    return {
      state: "succeeded",
      message: "结构化生成完成",
      output,
      usage: {
        inputTokens: Number.isInteger(inputTokens) ? inputTokens : null,
        outputTokens: Number.isInteger(outputTokens) ? outputTokens : null,
      },
    }
  } catch (error) {
    if (error?.name === "AbortError") return { state: "failed", message: "Provider 生成请求超时" }
    if (error?.message === "provider_response_too_large") return { state: "failed", message: "Provider 响应超过 2 MiB 限制" }
    return { state: "failed", message: "Provider 生成请求失败" }
  } finally {
    clearTimeout(timeout)
  }
}

export function createSidecarServer({ token, fetchImpl = globalThis.fetch }) {
  if (!validToken(token)) throw new Error("Sidecar session token must contain 32-512 characters")
  const researchSearchCache = new Map()

  const server = createServer((request, response) => {
    if (!tokenMatches(request.headers.authorization, token)) {
      sendJson(response, 401, { error: "unauthorized" })
      return
    }

    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, {
        status: "ok",
        runtime: runtimeMetadata.name,
        protocolVersion: runtimeMetadata.protocolVersion,
      })
      return
    }

    if (request.method === "POST" && request.url === "/v1/provider/test") {
      void readJsonBody(request)
        .then((input) => testProviderConnection(input, fetchImpl))
        .then((result) => sendJson(response, 200, result))
        .catch((error) => sendJson(response, error?.message === "request_too_large" ? 413 : 400, { state: "invalid", message: "请求格式无效" }))
      return
    }

    if (request.method === "POST" && request.url === "/v1/generate") {
      void readJsonBody(request, MAX_GENERATION_REQUEST_BYTES)
        .then((input) => generateStructuredOutput(input, fetchImpl))
        .then((result) => sendJson(response, 200, result))
        .catch((error) => sendJson(response, error?.message === "request_too_large" ? 413 : 400, { state: "invalid", message: "请求格式无效" }))
      return
    }

    if (request.method === "POST" && request.url === "/v1/research/search") {
      void readJsonBody(request)
        .then((input) => searchResearchSources(input, fetchImpl, researchSearchCache))
        .then((result) => sendJson(response, 200, result))
        .catch((error) => sendJson(response, error?.message === "request_too_large" ? 413 : 400, { state: "invalid", message: "请求格式无效", results: [] }))
      return
    }

    if (request.method === "POST" && request.url === "/shutdown") {
      sendJson(response, 202, { status: "stopping" })
      setImmediate(() => server.close())
      return
    }

    sendJson(response, 404, { error: "not_found" })
  })
  server.requestTimeout = 5_000
  server.headersTimeout = 5_000
  server.keepAliveTimeout = 1_000
  return server
}

export async function listenOnLoopback(server, port = 0) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Sidecar port must be an integer between 0 and 65535")
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, LOOPBACK_HOST, resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string" || address.address !== LOOPBACK_HOST) {
    server.close()
    throw new Error("Sidecar failed to bind the IPv4 loopback interface")
  }
  return { host: LOOPBACK_HOST, port: address.port }
}
