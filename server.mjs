import https from "node:https";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID, timingSafeEqual } from "node:crypto";

function loadEnvFile(filename) {
  const path = fileURLToPath(new URL(filename, import.meta.url));
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key in process.env) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const GATEWAY_API_KEY = (
  process.env.GATEWAY_API_KEY || "sk_9f4c2a7e8b1d4f6a92c0e3d5b7a18c6f4e2d9a0b"
).trim();
const CORS_ORIGIN = (process.env.CORS_ORIGIN || "*").trim() || "*";
const FORWARD_TOOLS = process.env.GATEWAY_FORWARD_TOOLS === "1";
const UPSTREAM_BASE = (process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1/chat/completions").replace(/\/$/, "");
const localNvidiaProfile = readLocalNvidiaProfile();
const DEFAULT_MODEL = process.env.NVIDIA_MODEL || localNvidiaProfile.model || "minimaxai/minimax-m2.7";
const CERT = process.env.TLS_CERT || new URL("./certs/localhost.crt", import.meta.url);
const KEY = process.env.TLS_KEY || new URL("./certs/localhost.key", import.meta.url);
const STATIC_DIR = new URL("./public/", import.meta.url);
const HERMES_SYNC_SCRIPT = fileURLToPath(new URL("./scripts/sync-hermes-models.mjs", import.meta.url));
const LEGACY_CONFIG_FILE = fileURLToPath(new URL("./models.json", import.meta.url));
const EXAMPLE_CONFIG_FILE = fileURLToPath(new URL("./models.example.json", import.meta.url));

const HTTP_ONLY =
  process.env.GATEWAY_HTTP_ONLY === "1" ||
  process.env.ZEABUR === "1" ||
  process.env.NODE_ENV === "production" ||
  !tlsCertsExist();
const GATEWAY_DATA_DIR = (process.env.GATEWAY_DATA_DIR || "/data").trim() || "/data";
const CONFIG_FILE = resolveModelsConfigPath();
const BIND_HOST = process.env.BIND_HOST || (HTTP_ONLY ? "0.0.0.0" : "127.0.0.1");
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 7443);
const HTTP_PORT = Number(process.env.HTTP_PORT || 7080);
const LISTEN_PORT = HTTP_ONLY ? Number(process.env.PORT || 8080) : HTTP_PORT;
const PUBLIC_BASE =
  (process.env.PUBLIC_BASE || "").trim() ||
  (HTTP_ONLY ? `http://127.0.0.1:${LISTEN_PORT}` : `https://127.0.0.1:${HTTPS_PORT}`);

function resolveModelsConfigPath() {
  if (process.env.MODELS_CONFIG_PATH?.trim()) {
    return path.resolve(process.env.MODELS_CONFIG_PATH.trim());
  }
  if (HTTP_ONLY) {
    return path.join(GATEWAY_DATA_DIR, "models.json");
  }
  return LEGACY_CONFIG_FILE;
}

function tlsCertsExist() {
  try {
    fs.accessSync(fileURLToPath(CERT), fs.constants.R_OK);
    fs.accessSync(fileURLToPath(KEY), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function handleRequest(req, res, base = PUBLIC_BASE) {
  try {
    await route(req, res, base);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { type: "error", error: { type: "internal_error", message: String(err?.message || err) } });
  }
}

const httpServer = http.createServer((req, res) => {
  const base = HTTP_ONLY ? PUBLIC_BASE : `http://127.0.0.1:${LISTEN_PORT}`;
  return handleRequest(req, res, base);
});

function logStartup() {
  ensureConfigFile();
  console.log(`Gateway mode: ${HTTP_ONLY ? "HTTP (cloud)" : "HTTPS + HTTP (local)"}`);
  console.log(`Config file: ${CONFIG_FILE}`);
  console.log(`Default model: ${DEFAULT_MODEL}`);
  if (GATEWAY_API_KEY) console.log("Gateway client API key auth enabled (GATEWAY_API_KEY)");
}

if (HTTP_ONLY) {
  httpServer.listen(LISTEN_PORT, BIND_HOST, () => {
    console.log(`Gateway HTTP listening on http://${BIND_HOST}:${LISTEN_PORT}`);
    console.log(`Public base (for logs): ${PUBLIC_BASE}`);
    logStartup();
  });
} else {
  const server = https.createServer(
    {
      cert: fs.readFileSync(CERT),
      key: fs.readFileSync(KEY),
    },
    (req, res) => handleRequest(req, res),
  );

  server.listen(HTTPS_PORT, BIND_HOST, () => {
    console.log(`Gateway HTTPS listening on https://${BIND_HOST}:${HTTPS_PORT}`);
    logStartup();
  });

  httpServer.listen(HTTP_PORT, BIND_HOST, () => {
    console.log(`Gateway HTTP listening on http://${BIND_HOST}:${HTTP_PORT}`);
  });
}

function applyCors(req, res) {
  const requestOrigin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  let allowOrigin = "*";
  if (CORS_ORIGIN !== "*") {
    const allowed = CORS_ORIGIN.split(",").map((item) => item.trim()).filter(Boolean);
    allowOrigin = allowed.includes(requestOrigin) ? requestOrigin : allowed[0] || "*";
  }
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, x-api-key, X-Requested-With",
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

async function route(req, res, base = PUBLIC_BASE) {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", base);
  console.log(`${new Date().toISOString()} ${req.method} ${url.pathname}`);

  const publicStatic =
    req.method === "GET" && ["/", "/app.js", "/styles.css", "/config.js"].includes(url.pathname);
  if (GATEWAY_API_KEY && !publicStatic && !clientGatewayAuthOk(req)) {
    return sendJson(res, 401, {
      type: "error",
      error: { type: "authentication_error", message: "Invalid or missing gateway API key" },
    });
  }

  if (req.method === "GET" && url.pathname === "/") {
    return serveFile(res, new URL("./index.html", STATIC_DIR), "text/html; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/config.js") {
    const key = JSON.stringify(GATEWAY_API_KEY);
    return sendBody(res, 200, `window.__GATEWAY_CLIENT_KEY__=${key};\n`, "application/javascript; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/app.js") {
    return serveFile(res, new URL("./app.js", STATIC_DIR), "text/javascript; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/styles.css") {
    return serveFile(res, new URL("./styles.css", STATIC_DIR), "text/css; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/health") {
    const config = readGatewayConfig();
    return sendJson(res, 200, {
      ok: true,
      mode: HTTP_ONLY ? "http" : "local",
      listen: { host: BIND_HOST, port: HTTP_ONLY ? LISTEN_PORT : HTTP_PORT, httpOnly: HTTP_ONLY },
      publicBase: PUBLIC_BASE,
      configFile: CONFIG_FILE,
      configPersistent: HTTP_ONLY,
      storageHint: HTTP_ONLY
        ? "Mount Zeabur volume at /data (see ZEABUR.md) so models.json survives redeploy."
        : null,
      providerCount: config.routes.filter((route) => route.enabled !== false).length,
      defaultModel: getDefaultModel(config),
      forwardTools: FORWARD_TOOLS,
      entrypoints: [
        "OpenAI Chat Completions POST /v1/chat/completions",
        "OpenAI alias POST /v1",
        "Optional alias POST /v1/unified/chat",
        "Anthropic POST /v1/messages",
      ],
      gatewayClientAuth: {
        required: Boolean(GATEWAY_API_KEY),
        accepts: ["Authorization: Bearer <GATEWAY_API_KEY>", "x-api-key: <GATEWAY_API_KEY>"],
      },
      models: listConfiguredModels(config),
    });
  }

  if (req.method === "GET" && url.pathname === "/admin/routes") {
    return sendJson(res, 200, redactConfig(readGatewayConfig()));
  }

  if (req.method === "PUT" && url.pathname === "/admin/routes") {
    const body = await readJson(req);
    return sendJson(res, 200, redactConfig(writeGatewayConfig(body)));
  }

  if (req.method === "POST" && url.pathname === "/admin/test") {
    const body = await readJson(req);
    return handleAdminTest(body, res);
  }

  if (req.method === "GET" && url.pathname === "/v1/models") {
    return handleModels(res);
  }

  if (req.method === "POST" && url.pathname === "/v1/messages") {
    const body = await readJson(req);
    return handleMessages(body, res);
  }

  if (
    req.method === "POST" &&
    (url.pathname === "/v1" || url.pathname === "/v1/chat/completions" || url.pathname === "/v1/unified/chat")
  ) {
    const body = await readJson(req);
    return handleChatCompletions(body, res);
  }

  sendJson(res, 404, { type: "error", error: { type: "not_found_error", message: "Not found" } });
}

async function handleModels(res) {
  const unique = listConfiguredModels(readGatewayConfig());
  sendJson(res, 200, {
    data: unique.map((id) => ({
      id,
      type: "model",
      display_name: id,
      created_at: "2026-01-01T00:00:00Z",
    })),
    first_id: unique[0],
    has_more: false,
    last_id: unique.at(-1),
  });
}

async function handleMessages(body, res) {
  const config = readGatewayConfig();
  const route = resolveRoute(config, body.model);
  const model = normalizeModel(body.model, config, route);
  const upstreamModel = toUpstreamModel(model, route);
  const apiKey = resolveRouteApiKey(route);
  if (!apiKey) {
    return sendJson(res, 401, {
      type: "error",
      error: { type: "authentication_error", message: `No API key configured for route ${route.id}` },
    });
  }

  if (route.type === "anthropic-messages") {
    const upstreamBody = { ...body, model: upstreamModel };
    return fetchAnthropicMessages(route, apiKey, upstreamBody, res);
  }

  const openaiBody = {
    model: upstreamModel,
    messages: convertMessages(body),
    max_tokens: body.max_tokens ?? 4096,
    temperature: body.temperature,
    top_p: body.top_p,
    stream: body.stream !== false,
  };

  if (Array.isArray(body.tools) && body.tools.length) {
    openaiBody.tools = body.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description || "",
        parameters: tool.input_schema || { type: "object", properties: {} },
      },
    }));
    openaiBody.tool_choice = "auto";
  }

  for (const key of Object.keys(openaiBody)) {
    if (openaiBody[key] === undefined) delete openaiBody[key];
  }

  const upstream = await fetch(upstreamUrl(route), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(openaiBody),
  });

  if (!upstream.ok) {
    return sendJson(res, upstream.status, normalizeError(await upstream.text(), upstream.status));
  }

  if (!openaiBody.stream) {
    const json = await upstream.json();
    return sendJson(res, 200, openAiToAnthropicMessage(json, model));
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  await streamOpenAiAsAnthropic(upstream, res, model);
}

async function handleChatCompletions(body, res) {
  const config = readGatewayConfig();
  const route = resolveRoute(config, body.model);
  const model = normalizeModel(body.model, config, route);
  const upstreamModel = toUpstreamModel(model, route);
  const apiKey = resolveRouteApiKey(route);
  if (!apiKey) {
    return sendJson(res, 401, {
      error: { type: "authentication_error", message: `No API key configured for route ${route.id}` },
    });
  }

  if (route.type === "openai-chat") {
    const upstreamBody = sanitizeOpenAiChatBody(body, upstreamModel);
    return fetchOpenAiChat(route, apiKey, upstreamBody, res);
  }

  const anthropicBody = openAiChatToAnthropicMessage({ ...body, model: upstreamModel });
  const upstream = await fetch(upstreamUrl(route), {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(anthropicBody),
  });
  const text = await upstream.text();
  if (!upstream.ok) {
    return sendJson(res, upstream.status, normalizeOpenAiError(text, upstream.status));
  }
  const json = safeParseJson(text);
  return sendJson(res, 200, anthropicToOpenAiChat(json, model));
}

function sanitizeOpenAiChatBody(body, upstreamModel) {
  const stripTools = !FORWARD_TOOLS;
  const out = {
    model: upstreamModel,
    messages: sanitizeOpenAiMessages(body?.messages, stripTools),
    stream: body?.stream === true,
  };

  if (body?.max_tokens != null) out.max_tokens = body.max_tokens;
  if (body?.temperature != null) out.temperature = body.temperature;
  if (body?.top_p != null) out.top_p = body.top_p;
  if (body?.stop != null) out.stop = body.stop;

  if (!stripTools) {
    const tools = sanitizeOpenAiTools(body?.tools);
    if (tools.length) {
      out.tools = tools;
      if (body?.tool_choice != null) out.tool_choice = body.tool_choice;
    }
  }

  return out;
}

function sanitizeOpenAiTools(tools) {
  if (!Array.isArray(tools)) return [];
  return tools
    .map((tool) => normalizeOpenAiTool(tool))
    .filter(Boolean);
}

function normalizeOpenAiTool(tool) {
  if (!tool || typeof tool !== "object") return null;

  const nestedName = tool.function?.name;
  const flatName = tool.name;
  const name = String(nestedName || flatName || "").trim();
  if (!name) return null;

  const fn = tool.function && typeof tool.function === "object" ? tool.function : tool;
  return {
    type: "function",
    function: {
      name,
      description: fn.description ?? "",
      parameters: fn.parameters ?? fn.input_schema ?? { type: "object", properties: {} },
    },
  };
}

function sanitizeOpenAiMessages(messages, stripTools = false) {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((msg) => {
      if (!msg?.role) return null;
      if (stripTools && msg.role === "tool") return null;

      const out = { role: msg.role };

      if (msg.role === "tool") {
        out.content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "");
        if (msg.tool_call_id) out.tool_call_id = msg.tool_call_id;
        return out;
      }

      if (!stripTools && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
        out.tool_calls = msg.tool_calls
          .map((tc) => {
            const name = tc?.function?.name ?? tc?.name;
            if (!name) return null;
            const args = tc?.function?.arguments ?? tc?.arguments ?? "{}";
            return {
              id: tc?.id || `call_${randomUUID().slice(0, 8)}`,
              type: "function",
              function: {
                name: String(name),
                arguments: typeof args === "string" ? args : JSON.stringify(args),
              },
            };
          })
          .filter(Boolean);
      }

      if (typeof msg.content === "string") {
        out.content = msg.content;
      } else if (Array.isArray(msg.content)) {
        out.content = msg.content
          .map((part) => {
            if (part?.type === "text" && part.text != null) return { type: "text", text: String(part.text) };
            if (part?.type === "image_url") return part;
            return null;
          })
          .filter(Boolean);
        if (!out.content.length) out.content = "";
      } else if (msg.content != null) {
        out.content = String(msg.content);
      } else if (msg.reasoning_content) {
        out.content = String(msg.reasoning_content);
      } else {
        out.content = "";
      }

      if (msg.name) out.name = msg.name;
      return out;
    })
    .filter(Boolean);
}

async function fetchOpenAiChat(route, apiKey, body, res) {
  const payload = sanitizeOpenAiChatBody(body, body.model);

  const upstream = await fetch(upstreamUrl(route), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!upstream.ok) {
    return sendJson(res, upstream.status, normalizeOpenAiError(await upstream.text(), upstream.status));
  }

  if (payload.stream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    upstream.body.pipeTo(
      new WritableStream({
        write(chunk) {
          res.write(Buffer.from(chunk));
        },
        close() {
          res.end();
        },
      }),
    );
    return;
  }

  sendJson(res, 200, await upstream.json());
}

async function fetchAnthropicMessages(route, apiKey, body, res) {
  const upstream = await fetch(upstreamUrl(route), {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!upstream.ok) {
    return sendJson(res, upstream.status, normalizeError(await upstream.text(), upstream.status));
  }

  if (body.stream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    upstream.body.pipeTo(
      new WritableStream({
        write(chunk) {
          res.write(Buffer.from(chunk));
        },
        close() {
          res.end();
        },
      }),
    );
    return;
  }

  sendJson(res, 200, await upstream.json());
}

function convertMessages(body) {
  const messages = [];
  if (body.system) {
    messages.push({ role: "system", content: flattenContent(body.system) });
  }

  for (const msg of body.messages || []) {
    if (msg.role === "assistant") {
      const assistant = { role: "assistant", content: "" };
      const toolCalls = [];
      for (const block of asArray(msg.content)) {
        if (typeof block === "string") assistant.content += block;
        if (block?.type === "text") assistant.content += block.text || "";
        if (block?.type === "tool_use") {
          toolCalls.push({
            id: block.id || `call_${randomUUID().replaceAll("-", "")}`,
            type: "function",
            function: { name: block.name, arguments: JSON.stringify(block.input || {}) },
          });
        }
      }
      if (toolCalls.length) assistant.tool_calls = toolCalls;
      messages.push(assistant);
      continue;
    }

    if (msg.role === "user") {
      for (const block of asArray(msg.content)) {
        if (block?.type === "tool_result") {
          messages.push({
            role: "tool",
            tool_call_id: block.tool_use_id,
            content: flattenContent(block.content),
          });
        }
      }
      const text = asArray(msg.content)
        .filter((block) => block?.type !== "tool_result")
        .map(flattenContent)
        .filter(Boolean)
        .join("\n");
      if (text) messages.push({ role: "user", content: text });
      continue;
    }

    messages.push({ role: msg.role, content: flattenContent(msg.content) });
  }

  return messages.length ? messages : [{ role: "user", content: "" }];
}

function flattenContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content?.text || "";
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block?.type === "text") return block.text || "";
      if (block?.type === "image") return "[Image omitted: upstream model endpoint is text-only through this bridge]";
      if (block?.type === "tool_result") return flattenContent(block.content);
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

function normalizeModel(model, config = readGatewayConfig(), route = resolveRoute(config, model)) {
  if (!model) return getDefaultModel(config);
  if (/^claude-|^(haiku|sonnet|opus)$/i.test(model)) return getDefaultModel(config);
  return model;
}

async function streamOpenAiAsAnthropic(upstream, res, model) {
  const messageId = `msg_${randomUUID().replaceAll("-", "")}`;
  let textStarted = false;
  let textIndex = 0;
  let nextIndex = 0;
  let stopReason = "end_turn";
  const toolIndexes = new Map();

  sse(res, "message_start", {
    type: "message_start",
    message: {
      id: messageId,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;

      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) stopReason = mapStopReason(choice.finish_reason);
      const delta = choice.delta || {};
      const text = delta.content ?? delta.reasoning_content ?? "";

      if (text) {
        if (!textStarted) {
          textIndex = nextIndex++;
          textStarted = true;
          sse(res, "content_block_start", {
            type: "content_block_start",
            index: textIndex,
            content_block: { type: "text", text: "" },
          });
        }
        sse(res, "content_block_delta", {
          type: "content_block_delta",
          index: textIndex,
          delta: { type: "text_delta", text },
        });
      }

      for (const tc of delta.tool_calls || []) {
        const openaiIndex = tc.index ?? 0;
        let anthropicIndex = toolIndexes.get(openaiIndex);
        if (anthropicIndex === undefined) {
          anthropicIndex = nextIndex++;
          toolIndexes.set(openaiIndex, anthropicIndex);
          sse(res, "content_block_start", {
            type: "content_block_start",
            index: anthropicIndex,
            content_block: {
              type: "tool_use",
              id: tc.id || `call_${randomUUID().replaceAll("-", "")}`,
              name: tc.function?.name || "unknown_tool",
              input: {},
            },
          });
        }
        if (tc.function?.arguments) {
          sse(res, "content_block_delta", {
            type: "content_block_delta",
            index: anthropicIndex,
            delta: { type: "input_json_delta", partial_json: tc.function.arguments },
          });
        }
      }
    }
  }

  for (let i = 0; i < nextIndex; i++) {
    sse(res, "content_block_stop", { type: "content_block_stop", index: i });
  }
  sse(res, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 0 },
  });
  sse(res, "message_stop", { type: "message_stop" });
  res.end();
}

function openAiToAnthropicMessage(json, model) {
  const choice = json.choices?.[0] || {};
  const msg = choice.message || {};
  const content = [];
  if (msg.content || msg.reasoning_content) {
    content.push({ type: "text", text: msg.content || msg.reasoning_content });
  }
  for (const tc of msg.tool_calls || []) {
    content.push({
      type: "tool_use",
      id: tc.id,
      name: tc.function?.name,
      input: safeParseJson(tc.function?.arguments || "{}"),
    });
  }
  return {
    id: `msg_${randomUUID().replaceAll("-", "")}`,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: mapStopReason(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: json.usage?.prompt_tokens || 0,
      output_tokens: json.usage?.completion_tokens || 0,
    },
  };
}

function openAiChatToAnthropicMessage(body) {
  const system = [];
  const messages = [];
  for (const msg of body.messages || []) {
    if (msg.role === "system") {
      system.push(msg.content || "");
      continue;
    }
    if (msg.role === "tool") {
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: msg.tool_call_id, content: msg.content || "" }],
      });
      continue;
    }
    messages.push({
      role: msg.role === "assistant" ? "assistant" : "user",
      content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content || ""),
    });
  }
  return {
    model: body.model,
    max_tokens: body.max_tokens ?? 4096,
    temperature: body.temperature,
    top_p: body.top_p,
    stream: false,
    system: system.join("\n") || undefined,
    messages,
  };
}

function anthropicToOpenAiChat(json, model) {
  const text = (json.content || [])
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("");
  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: json.stop_reason === "max_tokens" ? "length" : "stop",
      },
    ],
    usage: {
      prompt_tokens: json.usage?.input_tokens || 0,
      completion_tokens: json.usage?.output_tokens || 0,
      total_tokens: (json.usage?.input_tokens || 0) + (json.usage?.output_tokens || 0),
    },
  };
}

function mapStopReason(reason) {
  if (reason === "tool_calls") return "tool_use";
  if (reason === "length") return "max_tokens";
  return "end_turn";
}

function normalizeError(text, status) {
  let message = text;
  try {
    message = JSON.parse(text).error?.message || text;
  } catch {}
  return { type: "error", error: { type: status === 404 ? "not_found_error" : "api_error", message } };
}

function normalizeOpenAiError(text, status) {
  let message = text;
  try {
    message = JSON.parse(text).error?.message || text;
  } catch {}
  return { error: { type: status === 404 ? "not_found_error" : "api_error", message } };
}

function sse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendBody(res, status, body, contentType) {
  res.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  res.end(body);
}

function presentedGatewayKey(req) {
  const raw = req.headers.authorization;
  const m = typeof raw === "string" ? /^Bearer\s+(\S+)/i.exec(raw) : null;
  if (m) return m[1].trim();
  const x = req.headers["x-api-key"];
  if (typeof x === "string" && x.trim()) return x.trim();
  return "";
}

function clientGatewayAuthOk(req) {
  const presented = presentedGatewayKey(req);
  try {
    const a = Buffer.from(presented, "utf8");
    const b = Buffer.from(GATEWAY_API_KEY, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function safeJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function readLocalNvidiaProfile() {
  try {
    const path = `${os.homedir()}/.claude.json`;
    const data = JSON.parse(fs.readFileSync(path, "utf8"));
    const profiles = data.providerProfiles || [];
    const profile =
      profiles.find((p) => p.id === "provider_nvidia_minimax_m27") ||
      profiles.find((p) => String(p.baseUrl || "").includes("integrate.api.nvidia.com"));
    return {
      apiKey: profile?.apiKey,
      model: profile?.model,
    };
  } catch {
    return {};
  }
}

async function handleAdminTest(body, res) {
  const config = readGatewayConfig();
  const saved =
    config.routes.find((item) => item.id === body.routeId) || resolveRoute(config, body.model);
  const route = {
    ...saved,
    ...(body.baseUrl?.trim() ? { baseUrl: body.baseUrl.trim() } : {}),
    ...(body.apiKey?.trim() ? { apiKey: body.apiKey.trim() } : {}),
  };
  const model = body.model || route.defaultModel || route.models?.[0];
  if (!model) {
    return sendJson(res, 400, { ok: false, error: "No model selected" });
  }

  const apiKey = resolveRouteApiKey(route);
  if (!apiKey) {
    return sendJson(res, 400, { ok: false, error: `No API key configured for ${route.name || route.id}` });
  }
  if (/^replace-with/i.test(apiKey) || apiKey === "not-required-for-local-only") {
    return sendJson(res, 400, {
      ok: false,
      error: `上游「${route.name}」仍是模板占位密钥，请粘贴真实 API Key 后再测试。`,
    });
  }

  const startedAt = Date.now();
  const payload = {
    model: toUpstreamModel(model, route),
    max_tokens: 12,
    temperature: 0,
    stream: false,
  };
  const upstream =
    route.type === "anthropic-messages"
      ? await fetch(upstreamUrl(route), {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...payload, messages: [{ role: "user", content: "Reply with exactly OK" }] }),
        })
      : await fetch(upstreamUrl(route), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...payload,
            messages: [{ role: "user", content: "Reply with exactly OK" }],
          }),
        });
  const text = await upstream.text();
  if (!upstream.ok) {
    return sendJson(res, upstream.status, {
      ok: false,
      status: upstream.status,
      error: formatAdminTestError(route, upstream.status, text),
      detail: text.slice(0, 1000),
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  sendJson(res, 200, {
    ok: true,
    status: upstream.status,
    latencyMs: Date.now() - startedAt,
    reply:
      parsed.choices?.[0]?.message?.content ||
      parsed.choices?.[0]?.message?.reasoning_content ||
      (parsed.content || []).map((block) => block.text || "").join("") ||
      "",
    usage: parsed.usage,
  });
}

function formatAdminTestError(route, status, text) {
  const envHint = ROUTE_ENV_KEYS[route.id] ? `，或在 Zeabur 设置环境变量 ${ROUTE_ENV_KEYS[route.id]}` : "";
  if (
    status === 401 ||
    /Authentication failed|Unauthorized|API_KEY_INVALID|API key not valid|replace-with/i.test(text)
  ) {
    return `上游「${route.name}」API Key 无效或未配置（HTTP ${status}）${envHint}。请在该渠道填入 NVIDIA / Google 等平台颁发的真实密钥（不是页面上的 Gateway 统一 Key）。`;
  }
  return text.slice(0, 500);
}

function readGatewayConfig() {
  ensureConfigFile();
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  return {
    ...config,
    routes: (config.routes || []).map(applyRouteEnvSecrets),
  };
}

const ROUTE_ENV_KEYS = {
  nvidia: "NVIDIA_API_KEY",
  google: "GOOGLE_API_KEY",
  "lm-studio": "LM_STUDIO_API_KEY",
};

function applyRouteEnvSecrets(route) {
  const envVar = ROUTE_ENV_KEYS[route.id];
  const fromEnv = envVar ? (process.env[envVar] || "").trim() : "";
  const key = String(route.apiKey || "").trim();
  const placeholder =
    !key || /^replace-with/i.test(key) || key === "not-required-for-local-only";
  if (fromEnv && (placeholder || !key)) {
    return { ...route, apiKey: fromEnv };
  }
  if (route.id === "nvidia" && !key) {
    const nv = (process.env.NVIDIA_API_KEY || localNvidiaProfile.apiKey || "").trim();
    if (nv) return { ...route, apiKey: nv };
  }
  return route;
}

function scheduleHermesSync() {
  if (HTTP_ONLY || process.env.HERMES_AUTO_SYNC === "0") return;
  if (!fs.existsSync(HERMES_SYNC_SCRIPT)) {
    console.warn(`Hermes sync skipped: missing ${HERMES_SYNC_SCRIPT}`);
    return;
  }
  const base = `http://127.0.0.1:${LISTEN_PORT}/v1`;
  const child = spawn(process.execPath, [HERMES_SYNC_SCRIPT], {
    env: {
      ...process.env,
      GATEWAY_MODELS_URL: `${base}/models`,
      HERMES_GATEWAY_BASE: base,
      GATEWAY_API_KEY,
    },
    stdio: "ignore",
    detached: true,
  });
  child.unref();
  child.on("error", (err) => console.error("[hermes-sync]", err.message));
  child.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`[hermes-sync] exited ${code}${signal ? ` (${signal})` : ""}`);
    }
  });
}

function writeGatewayConfig(input) {
  const current = readGatewayConfig();
  const used = new Set();
  const routes = (input.routes || []).map((route, index) => {
    const requestedId = slug(route.id || route.name || `provider-${index + 1}`);
    const id = uniqueRouteId(requestedId, used);
    used.add(id);
    const existing = current.routes.find((item) => item.id === id) || current.routes.find((item) => item.name === route.name);
    const apiKey =
      route.apiKey && route.apiKey !== "__KEEP__"
        ? route.apiKey
        : existing?.apiKey || (id === "nvidia" ? localNvidiaProfile.apiKey : "");
    return normalizeRoute({ ...route, id, apiKey });
  });

  const mergedRoutes = routes.length ? routes : defaultConfig().routes;
  const requestedDefault = String(input.defaultModel ?? current.defaultModel ?? "").trim();
  const next = {
    defaultModel: requestedDefault || inferGatewayDefaultModel(mergedRoutes),
    routes: mergedRoutes,
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + "\n");
  scheduleHermesSync();
  return next;
}

function ensureConfigFile() {
  if (fs.existsSync(CONFIG_FILE)) return;
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  if (LEGACY_CONFIG_FILE !== CONFIG_FILE && fs.existsSync(LEGACY_CONFIG_FILE)) {
    fs.copyFileSync(LEGACY_CONFIG_FILE, CONFIG_FILE);
    console.log(`Migrated config: ${LEGACY_CONFIG_FILE} -> ${CONFIG_FILE}`);
    return;
  }
  if (fs.existsSync(EXAMPLE_CONFIG_FILE)) {
    fs.copyFileSync(EXAMPLE_CONFIG_FILE, CONFIG_FILE);
    console.warn(
      `[gateway] 已从模板创建 ${CONFIG_FILE}。请在 Zeabur Volumes 挂载 /data，否则 Redeploy 后网页里保存的上游 API Key 会丢失。见 ZEABUR.md`,
    );
    return;
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig(), null, 2) + "\n");
}

function inferGatewayDefaultModel(routes) {
  const enabled = (routes || []).filter((route) => route.enabled !== false);
  const route = enabled[0] || routes?.[0];
  return route?.defaultModel || route?.models?.[0] || DEFAULT_MODEL;
}

function defaultConfig() {
  const routes = [
      normalizeRoute({
        id: "nvidia",
        name: "NVIDIA NIM",
        type: "openai-chat",
        baseUrl: UPSTREAM_BASE,
        apiKey: process.env.NVIDIA_API_KEY || localNvidiaProfile.apiKey || "",
        enabled: true,
        defaultModel: DEFAULT_MODEL,
        models: [
          "meta/llama-3.3-70b-instruct",
          "minimaxai/minimax-m2.7",
          "z-ai/glm-5.1",
          "deepseek-ai/deepseek-v3.2",
          "moonshotai/kimi-k2-instruct-0905",
          "openai/gpt-oss-120b",
          "qwen/qwen3-next-80b-a3b-instruct",
        ],
      }),
  ];
  return {
    defaultModel: inferGatewayDefaultModel(routes),
    routes,
  };
}

function normalizeRoute(route) {
  return {
    id: slug(route.id || route.name || `route-${randomUUID().slice(0, 8)}`),
    name: String(route.name || route.id || "Provider"),
    type: route.type === "anthropic-messages" ? "anthropic-messages" : "openai-chat",
    baseUrl: String(route.baseUrl || "").replace(/\/$/, ""),
    apiKey: String(route.apiKey || ""),
    enabled: route.enabled !== false,
    defaultModel: String(route.defaultModel || route.models?.[0] || ""),
    models: normalizeModelList(route.models),
  };
}

function upstreamUrl(route) {
  return String(route.baseUrl || "").trim().replace(/\/$/, "");
}

function normalizeModelList(models) {
  const lines = Array.isArray(models) ? models : String(models || "").split(/\r?\n|,/);
  return [...new Set(lines.map((item) => String(item).trim()).filter(Boolean))];
}

function redactConfig(config) {
  return {
    defaultModel: String(config.defaultModel || "").trim(),
    routes: config.routes.map((route) => ({
      ...route,
      apiKey: resolveRouteApiKey(route),
    })),
  };
}

function resolveRoute(config, requestedModel) {
  const routes = config.routes.filter((route) => route.enabled !== false);
  if (!routes.length) return defaultConfig().routes[0];
  const model = requestedModel || "";
  const prefixed = routes.find((route) => model.startsWith(`${route.id}/`));
  if (prefixed) return prefixed;
  const exact = routes.find((route) => route.models.includes(model) || route.defaultModel === model);
  return exact || routes[0];
}

function resolveRouteApiKey(route) {
  if (route.apiKey) return route.apiKey;
  if (route.id === "nvidia") return process.env.NVIDIA_API_KEY || localNvidiaProfile.apiKey;
  return "";
}

function toUpstreamModel(model, route) {
  const prefix = `${route.id}/`;
  return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}

function getDefaultModel(config) {
  const stored = String(config.defaultModel || "").trim();
  if (stored) return stored;
  return inferGatewayDefaultModel(config.routes);
}

function listConfiguredModels(config) {
  const routes = config.routes.filter((route) => route.enabled !== false);
  const models = [];
  for (const route of routes) {
    for (const model of route.models || []) models.push(model);
  }
  return [...new Set(models.length ? models : [getDefaultModel(config)])];
}

function slug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function uniqueRouteId(base, used) {
  const root = base || "provider";
  let id = root;
  let counter = 2;
  while (used.has(id)) {
    id = `${root}-${counter}`;
    counter += 1;
  }
  return id;
}

function serveFile(res, path, contentType) {
  if (!fs.existsSync(path)) {
    return sendJson(res, 404, { error: "Missing UI asset" });
  }
  res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
  res.end(fs.readFileSync(path));
}
