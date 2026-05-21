# Zeabur 持久化配置（方案 A）

网页里保存的渠道和 **上游 API Key** 写在 **`/data/models.json`**。  
**必须**在 Zeabur 挂载持久化卷，否则每次 Redeploy 都会变成新容器，配置会丢。

## 一次性设置

1. 打开 [Zeabur 控制台](https://zeabur.com) → 你的项目 → **Gateway 服务**
2. 顶部点 **Volumes**
3. 点 **Mount Volumes**
4. 填写：
   - **Volume ID**：`gateway-data`（任意名称即可）
   - **Mount Directory**：`/data`（必须与此一致）
5. 确认挂载（Zeabur 可能会清空该目录下原有文件）
6. **Redeploy** 一次服务

## 环境变量（建议保留）

```env
GATEWAY_DATA_DIR=/data
PUBLIC_BASE=https://你的域名.zeabur.app
GATEWAY_API_KEY=你的统一密钥
```

## 挂载完成后

1. 打开管理页 `https://你的域名/`
2. 各渠道 **编辑** → 填入真实 **上游 API Key** → **保存** / **测试**
3. 以后只 Redeploy **不会**再丢 Key

## 如何确认生效

Redeploy 后打开：

```text
https://你的域名/health
```

请求头带：`Authorization: Bearer 你的GATEWAY_API_KEY`

若 `configFile` 为 `/data/models.json`，且你在网页保存后再次 Redeploy，渠道 Key 仍在，说明卷已生效。

## 网页对话项目（tools / 函数调用）

Gateway **默认会转发合法的 tools**（每个工具必须有 `function.name`），并自动去掉没有名称的空占位符。

默认会**去掉没有 name 的空占位符**并继续聊天；只有配置了 `GATEWAY_STRICT_TOOLS=1` 才会直接 400。

若 Zeabur 日志里出现 `dropped N tool(s) without function.name`，说明对话网页发了空工具壳，需要在**对话项目里给每个工具填好名称**，格式示例：

```json
{
  "type": "function",
  "function": {
    "name": "search_web",
    "description": "搜索网页",
    "parameters": { "type": "object", "properties": { "q": { "type": "string" } } }
  }
}
```

仅当旧客户端无法改、又只想先能聊天时，可临时加（会**完全禁用** tools）：

```env
GATEWAY_STRIP_TOOLS=1
```

## 浏览器项目接 API（CORS）

若前端报 **`Failed to fetch`**，在环境变量加（或保持默认）：

```env
CORS_ORIGIN=*
```

默认已允许所有来源。Redeploy 后生效。

## 注意

- **统一 API Key**（`GATEWAY_API_KEY`）在环境变量里，本来就不会因 Redeploy 丢失
- 丢的是 **NVIDIA / Google 等上游 Key**，靠 `/data` 卷保留
- 启用卷后，Zeabur 可能无法零停机重启，会有短暂中断
