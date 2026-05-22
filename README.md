# Gateway

A lightweight local model gateway for routing Anthropic Messages and OpenAI Chat Completions style requests to configured upstream model providers.

The gateway exposes local endpoints on `127.0.0.1`, provides a small browser UI for managing model channels, and forwards requests to the exact upstream URL configured for each channel.

## Features

- Local HTTP endpoint: `http://127.0.0.1:7080`
- Local HTTPS endpoint: `https://127.0.0.1:7443`
- Anthropic-compatible entrypoint: `POST /v1/messages`
- **Primary OpenAI Chat Completions entrypoint:** `POST /v1/chat/completions`
- OpenAI-compatible aliases: `POST /v1`, `POST /v1/unified/chat`
- Model list endpoint: `GET /v1/models`
- Browser UI for adding, testing, enabling, and disabling channels
- Per-channel model routing through `models.json`
- Full upstream request URL support: the gateway does not append provider paths automatically

## Requirements

- Node.js 18 or newer
- A local TLS certificate if you want to use the HTTPS endpoint

No npm dependencies are required.

## Quick Start

Local startup always uses the project `models.json` by default, even if `.env.local` contains Zeabur-oriented hints such as `ZEABUR=1`, `NODE_ENV=production`, or `GATEWAY_DATA_DIR=/data`. This keeps local testing from accidentally writing to `/data/models.json`.

```bash
npm start
```

Then open:

```text
http://127.0.0.1:7080
```

The default ports can be changed with environment variables:

```bash
HTTP_PORT=7080 HTTPS_PORT=7443 npm start
```

Run the built-in checks before deploying:

```bash
npm run check
```

## Configuration

Runtime channel configuration is stored in `models.json`. This file may contain API keys and is intentionally ignored by Git.

Create it from the example:

```bash
cp models.example.json models.json
```

Top-level fields:

- `defaultModel`: **Gateway-wide default** — used when a client request omits `model` (configure in the admin UI under「Gateway 默认模型」)
- `routes`: array of provider channels

Each route should include:

- `name`: display name in the UI
- `type`: currently `openai-chat` for UI-created routes
- `baseUrl`: the full upstream request URL
- `apiKey`: upstream API key or bearer token
- `enabled`: whether the route is active
- `defaultModel`: default model for that channel (used for channel test; first model in the UI list)
- `models`: model IDs that should route to this provider

Example upstream URLs:

```text
https://integrate.api.nvidia.com/v1/chat/completions
http://127.0.0.1:1234/v1/chat/completions
https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
```

Important: `baseUrl` is treated as the final upstream request URL. The gateway does not append `/chat/completions`, `/messages`, or any other provider path.

## Agent integration (single API surface)

For other agents or OpenAI-compatible clients, standardize on **one URL** and **one request shape**:

- **Chat URL:** `POST http://127.0.0.1:7080/v1/chat/completions`
- **Body:** same as OpenAI Chat Completions (`model`, `messages`, optional `stream`, `temperature`, …)
- **Model list:** `GET http://127.0.0.1:7080/v1/models`

The `model` string must match a model configured under some enabled route in `models.json` (same IDs you see in the admin UI).
If `model` is omitted, Gateway uses the Gateway-wide default model. If a non-empty unknown `model` is sent, Gateway returns `400 unknown_model` and includes the configured model list.

Protocol rule:

- OpenAI-compatible clients use `/v1/chat/completions` and routes with type `openai-chat`.
- Anthropic-compatible clients use `/v1/messages` and routes with type `anthropic-messages`.
- Gateway routes by `model` inside the same protocol type. It does not silently convert `/v1/messages` requests into OpenAI upstream calls or OpenAI chat requests into Anthropic upstream calls.
- If a model is configured under the other protocol type, Gateway returns `400 protocol_mismatch` and tells you which endpoint to use.

### Hermes Desktop（保存路由后自动同步）

Hermes 桌面应用读的是 **`~/.hermes/models.json`**，不会自动发现网关。本仓库在 **管理页保存路由**（写入 `models.json`）成功后会 **异步运行** `npm run sync:hermes` 所用的脚本，把 `GET /v1/models` 的结果写回 Hermes（保留非 `127.0.0.1:<HTTP_PORT>/v1` 的其它预设）。保存后请 **⌘Q 退出再打开 Hermes** 以刷新列表。

- **关闭自动同步：** `HERMES_AUTO_SYNC=0 npm start`
- **手动同步：** `npm run sync:hermes`（网关需在运行；若启用 `GATEWAY_API_KEY`，请在 shell 里导出同名变量后再运行）

### One API key for all agents (optional)

Set a single shared key on the gateway process:

```bash
export GATEWAY_API_KEY="your-long-random-secret"
npm start
```

When `GATEWAY_API_KEY` is set, all clients must send the **same** value when calling `GET/POST` under `/v1/*`, `/health`, and `/admin/*`:

- `Authorization: Bearer <GATEWAY_API_KEY>`
- or header `x-api-key: <GATEWAY_API_KEY>`

Upstream provider keys still live only in `models.json`; agents **do not** need those keys.

Static assets (`/`, `/app.js`, `/styles.css`) stay unauthenticated so the admin page can load; use the **访问密钥** field in the UI (stored in the browser) to authorize admin and health requests.

On macOS LaunchAgents, add:

```xml
<key>EnvironmentVariables</key>
<dict>
  <key>GATEWAY_API_KEY</key>
  <string>your-long-random-secret</string>
</dict>
```

These paths behave the same as `/v1/chat/completions` for chat requests:

```text
POST http://127.0.0.1:7080/v1
POST http://127.0.0.1:7080/v1/unified/chat
```

Use `POST /v1/messages` only if the agent natively speaks Anthropic Messages.

## Local Entrypoints

```text
http://127.0.0.1:7080/v1/chat/completions
http://127.0.0.1:7080/v1/unified/chat
http://127.0.0.1:7080/v1/messages
http://127.0.0.1:7080/v1/models
```

The gateway chooses the upstream route by matching the requested model against configured route models.

## TLS Certificates

The HTTPS server reads:

```text
certs/localhost.crt
certs/localhost.key
```

For local development, you can generate a self-signed certificate:

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/localhost.key \
  -out certs/localhost.crt \
  -days 365 \
  -subj "/CN=localhost"
```

The private key is ignored by Git.

## Run At Login On macOS

This project can be run with a user LaunchAgent. A typical command is:

```bash
/opt/homebrew/bin/node /Users/griffith/Desktop/AI/gateway/server.mjs
```

Logs are written by the app to:

```text
gateway.log
gateway.err.log
```

These logs are ignored by Git.

## Deploy on Zeabur（公网）

Zeabur 会注入 `PORT`；容器内没有本地 TLS 证书时，Gateway 自动以 **HTTP、监听 `0.0.0.0`** 启动（无需改代码里的路径）。

在 Zeabur 服务 **环境变量** 中建议设置：

| 变量 | 示例 | 说明 |
|------|------|------|
| `PUBLIC_BASE` | `https://bahadir-api.zeabur.app` | 日志与文档用，可选 |
| `GATEWAY_API_KEY` | 长随机字符串 | **强烈建议**，防止公网被滥用 |
| `NVIDIA_API_KEY` | 你的上游 Key | 首次启动默认 NVIDIA 渠道会用 |
| `GATEWAY_HTTP_ONLY` | `1` | 可选；无证书时也会自动开启 |

启动命令保持 `npm start` 即可。

**网页里新增/修改的渠道会写入 `models.json`**（含 API Key，不进 Git）。云上默认路径为 **`/data/models.json`**（环境变量 `GATEWAY_DATA_DIR=/data`）。
本地开发默认仍写项目内 `models.json`；只有真实运行时环境变量或容器环境启用 `GATEWAY_HTTP_ONLY=1` / `ZEABUR=1` / `NODE_ENV=production` 时，才使用云端数据目录。

**Zeabur 方案 A（持久化卷，推荐）：** 详见 **[ZEABUR.md](./ZEABUR.md)**

1. 服务 → **Volumes** → **Mount Volumes** → 挂载目录 **`/data`**
2. Redeploy 后，在管理页填入各渠道上游 API Key 并保存
3. 以后 Redeploy / 推送代码 **不会**再丢渠道配置

未挂 `/data` 卷时，每次新容器都会从 `models.example.json` 重新生成，API Key 变回占位符。

给其它 AI 应用填写：

- **Base URL**：`https://你的域名.zeabur.app/v1`
- **API Key**：`GATEWAY_API_KEY`（若已设置）
- **模型名**：与管理页里一致

连接入口路径与本地相同。OpenAI 客户端走 `POST /v1/chat/completions`；Anthropic 客户端走 `POST /v1/messages`。管理页里的渠道「协议类型」要和客户端入口一致。

## Health and Troubleshooting

`GET /health` returns the active runtime and configuration state:

- `runtimeMode`: `local` or `cloud`
- `configFile` / `configFileLabel`: the actual route config file in use
- `configPersistent`: whether the current config path is intended to survive redeploys
- `enabledProviderCount` / `routeCount`: enabled channels and total channels
- `toolsMode`: `sanitize`, `strict`, or `strip`

Common checks:

```bash
npm run check
curl -H "Authorization: Bearer $GATEWAY_API_KEY" http://127.0.0.1:7080/health
```

## Security Notes

- Do not commit `models.json`; it can contain provider API keys.
- Do not commit `certs/localhost.key`.
- Local dev binds to `127.0.0.1`; cloud deploy (no TLS certs) binds to `0.0.0.0` — use `GATEWAY_API_KEY` on the public internet.
- Review upstream URLs carefully because the gateway forwards requests to the configured URL exactly.
