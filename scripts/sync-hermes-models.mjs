#!/usr/bin/env node
/**
 * 将本机 Gateway 的 GET /v1/models 同步到 Hermes 桌面读取的 ~/.hermes/models.json。
 * 桌面应用不会自动拉网关列表；重启 Hermes（⌘Q 后再开）后生效。
 *
 * 环境变量：
 *   GATEWAY_MODELS_URL   默认 http://127.0.0.1:7080/v1/models
 *   HERMES_GATEWAY_BASE    Hermes 里自定义端点的 base_url，默认 http://127.0.0.1:7080/v1
 *   GATEWAY_API_KEY        若网关启用了客户端鉴权则必填
 *   HERMES_HOME            默认 ~/.hermes
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const MODELS_URL = (process.env.GATEWAY_MODELS_URL || "http://127.0.0.1:7080/v1/models").trim();
const GATEWAY_BASE = (process.env.HERMES_GATEWAY_BASE || "http://127.0.0.1:7080/v1").trim().replace(/\/$/, "");
const API_KEY = (process.env.GATEWAY_API_KEY || "").trim();
const HOME = (process.env.HERMES_HOME || path.join(os.homedir(), ".hermes")).trim();
const TARGET = path.join(HOME, "models.json");

function normBase(u) {
  try {
    const x = new URL((u || "").trim());
    const host = x.hostname === "localhost" ? "127.0.0.1" : x.hostname;
    return `${x.protocol}//${host}:${x.port || (x.protocol === "https:" ? "443" : "80")}${x.pathname.replace(/\/$/, "")}`;
  } catch {
    return String(u || "")
      .trim()
      .replace(/\/$/, "");
  }
}

const gatewayNorm = normBase(GATEWAY_BASE + "/");

async function fetchGatewayIds() {
  const headers = { Accept: "application/json", "User-Agent": "gateway-sync-hermes-models/1.0" };
  if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
  const res = await fetch(MODELS_URL, { headers });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GET ${MODELS_URL} → ${res.status}: ${t.slice(0, 200)}`);
  }
  const body = await res.json();
  const rows = Array.isArray(body.data) ? body.data : [];
  const ids = [...new Set(rows.map((r) => String(r.id || "").trim()).filter(Boolean))];
  ids.sort();
  return ids;
}

function loadHermesModels() {
  try {
    const raw = fs.readFileSync(TARGET, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function main() {
  const ids = await fetchGatewayIds();
  const existing = loadHermesModels();

  const nonGateway = existing.filter((e) => normBase(e.baseUrl || "") !== gatewayNorm);

  const gatewayRows = ids.map((mid) => {
    const baseUrl = GATEWAY_BASE;
    const prev = existing.find((e) => String(e.model) === mid && normBase(e.baseUrl || "") === gatewayNorm);
    return {
      id: prev?.id || crypto.randomUUID(),
      name: mid,
      provider: "custom",
      model: mid,
      baseUrl,
      createdAt: prev?.createdAt || Date.now(),
    };
  });

  const merged = [...nonGateway, ...gatewayRows];
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(TARGET, `${JSON.stringify(merged, null, 2)}\n`, "utf8");

  console.log(`Gateway models: ${ids.length}`);
  console.log(`Hermes models.json: ${TARGET}`);
  console.log(`Kept non-gateway presets: ${nonGateway.length}`);
  console.log(`Gateway presets written: ${gatewayRows.length}`);
  console.log(`Total entries: ${merged.length}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
