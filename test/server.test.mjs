import assert from "node:assert/strict";
import test from "node:test";

import {
  CONFIG_FILE,
  claudeDesktopAliasForModel,
  getDefaultModel,
  formatModelListResponse,
  listConfiguredModels,
  modelIdsForPicker,
  normalizeModel,
  resolveModelRoute,
  resolveRoute,
  sanitizeOpenAiChatBody,
  sanitizeOpenAiTools,
} from "../server.mjs";

const config = {
  defaultModel: "model-a",
  routes: [
    {
      id: "alpha",
      name: "Alpha",
      type: "openai-chat",
      baseUrl: "https://alpha.example/v1/chat/completions",
      apiKey: "alpha-key",
      enabled: true,
      defaultModel: "model-a",
      models: ["model-a", "model-b"],
    },
    {
      id: "beta",
      name: "Beta",
      type: "openai-chat",
      baseUrl: "https://beta.example/v1/chat/completions",
      apiKey: "beta-key",
      enabled: true,
      defaultModel: "model-c",
      models: ["model-c"],
    },
    {
      id: "anthropic",
      name: "Anthropic",
      type: "anthropic-messages",
      baseUrl: "https://api.anthropic.com/v1/messages",
      apiKey: "anthropic-key",
      enabled: true,
      defaultModel: "claude-test",
      models: ["claude-test"],
    },
  ],
};

test("local .env cloud hints do not force /data config in local tests", () => {
  assert.ok(CONFIG_FILE.endsWith("/models.json"), CONFIG_FILE);
  assert.ok(!CONFIG_FILE.startsWith("/data/"), CONFIG_FILE);
});

test("empty model uses the gateway default model", () => {
  const resolved = resolveModelRoute(config, "");
  assert.equal(resolved.error, undefined);
  assert.equal(resolved.model, "model-a");
  assert.equal(resolved.route.id, "alpha");
});

test("configured model routes to its owning provider", () => {
  assert.equal(resolveRoute(config, "model-c").id, "beta");
  assert.equal(resolveRoute(config, "beta/model-c").id, "beta");
});

test("unknown explicit model returns a 400 routing error", () => {
  const resolved = resolveModelRoute(config, "missing-model", "openai-chat");
  assert.equal(resolved.status, 400);
  assert.equal(resolved.error.error.code, "unknown_model");
  assert.deepEqual(resolved.error.error.available_models, ["model-a", "model-b", "model-c"]);
});

test("route resolution is scoped by requested protocol", () => {
  assert.equal(resolveModelRoute(config, "model-c", "openai-chat").route.id, "beta");
  assert.equal(resolveModelRoute(config, "claude-test", "anthropic-messages").route.id, "anthropic");
});

test("using the wrong protocol returns a protocol mismatch", () => {
  const resolved = resolveModelRoute(config, "model-c", "anthropic-messages");
  assert.equal(resolved.status, 400);
  assert.equal(resolved.error.error.code, "protocol_mismatch");
  assert.equal(resolved.error.error.configured_route_type, "openai-chat");
  assert.equal(resolved.error.error.expected_route_type, "anthropic-messages");
});

test("model helpers expose configured defaults and enabled model list", () => {
  assert.equal(getDefaultModel(config), "model-a");
  assert.equal(normalizeModel(undefined, config), "model-a");
  assert.deepEqual(listConfiguredModels(config), ["model-a", "model-b", "model-c", "claude-test"]);
});

test("model list response is OpenAI-compatible", () => {
  const body = formatModelListResponse(["model-a", "model-b"]);
  assert.equal(body.object, "list");
  assert.equal(body.data[0].object, "model");
  assert.equal(body.data[0].id, "model-a");
  assert.equal(body.data[0].owned_by, "gateway");
  assert.equal(body.first_id, "model-a");
  assert.equal(body.last_id, "model-b");
});

test("claude desktop aliases are claude-prefixed and map back to configured models", () => {
  const alias = claudeDesktopAliasForModel("deepseek-ai/deepseek-v4-pro");
  assert.match(alias, /^claude-gateway-/);
  const claudeReq = { headers: { "user-agent": "ClaudeDesktop/1.0" } };
  const claudeUrl = new URL("http://127.0.0.1/v1/models");
  const ids = modelIdsForPicker(claudeReq, claudeUrl, config);
  assert.ok(ids.every((id) => id.startsWith("claude-gateway-")), ids.join(", "));
  assert.ok(ids.length >= 3, `expected multiple models, got ${ids.length}`);
});

test("openai clients still receive the full configured model list", () => {
  const openaiReq = { headers: { "user-agent": "Cursor/1.0" } };
  const url = new URL("http://127.0.0.1/v1/models");
  const ids = modelIdsForPicker(openaiReq, url, config);
  assert.deepEqual(ids, ["model-a", "model-b", "model-c", "claude-test"]);
});

test("tools are sanitized by keeping only usable function names", () => {
  const tools = sanitizeOpenAiTools([
    { type: "function", function: { name: "search_web", parameters: { type: "object" } } },
    { type: "function", function: { parameters: { type: "object" } } },
    { name: "flat_tool", input_schema: { type: "object" } },
  ]);
  assert.deepEqual(
    tools.map((tool) => tool.function.name),
    ["search_web", "flat_tool"],
  );
});

test("chat body forwards common OpenAI fields and drops empty tools", () => {
  const body = sanitizeOpenAiChatBody(
    {
      messages: [{ role: "user", content: "hi" }],
      stream: true,
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 32,
      stop: ["END"],
      tools: [
        { type: "function", function: { name: "lookup", parameters: { type: "object" } } },
        { type: "function", function: { parameters: { type: "object" } } },
      ],
      tool_choice: "auto",
    },
    "upstream-model",
  );

  assert.equal(body.model, "upstream-model");
  assert.equal(body.stream, true);
  assert.equal(body.temperature, 0.2);
  assert.equal(body.top_p, 0.9);
  assert.equal(body.max_tokens, 32);
  assert.deepEqual(body.stop, ["END"]);
  assert.equal(body.tools.length, 1);
  assert.equal(body.tools[0].function.name, "lookup");
  assert.equal(body.tool_choice, "auto");
});
