const routesEl = document.querySelector("#routes");
const routeTemplate = document.querySelector("#routeTemplate");
const modelTemplate = document.querySelector("#modelTemplate");
const statusEl = document.querySelector("#status");
const addBtn = document.querySelector("#addBtn");
const entryList = document.querySelector("#entryList");
const gatewayClientKey = document.querySelector("#gatewayClientKey");
const gatewayDefaultModelEl = document.querySelector("#gatewayDefaultModel");

const GATEWAY_CLIENT_KEY = "sk_9f4c2a7e8b1d4f6a92c0e3d5b7a18c6f4e2d9a0b";
const AUTOSAVE_MS = 600;
let gatewayPublicOrigin = "";

function gatewayOrigin() {
  const { protocol, hostname, port } = window.location;
  if (!port || port === "443" || port === "80") return `${protocol}//${hostname}`;
  return `${protocol}//${hostname}:${port}`;
}

function resolveGatewayOrigin() {
  return gatewayPublicOrigin || gatewayOrigin();
}

function applyPublicBase(publicBase) {
  const raw = String(publicBase || "").trim();
  if (!raw) return;
  try {
    gatewayPublicOrigin = new URL(raw).origin;
  } catch {
    gatewayPublicOrigin = raw.replace(/\/$/, "");
  }
}

const ENTRY_URLS = {
  get anthropic() {
    return `${resolveGatewayOrigin()}/v1/messages`;
  },
  get openai() {
    return `${resolveGatewayOrigin()}/v1/chat/completions`;
  },
};

let routes = [];
let gatewayDefaultModel = "";
let baseStatus = "正在连接 Gateway…";
let saveState = "idle";
let saveStateDetail = "";
let autosaveTimer = null;
let saveInFlight = false;
let pendingSave = false;
let hydrating = false;
const editingRouteKeys = new Set();

function cloneTemplate(template) {
  const source = template?.content?.firstElementChild;
  if (!source) throw new Error("页面模板缺失，请强制刷新（Cmd+Shift+R）");
  return source.cloneNode(true);
}

function updateStatusDisplay() {
  const saveHint =
    saveState === "pending"
      ? " · 待保存…"
      : saveState === "saving"
        ? " · 保存中…"
        : saveState === "saved"
          ? " · 已自动保存"
          : saveState === "error"
            ? ` · 保存失败：${saveStateDetail}`
            : "";

  const textEl = statusEl.querySelector(".status-text") || statusEl;
  textEl.textContent = `${baseStatus}${saveHint}`;

  statusEl.classList.remove("is-ok", "is-pending", "is-error");
  if (saveState === "error" || baseStatus.includes("失败") || baseStatus.includes("需要统一")) {
    statusEl.classList.add("is-error");
  } else if (saveState === "pending" || saveState === "saving") {
    statusEl.classList.add("is-pending");
  } else if (baseStatus.startsWith("运行中")) {
    statusEl.classList.add("is-ok");
  }
}

function setBaseStatus(text) {
  baseStatus = text;
  updateStatusDisplay();
}

function setSaveState(state, detail = "") {
  saveState = state;
  saveStateDetail = detail;
  updateStatusDisplay();
  if (state === "saved") {
    setTimeout(() => {
      if (saveState === "saved") setSaveState("idle");
    }, 2000);
  }
}

function scheduleAutosave() {
  if (hydrating) return;
  setSaveState("pending");
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    flushAutosave();
  }, AUTOSAVE_MS);
}

function syncAllRoutesFromDom() {
  routesEl.querySelectorAll(".card").forEach((card, index) => {
    const route = routes[index];
    if (!route) return;
    const nameInput = card.querySelector('[data-field="name"]');
    const baseUrlInput = card.querySelector('[data-field="baseUrl"]');
    const apiKeyInput = card.querySelector('[data-field="apiKey"]');
    if (nameInput) route.name = nameInput.value;
    if (baseUrlInput) route.baseUrl = baseUrlInput.value;
    if (apiKeyInput) route.apiKey = apiKeyInput.value;
  });
}

async function flushAutosave() {
  if (hydrating) return;
  if (saveInFlight) {
    pendingSave = true;
    return;
  }

  syncAllRoutesFromDom();
  saveInFlight = true;
  pendingSave = false;
  setSaveState("saving");

  try {
    const saved = await persist();
    routes = saved.routes || routes;
    gatewayDefaultModel = saved.defaultModel ?? gatewayDefaultModel;
    if (gatewayDefaultModelEl) gatewayDefaultModelEl.value = gatewayDefaultModel;
    refreshGatewayModelSelect();
    setSaveState("saved");
  } catch (err) {
    setSaveState("error", err.message || String(err));
  } finally {
    saveInFlight = false;
    if (pendingSave) flushAutosave();
  }
}

addBtn.addEventListener("click", addRoute);

entryList?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-copy]");
  if (!button) return;
  const key = button.dataset.copy;
  const url = ENTRY_URLS[key];
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    const prev = button.textContent;
    button.textContent = "已复制";
    setTimeout(() => {
      button.textContent = prev;
    }, 1200);
  } catch {
    window.prompt("复制以下地址：", url);
  }
});

if (gatewayClientKey) {
  gatewayClientKey.textContent = GATEWAY_CLIENT_KEY;
}

document.querySelector("[data-copy-key]")?.addEventListener("click", async (event) => {
  const el = event.currentTarget;
  try {
    await navigator.clipboard.writeText(GATEWAY_CLIENT_KEY);
    const prev = el.textContent;
    el.textContent = "已复制";
    setTimeout(() => {
      el.textContent = prev;
    }, 1200);
  } catch {
    window.prompt("复制以下密钥：", GATEWAY_CLIENT_KEY);
  }
});

gatewayDefaultModelEl?.addEventListener("change", () => {
  gatewayDefaultModel = gatewayDefaultModelEl.value;
  scheduleAutosave();
});

load();

function listAllModelIds() {
  const ids = new Set();
  for (const route of routes) {
    for (const model of route.models || []) {
      const id = String(model).trim();
      if (id) ids.add(id);
    }
  }
  return [...ids].sort();
}

function refreshGatewayModelSelect() {
  if (!gatewayDefaultModelEl) return;

  const current = (gatewayDefaultModelEl.value || gatewayDefaultModel || "").trim();
  const ids = listAllModelIds();
  if (current && !ids.includes(current)) ids.unshift(current);

  gatewayDefaultModelEl.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = ids.length ? "选择默认模型" : "请先配置渠道模型";
  gatewayDefaultModelEl.appendChild(placeholder);

  for (const id of ids) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    gatewayDefaultModelEl.appendChild(opt);
  }

  gatewayDefaultModelEl.value = current && ids.includes(current) ? current : "";
}

function routeKey(route, index) {
  return route.id || `__idx_${index}`;
}

function isRouteEditing(route, index) {
  return Boolean(route._isNew) || editingRouteKeys.has(routeKey(route, index));
}

function setRouteEditing(route, index, editing) {
  const key = routeKey(route, index);
  if (editing) editingRouteKeys.add(key);
  else {
    editingRouteKeys.delete(key);
    delete route._isNew;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderCardView(node, route) {
  node.querySelector('[data-role="nameView"]').textContent = route.name?.trim() || "未命名";
  node.querySelector('[data-view="baseUrl"]').textContent = route.baseUrl?.trim() || "—";
  node.querySelector('[data-view="apiKey"]').textContent = route.apiKey?.trim() || "—";

  const list = node.querySelector('[data-role="viewModels"]');
  const models = (route.models || []).map((m) => String(m).trim()).filter(Boolean);
  if (!models.length) {
    list.innerHTML = '<li class="view-models-empty">暂无模型</li>';
    return;
  }
  list.innerHTML = models
    .map(
      (model, idx) =>
        `<li class="view-model${idx === 0 ? " view-model--default" : ""}"><code class="mono">${escapeHtml(model)}</code>${idx === 0 ? '<span class="view-model-badge">默认</span>' : ""}</li>`,
    )
    .join("");
}

function syncFormFromRoute(node, route) {
  node.querySelector('[data-field="name"]').value = route.name || "";
  node.querySelector('[data-field="baseUrl"]').value = route.baseUrl || "";
  const apiKeyInput = node.querySelector('[data-field="apiKey"]');
  apiKeyInput.value = route.apiKey || "";
  apiKeyInput.placeholder = route.apiKey ? "已配置（留空保存则保留原密钥）" : "上游密钥";
}

function applyCardMode(node, route, index) {
  const editing = isRouteEditing(route, index);
  node.classList.toggle("card--editing", editing);
  if (editing) syncFormFromRoute(node, route);
  else renderCardView(node, route);
}

function addRoute() {
  const route = {
    id: nextProviderId(),
    name: "新渠道",
    type: "openai-chat",
    baseUrl: "",
    apiKey: "",
    enabled: true,
    defaultModel: "",
    models: [""],
    _isNew: true,
  };
  routes.push(route);
  editingRouteKeys.add(routeKey(route, routes.length - 1));
  render();
  routesEl.querySelector(".card:last-child [data-field='name']")?.focus();
}

async function load() {
  hydrating = true;
  clearTimeout(autosaveTimer);
  setSaveState("idle");

  let health = null;
  let config = null;

  try {
    health = await fetchJson("/health");
  } catch (err) {
    const needsAuth = /401|authentication|API key/i.test(String(err.message));
    setBaseStatus(
      needsAuth
        ? "需要统一 API Key：请在下方填写后重新打开页面"
        : `连接失败: ${err.message}（请确认已运行 npm start）`,
    );
    hydrating = false;
    render();
    return;
  }

  try {
    config = await fetchJson("/admin/routes");
  } catch (err) {
    const needsAuth = /401|authentication|API key/i.test(String(err.message));
    setBaseStatus(
      needsAuth
        ? "需要统一 API Key：请在下方填写后重新打开页面"
        : `读取渠道失败: ${err.message}`,
    );
    hydrating = false;
    render();
    return;
  }

  routes = Array.isArray(config.routes) ? config.routes : [];
  gatewayDefaultModel = config.defaultModel || health.defaultModel || "";
  if (gatewayDefaultModelEl) gatewayDefaultModelEl.value = gatewayDefaultModel;
  refreshGatewayModelSelect();
  applyPublicBase(health.publicBase);
  renderEntryUrls();
  const authHint = health.gatewayClientAuth?.required ? " · 网关鉴权已开启" : "";
  const hostHint = gatewayPublicOrigin ? ` · ${gatewayPublicOrigin}` : "";
  setBaseStatus(`运行中 · 共 ${routes.length} 个渠道 · 默认：${health.defaultModel || "-"}${hostHint}${authHint}`);
  hydrating = false;
  render();
}

function renderEntryUrls() {
  const origin = resolveGatewayOrigin();
  document.querySelector("#gatewayListenAddr")?.replaceChildren(document.createTextNode(origin));
  entryList?.querySelectorAll(".entry-url[data-entry]").forEach((el) => {
    const key = el.dataset.entry;
    el.textContent = ENTRY_URLS[key] || "";
  });
}

function render() {
  routesEl.innerHTML = "";

  if (!routes.length) {
    const empty = document.createElement("div");
    empty.className = "routes-empty";
    empty.innerHTML =
      "<strong>暂无渠道</strong>点击上方「添加渠道」新建，或检查 Gateway 是否在运行、访问密钥是否正确。";
    routesEl.appendChild(empty);
    return;
  }

  routes.forEach((route, index) => {
    const node = cloneTemplate(routeTemplate);
    bindRoute(node, route, index);
    routesEl.appendChild(node);
  });
  refreshGatewayModelSelect();
}

function bindRoute(node, route, index) {
  const onFieldEdit = () => {
    if (isRouteEditing(route, index)) scheduleAutosave();
  };

  const toggle = node.querySelector('[data-field="enabled"]');
  toggle.checked = route.enabled !== false;
  const syncDisabled = () => {
    node.classList.toggle("card--disabled", !toggle.checked);
  };
  syncDisabled();
  toggle.addEventListener("change", () => {
    route.enabled = toggle.checked;
    syncDisabled();
    scheduleAutosave();
    if (!isRouteEditing(route, index)) renderCardView(node, route);
  });

  const nameInput = node.querySelector('[data-field="name"]');
  const baseUrlInput = node.querySelector('[data-field="baseUrl"]');
  const apiKeyInput = node.querySelector('[data-field="apiKey"]');

  nameInput.addEventListener("input", () => {
    route.name = nameInput.value;
    onFieldEdit();
  });
  baseUrlInput.addEventListener("input", () => {
    route.baseUrl = baseUrlInput.value;
    onFieldEdit();
  });
  apiKeyInput.addEventListener("input", () => {
    route.apiKey = apiKeyInput.value;
    onFieldEdit();
  });

  route.type = "openai-chat";
  normalizeRouteModels(route);
  bindModels(node, route, onFieldEdit);

  node.querySelector('[data-action="edit"]').addEventListener("click", () => {
    setRouteEditing(route, index, true);
    applyCardMode(node, route, index);
    nameInput.focus();
  });

  node.querySelector('[data-action="save"]').addEventListener("click", async () => {
    route.name = nameInput.value;
    route.baseUrl = baseUrlInput.value;
    route.apiKey = apiKeyInput.value;
    syncDefaultModel(route);

    try {
      await flushAutosave();
      setRouteEditing(route, index, false);
      applyCardMode(node, route, index);
    } catch (err) {
      setSaveState("error", err.message || String(err));
    }
  });

  node.querySelector('[data-action="delete"]').addEventListener("click", () => {
    if (!confirm(`确定删除渠道「${route.name || "未命名"}」？`)) return;
    editingRouteKeys.delete(routeKey(route, index));
    routes.splice(index, 1);
    render();
    scheduleAutosave();
  });

  const testBtn = node.querySelector('[data-action="test"]');
  const testState = node.querySelector('[data-role="testState"]');
  testBtn.addEventListener("click", async () => {
    testState.textContent = "测试中…";
    testState.className = "card-message";
    testBtn.disabled = true;

    try {
      syncAllRoutesFromDom();
      const current = routes[index] || route;
      validateRouteForTest(current);
      const result = await fetchJson("/admin/test", {
        method: "POST",
        body: JSON.stringify({
          routeId: current.id,
          model: current.defaultModel || String(current.models?.[0] || "").trim(),
          baseUrl: (current.baseUrl || "").trim(),
          apiKey: (current.apiKey || "").trim(),
        }),
      });

      if (result.ok) {
        await flushAutosave();
        testState.textContent = `✓ 成功 · ${result.latencyMs}ms · ${result.reply || "已响应"} · 已保存`;
        testState.className = "card-message ok";
      } else {
        testState.textContent = `✗ ${result.error || "失败"}`;
        testState.className = "card-message error";
      }
    } catch (err) {
      testState.textContent = `✗ ${err.message}`;
      testState.className = "card-message error";
    } finally {
      testBtn.disabled = false;
    }
  });

  applyCardMode(node, route, index);
}

function syncDefaultModel(route) {
  route.defaultModel = String(route.models?.[0] ?? "").trim();
}

function normalizeRouteModels(route) {
  const models = [...(route.models || [])];
  if (!models.length) {
    route.models = [""];
    route.defaultModel = "";
    return;
  }
  const preferred = route.defaultModel || models.find((m) => String(m).trim()) || models[0];
  const rest = models.filter((m) => m !== preferred);
  route.models = [preferred, ...rest];
  syncDefaultModel(route);
}

function bindModels(node, route, onEdit) {
  const list = node.querySelector('[data-role="models"]');
  const addModelBtn = node.querySelector('[data-action="add-model"]');

  const draw = () => {
    list.innerHTML = "";
    if (!route.models?.length) {
      route.models = [""];
    }

    route.models.forEach((model, idx) => {
      const row = cloneTemplate(modelTemplate);
      const input = row.querySelector('[data-role="model-name"]');
      const removeBtn = row.querySelector('[data-action="remove-model"]');

      if (idx === 0) {
        row.classList.add("is-default");
        input.placeholder = "默认模型 ID";
      }

      input.value = model;
      input.addEventListener("input", () => {
        route.models[idx] = input.value;
        syncDefaultModel(route);
        onEdit();
      });

      removeBtn.addEventListener("click", () => {
        route.models.splice(idx, 1);
        if (!route.models.length) route.models.push("");
        syncDefaultModel(route);
        draw();
        onEdit();
      });

      list.appendChild(row);
    });
  };

  addModelBtn.addEventListener("click", () => {
    route.models = route.models || [];
    route.models.push("");
    draw();
    onEdit();
    list.querySelector(".model-cell:last-child .model-input")?.focus();
  });

  syncDefaultModel(route);
  draw();
}

function validateRouteForTest(route) {
  if (!route.name?.trim()) throw new Error("请先填写渠道名称");
  if (!route.baseUrl?.trim()) throw new Error("请先填写完整请求 URL");
  if (!route.apiKey?.trim()) throw new Error("请先填写 API Key");
  const model = route.defaultModel || route.models?.find(Boolean);
  if (!model?.trim()) throw new Error("请先填写第一个模型（即默认模型）");
}

async function persist() {
  const payload = {
    defaultModel: (gatewayDefaultModelEl?.value || gatewayDefaultModel || "").trim(),
    routes: routes.map((route) => {
      const models = (route.models || []).map((m) => m.trim()).filter(Boolean);
      const apiKey = (route.apiKey || "").trim();
      return {
        id: route.id || slug(route.name),
        name: route.name,
        type: route.type,
        baseUrl: route.baseUrl,
        apiKey: apiKey || "__KEEP__",
        enabled: route.enabled,
        models,
        defaultModel: models[0] || "",
      };
    }),
  };
  return fetchJson("/admin/routes", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

function authHeaders() {
  if (!GATEWAY_CLIENT_KEY) return {};
  return { Authorization: `Bearer ${GATEWAY_CLIENT_KEY}` };
}

async function fetchJson(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...authHeaders(),
    ...(options.headers || {}),
  };
  const response = await fetch(url, { ...options, headers });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = data.error?.message || data.error || text || `HTTP ${response.status}`;
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
