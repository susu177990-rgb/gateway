# Gateway

A lightweight local model gateway for routing Anthropic Messages and OpenAI Chat Completions style requests to configured upstream model providers.

The gateway exposes local endpoints on `127.0.0.1`, provides a small browser UI for managing model channels, and forwards requests to the exact upstream URL configured for each channel.

## Features

- Local HTTP endpoint: `http://127.0.0.1:7080`
- Local HTTPS endpoint: `https://127.0.0.1:7443`
- Anthropic-compatible entrypoint: `POST /v1/messages`
- OpenAI-compatible entrypoint: `POST /v1/chat/completions`
- Model list endpoint: `GET /v1/models`
- Browser UI for adding, testing, enabling, and disabling channels
- Per-channel model routing through `models.json`
- Full upstream request URL support: the gateway does not append provider paths automatically

## Requirements

- Node.js 18 or newer
- A local TLS certificate if you want to use the HTTPS endpoint

No npm dependencies are required.

## Quick Start

```bash
npm start
```

Then open:

```text
http://127.0.0.1:7080
```

The default ports can be changed with environment variables:

```bash
PORT=7443 HTTP_PORT=7080 npm start
```

## Configuration

Runtime channel configuration is stored in `models.json`. This file may contain API keys and is intentionally ignored by Git.

Create it from the example:

```bash
cp models.example.json models.json
```

Each route should include:

- `name`: display name in the UI
- `type`: currently `openai-chat` for UI-created routes
- `baseUrl`: the full upstream request URL
- `apiKey`: upstream API key or bearer token
- `enabled`: whether the route is active
- `defaultModel`: default model for that route
- `models`: model IDs that should route to this provider

Example upstream URLs:

```text
https://integrate.api.nvidia.com/v1/chat/completions
http://127.0.0.1:1234/v1/chat/completions
https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
```

Important: `baseUrl` is treated as the final upstream request URL. The gateway does not append `/chat/completions`, `/messages`, or any other provider path.

## Local Entrypoints

Use these URLs from local clients:

```text
http://127.0.0.1:7080/v1/messages
http://127.0.0.1:7080/v1/chat/completions
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

## Security Notes

- Do not commit `models.json`; it can contain provider API keys.
- Do not commit `certs/localhost.key`.
- Keep the service bound to `127.0.0.1` unless you intentionally want network exposure.
- Review upstream URLs carefully because the gateway forwards requests to the configured URL exactly.
