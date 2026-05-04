const routesEl = document.querySelector("#routes");
const routeTemplate = document.querySelector("#routeTemplate");
const modelTemplate = document.querySelector("#modelTemplate");
const statusLine = document.querySelector("#statusLine");
const providerCount = document.querySelector("#providerCount");
const entryValue = document.querySelector("#entryValue");
const entryProtocol = document.querySelector("#entryProtocol");

let routes = [];
let activeEntryProtocol = localStorage.getItem("gateway.entryProtocol") || "anthropic";

document.querySelector("#reloadBtn").addEventListener("click", load);
document.querySelector("#addBtn").addEventListener("click", () => {
  const id = nextProviderId();
  routes.push({
    id,
    name: "新渠道",
    type: "openai-chat",
    baseUrl: "",
    apiKey: "",
    enabled: true,
    defaultModel: "",
    models: [],
  });
  render();
});
document.querySelector("#saveBtn").addEventListener("click", save);
entryProtocol.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-protocol]");
  if (!button) return;
  activeEntryProtocol = button.dataset.protocol;
  localStorage.setItem("gateway.entryProtocol", activeEntryProtocol);
  renderEntryProtocol();
});

load();

async function load() {
  const [health, config] = await Promise.all([fetchJson("/health"), fetchJson("/admin/routes")]);
  routes = config.routes;
  statusLine.textContent = `运行中，默认模型：${health.defaultModel || "-"}`;
  providerCount.textContent = `${health.providerCount} 个启用渠道`;
  renderEntryProtocol();
  render();
}

function renderEntryProtocol() {
  entryProtocol.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.protocol === activeEntryProtocol);
  });
  entryValue.textContent =
    activeEntryProtocol === "anthropic"
      ? "http://127.0.0.1:7080/v1/messages"
      : "http://127.0.0.1:7080/v1/chat/completions";
  statusLine.textContent =
    activeEntryProtocol === "anthropic"
      ? "入口协议已切换为 Anthropic Messages"
      : "入口协议已切换为 OpenAI Chat Completions";
}

function render() {
  routesEl.textContent = "";
  routes.forEach((route, index) => {
    const node = routeTemplate.content.firstElementChild.cloneNode(true);
    bindRoute(node, route, index);
    routesEl.appendChild(node);
  });
  routesEl.querySelector(".route:last-child .name")?.focus();
}

function bindRoute(node, route, index) {
  bindField(node, route, "enabled");
  bindField(node, route, "name");
  bindField(node, route, "baseUrl");
  bindField(node, route, "apiKey");
  route.type = "openai-chat";
  bindModels(node, route);

  node.querySelector("[data-action='delete']").addEventListener("click", () => {
    routes.splice(index, 1);
    render();
  });

  const testButton = node.querySelector("[data-action='test']");
  testButton.addEventListener("click", async () => {
    const state = node.querySelector("[data-role='testState']");
    state.className = "";
    state.textContent = "测试中...";
    testButton.disabled = true;
    testButton.textContent = "测试中";
    try {
      validateRouteForTest(route);
      const saved = await persist(false);
      routes = saved.routes;
      const current = routes[index] || route;
      const result = await fetchJson("/admin/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routeId: current.id, model: current.defaultModel || current.models?.[0] }),
      });
      state.className = result.ok ? "ok" : "error";
      state.textContent = result.ok ? `测试成功 · ${result.latencyMs}ms · ${result.reply || "已响应"}` : result.error;
      testButton.textContent = result.ok ? "成功" : "测试";
    } catch (err) {
      state.className = "error";
      state.textContent = String(err.message || err);
      testButton.textContent = "测试";
    } finally {
      testButton.disabled = false;
    }
  });
}

function bindField(node, route, key) {
  const field = node.querySelector(`[data-field="${key}"]`);
  if (!field) return;
  if (key === "enabled") {
    field.checked = route.enabled !== false;
    field.addEventListener("change", () => (route.enabled = field.checked));
    return;
  }
  if (key === "apiKey") {
    field.value = route.apiKey || "";
    field.addEventListener("input", () => (route.apiKey = field.value));
    return;
  }
  field.value = route[key] || "";
  field.addEventListener("input", () => {
    route[key] = field.value;
  });
}

function bindModels(node, route) {
  const list = node.querySelector("[data-role='models']");
  const addButton = node.querySelector("[data-action='add-model']");
  const draw = () => {
    list.textContent = "";
    const models = route.models || [];
    if (!models.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "还没有模型，点击“添加模型”。";
      list.appendChild(empty);
      return;
    }
    models.forEach((model, index) => {
      const row = modelTemplate.content.firstElementChild.cloneNode(true);
      const input = row.querySelector("[data-role='model-name']");
      const defaultButton = row.querySelector("[data-action='set-default']");
      input.value = model;
      input.addEventListener("input", () => {
        route.models[index] = input.value.trim();
        if (route.defaultModel === model) route.defaultModel = route.models[index];
      });
      defaultButton.classList.toggle("active", route.defaultModel === model);
      defaultButton.textContent = route.defaultModel === model ? "默认模型" : "设为默认";
      defaultButton.addEventListener("click", () => {
        route.defaultModel = route.models[index];
        draw();
      });
      row.querySelector("[data-action='remove-model']").addEventListener("click", () => {
        const removed = route.models.splice(index, 1)[0];
        if (route.defaultModel === removed) route.defaultModel = route.models[0] || "";
        draw();
      });
      list.appendChild(row);
    });
  };
  addButton.addEventListener("click", () => {
    route.models = route.models || [];
    route.models.push("");
    draw();
    list.querySelector(".model-row:last-child input")?.focus();
  });
  draw();
}

function validateRouteForTest(route) {
  if (!route.name?.trim()) throw new Error("请先填写渠道名称");
  if (!route.baseUrl?.trim()) throw new Error("请先填写 Base URL");
  if (!route.apiKey?.trim()) throw new Error("请先填写 API Key");
  const model = route.defaultModel || route.models?.find(Boolean);
  if (!model?.trim()) throw new Error("请先添加至少一个模型，并设为默认");
}

async function save(showStatus = true) {
  const config = await persist(showStatus);
  routes = config.routes;
  if (showStatus) {
    statusLine.textContent = "已保存。入口会在下一次读取模型时看到新配置。";
  }
  render();
}

async function persist() {
  const payload = {
    routes: routes.map((route) => {
      const models = (route.models || []).map((model) => model.trim()).filter(Boolean);
      return {
        ...route,
        id: route.id || slug(route.name),
        apiKey: route.apiKey || "",
        models,
        defaultModel: models.includes(route.defaultModel) ? route.defaultModel : models[0] || "",
      };
    }),
  };
  return fetchJson("/admin/routes", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = data.error?.message || data.error || text || `${response.status}`;
    throw new Error(message);
  }
  return data;
}

function slug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function nextProviderId() {
  const used = new Set(routes.map((route) => route.id));
  let index = routes.length + 1;
  let id = `provider-${index}`;
  while (used.has(id)) {
    index += 1;
    id = `provider-${index}`;
  }
  return id;
}
