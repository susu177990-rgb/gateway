import assert from "node:assert/strict";
import test from "node:test";

import {
  CONFIG_FILE,
  getDefaultModel,
  listConfiguredModels,
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
  const resolved = resolveModelRoute(config, "missing-model");
  assert.equal(resolved.status, 400);
  assert.equal(resolved.error.error.code, "unknown_model");
  assert.deepEqual(resolved.error.error.available_models, ["model-a", "model-b", "model-c"]);
});

test("model helpers expose configured defaults and enabled model list", () => {
  assert.equal(getDefaultModel(config), "model-a");
  assert.equal(normalizeModel(undefined, config), "model-a");
  assert.deepEqual(listConfiguredModels(config), ["model-a", "model-b", "model-c"]);
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
