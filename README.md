<div align="center">

# astra-aigate — Unified AI Service Gateway

One web UI to configure, monitor and route **LLM providers** (290), **MCP servers** and **auxiliary services**.

<div align="center">

[![License](https://badgen.net/github/license/alrcatraz/astra-aigate)](https://github.com/alrcatraz/astra-aigate/blob/main/LICENSE)
[![Stars](https://badgen.net/github/stars/alrcatraz/astra-aigate)](https://github.com/alrcatraz/astra-aigate)
[![Last commit](https://badgen.net/github/last-commit/alrcatraz/astra-aigate)](https://github.com/alrcatraz/astra-aigate)
[![Star history](https://api.star-history.com/svg?repos=alrcatraz/astra-aigate&type=Date)](https://star-history.com/#alrcatraz/astra-aigate&Date)

</div>

</div>

## Overview

astra-aigate is a self-hosted AI gateway console managing three categories of services:

1. **LLM Providers** — provider management, combo routing and fallback (carried from OmniRoute)
2. **MCP Servers** — MCP gateway host: one server exposing multiple MCP
   endpoints (registered self-hosted MCPs)
3. **Auxiliary Services** — health monitoring and reverse proxying for non-MCP tools (Camofox, SearXNG, etc.)

Built on [OmniRoute](https://github.com/diegosouzapw/OmniRoute) (MIT): LLM provider management, combo routing and fallback, and the API-key auth model are inherited from it; the frontend (Expo design language, Next.js 16 + React 19), the MCP gateway and the auxiliary-service layer are original work. See [Credits](#credits) for the complete list of upstream projects.

## Features

- **Expo design language** — luminous monochrome UI with pure-black (#000000) primary actions
- **Data-driven sidebar** — `sections.ts` is the single source of truth for navigation; collapsible sub-groups (Routing & Access, Combos); media-providers entry; no redundant redirect stubs
- **Independent scrolling** — fixed-height layout with sidebar-internal scrolling and main-content scroll resets on route change
- **i18n** — 43 locales (English (British), zh-CN, zh-TW, and 40 more); language switcher in Settings > Appearance and docs layout
- **Pluggable database** — SQLite by default (zero-ops), optional PostgreSQL via `DB_DRIVER=postgres`; unified async `DatabaseAdapter` interface with a dialect translation layer
- **Podman deployment** — multi-stage standalone build, no Turbopack (webpack-only)

## Quick Start

```bash
# Pull the published image from GHCR (tagged releases, e.g. v0.4.0):
podman pull ghcr.io/alrcatraz/astra-aigate:latest
# Run it on the target host (IPv4 only):
podman run -d --name astra-aigate --env-file .env -p <port>:20128 ghcr.io/alrcatraz/astra-aigate:latest
# Open http://<host>:<port> — first login uses INITIAL_PASSWORD from .env
```

Images are built automatically by GitHub Actions (`build-image.yml`) on release
tags (`v*` → `:vX.Y.Z` + `:latest`) and `development` pushes (`:development`);
a local build with the multi-stage Dockerfile is equivalent.

If you use a dual-stack network (IPv4/IPv6), or expose the gateway as a
public service, add dual-stack support with the following guidance. The
gateway itself is dual-stack ready, but rootless Podman's `pasta` port
forwarding binds IPv4 only. If a hostname resolves to both A and AAAA records
and a client prefers IPv6 (e.g. a ULA `fd..` address on your LAN), connections
to the published port can hang or return empty responses — the IPv6 listener
simply does not exist:

1. **Publish v4 explicitly** and rely on Happy Eyeballs for v6 clients to fall
   back: `podman run -p 0.0.0.0:20128:20128 ...` (pasta already binds v4 only —
   the risk is on clients that resolve v6 first and do not retry).
2. **Front with a reverse proxy** (nginx / Caddy / Camofox): terminate TLS on
   a dual-stack listener and proxy to `127.0.0.1:20128` (or the container's
   published v4 port). One stable hostname, working v4 + v6.
3. **Verify both stacks after deploy**: `curl -6 https://<host>/v1/models` and
   `curl -4 https://<host>/v1/models` must both return 200. If only v4 works,
   check the proxy listener, not the gateway.
4. **Container-to-host traffic** uses `host.containers.internal` (rootless
   Podman cannot reach the host IP directly) — this resolves to the host's v4
   address; do not rely on IPv6 for upstream services.

### PostgreSQL (optional)

Set `DB_DRIVER=postgres` and `DATABASE_URL` in `.env` to back the gateway
with PostgreSQL instead of SQLite. The schema is created automatically on a
fresh database; migrate an existing SQLite deployment with
`scripts/migrate-sqlite-to-pg.ts`. In containers, reach the host database via
`host.containers.internal` (see the dual-stack note above).

> **PG mode status (Aug 2026):** PostgreSQL is a production-verified path, not
> experimental. All management pages and the quota/analytics/gamification
> surfaces have been regression-tested under `DB_DRIVER=postgres` with
> Playwright (95 pages scanned; the management surface is clean). The sole
> caveat is live-dashboard WebSocket (`LIVE_WS_PORT`) which is served on a
> separate port that must be exposed in the container for `combos/live` and
> `compression/live`. SQLite remains the zero-ops default.

## Tech Stack

| Layer         | Choice                                                                            |
| ------------- | --------------------------------------------------------------------------------- |
| Runtime       | Node.js 26 (container, trixie)                                                    |
| Database      | SQLite via better-sqlite3 (default) / PostgreSQL (optional, `DB_DRIVER=postgres`) |
| API framework | Fastify (carried from OmniRoute)                                                  |
| Frontend      | Next.js 16 (App Router) + React 19 + Expo design tokens                           |
| i18n          | next-intl (messages bundled at build time)                                        |
| Auth          | Password + API keys (JWT)                                                         |
| Deployment    | Podman multi-stage standalone build                                               |

## Project Layout

```
src/shared/constants/sidebarVisibility/sections.ts  # single nav data source
src/shared/components/Sidebar.tsx                   # sidebar (collapsible sub-groups)
src/shared/components/layouts/DashboardLayout.tsx   # fixed-height layout + scroll reset
src/i18n/messages/*.json                        # 43 locales (British English base)
scripts/test/regression-final.mjs                   # Playwright regression suite
```

## Usage

```bash
# Route an LLM request through a provider combo (fallback built in):
curl http://<host>:<port>/v1/chat/completions \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"<combo-name>","messages":[{"role":"user","content":"Hello"}]}'

# Call a registered MCP endpoint (gateway mode — one server, many endpoints):
# /api/mcp/servers/<id>/sse (SSE transport) or /stream (streamable HTTP)
curl http://<host>:<port>/api/mcp/servers/aigate-omniroute/stream \
  -H "Authorization: Bearer ***" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Full configuration reference lives in `.env.example`; the web dashboard
(Providers / Combos / MCP / Services) covers day-to-day management.

## Documentation

- `AGENTS.md` — project context for AI agents
- `DESIGN.md` — Expo design system specification
- `docs/` — operational references (incident response, performance budgets)

## Credits

This project builds on the following open-source work:

- **[OmniRoute](https://github.com/diegosouzapw/omniroute)** (MIT) — the unified AI service gateway this project was seeded from; upstream attribution is retained in the source tree.
- **[awesome-design-md](https://github.com/voltagent/awesome-design-md)** — source of the design-spec template used for [`DESIGN.md`](DESIGN.md).
- **Expo** — the visual design language (bright airy canvas, pill-shaped geometry) our UI shell is based on.

## Licence

MIT. Seeded from [OmniRoute](https://github.com/diegosouzapw/OmniRoute) (MIT) — upstream attribution retained in the source tree.

---

# astra-aigate（中文版）

<div align="center">

# astra-aigate — 统一 AI 服务网关

一个 Web 界面统一配置、监控和路由 **LLM 提供商**、**MCP 服务器**和**辅助服务**。

</div>

## 概述

astra-aigate 是一个自托管的 AI 网关控制台，管理三类服务：

1. **LLM 提供商** — 提供商管理、组合路由和故障转移（继承自 OmniRoute）
2. **MCP 服务器** — MCP 网关宿主：一个服务端暴露多个 MCP 端点，登记
   自部署 MCP（本机 stdio + 远端 HTTP/SSE）
3. **辅助服务** — 非 MCP 工具（Camofox、SearXNG 等）的健康监控和反向代理

本项目基于 [OmniRoute](https://github.com/diegosouzapw/OmniRoute)（MIT）构建：LLM 提供商管理、组合路由与故障转移、API 密钥认证模型均继承自它；前端（Expo 设计语言、Next.js 16 + React 19）、MCP 网关与辅助服务层为原创。完整上游项目列表见[致谢](#致谢)。

## 特性

- **Expo 设计语言** — 明亮单色 UI，纯黑（#000000）主按钮
- **数据驱动侧边栏** — `sections.ts` 是导航的唯一数据源；可折叠子分组（Routing & Access、Combos）；media-providers 入口；无纯重定向冗余项
- **独立滚动** — 固定高度布局，侧边栏内部滚动 + 路由切换时主内容滚动归零
- **i18n** — 43 个 locale（英语（英式）、zh-CN、zh-TW 及另外 40 种）；Settings > Appearance 和 docs 布局中有语言切换器
- **可插拔数据库** — 默认 SQLite（零运维），可选 PostgreSQL（`DB_DRIVER=postgres`）；统一异步 `DatabaseAdapter` 接口 + 方言翻译层
- **Podman 部署** — 多阶段 standalone 构建，仅 webpack（禁用 Turbopack）

## 快速开始

```bash
# 在目标主机上运行预构建镜像（仅 IPv4）：
podman run -d --name astra-aigate --env-file .env -p <port>:20128 localhost/astra-aigate:latest
# 打开 http://<host>:<port> — 首次登录使用 .env 中的 INITIAL_PASSWORD
```

如果你使用双栈网络（IPv4/IPv6），或作为公开服务提供，则可以参考以下命令
实现双栈网络支持。网关本身支持双栈，但 rootless Podman 的 pasta 端口转发
仅绑定 IPv4。如果主机名同时解析出 A 和 AAAA 记录，而客户端优先使用 IPv6
（例如局域网中的 ULA `fd..` 地址），对已发布端口的连接可能挂起或返回空
响应——IPv6 监听根本不存在：

1. **显式发布 v4**，依靠 Happy Eyeballs 让 v6 客户端回退：
   `podman run -p 0.0.0.0:20128:20128 ...`（pasta 本就只绑 v4——风险在
   客户端先解析 v6 且不重试）。
2. **前置反向代理**（nginx / Caddy / Camofox）：在双栈监听器上终止 TLS，
   代理到 `127.0.0.1:20128`（或容器已发布的 v4 端口）。一个稳定主机名，
   v4 + v6 同时可用。
3. **部署后验证双栈**：`curl -6 https://<host>/v1/models` 与
   `curl -4 https://<host>/v1/models` 都必须返回 200。只有 v4 通时，检查
   代理监听器而非网关。
4. **容器到宿主流量** 使用 `host.containers.internal`（rootless Podman
   无法直连宿主 IP）——它解析为宿主的 v4 地址；上游服务不要依赖 IPv6。

### PostgreSQL（可选）

在 `.env` 中设置 `DB_DRIVER=postgres` 和 `DATABASE_URL`，即可用 PostgreSQL
替代 SQLite 作为网关存储。新库自动建表；迁移现有 SQLite 数据用
`scripts/migrate-sqlite-to-pg.ts`。容器内访问宿主数据库须用
`host.containers.internal`（见上文双栈说明）。

> **PG 模式状态（2026-08）：** PostgreSQL 已是生产验证通路而非实验。整个管理面
> 与 quota/analytics/gamification 页面均在 `DB_DRIVER=postgres` 下用 Playwright
> 做过 95 页回归，管理面干净。唯一注意点：live-dashboard WebSocket
> （`LIVE_WS_PORT`）跑在独立端口上，容器需额外暴露该端口 `combos/live` 与
> `compression/live` 才能用。SQLite 仍是零运维默认。

## 技术栈

| 层       | 选型                                                                        |
| -------- | --------------------------------------------------------------------------- |
| 运行时   | Node.js 26（容器，trixie）                                                  |
| 数据库   | SQLite via better-sqlite3（默认）/ PostgreSQL（可选，`DB_DRIVER=postgres`） |
| API 框架 | Fastify（继承自 OmniRoute）                                                 |
| 前端     | Next.js 16（App Router）+ React 19 + Expo 设计令牌                          |
| i18n     | next-intl（messages 构建时打包）                                            |
| 认证     | 密码 + API 密钥（JWT）                                                      |
| 部署     | Podman 多阶段 standalone 构建                                               |

## 项目结构

```
src/shared/constants/sidebarVisibility/sections.ts  # 导航唯一数据源
src/shared/components/Sidebar.tsx                   # 侧边栏（可折叠子分组）
src/shared/components/layouts/DashboardLayout.tsx   # 固定高度布局 + 滚动重置
src/i18n/messages/*.json                        # 43 个 locale（英式英语为基准）
scripts/test/regression-final.mjs                   # Playwright 回归套件
```

## 用法

```bash
# 通过提供商组合路由 LLM 请求（内置故障转移）：
curl http://<host>:<port>/v1/chat/completions \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"<combo-name>","messages":[{"role":"user","content":"你好"}]}'

# 调用已登记的 MCP 端点（网关模式——一个服务端、多个端点）：
# /api/mcp/servers/<id>/sse（SSE 传输）或 /stream（Streamable HTTP）
curl http://<host>:<port>/api/mcp/servers/aigate-omniroute/stream \
  -H "Authorization: Bearer ***" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

完整配置参考见 `.env.example`；日常管理由 Web 控制台
（Providers / Combos / MCP / Services）覆盖。

## 文档

- `AGENTS.md` — AI 代理项目上下文
- `DESIGN.md` — Expo 设计系统规范
- `docs/` — 运维参考（事件响应、性能预算）

## 致谢

本项目基于以下开源成果：

- **[OmniRoute](https://github.com/diegosouzapw/omniroute)**（MIT）—— 本项目的种子来源（统一 AI 服务网关）；上游署名保留在源码树中。
- **[awesome-design-md](https://github.com/voltagent/awesome-design-md)** —— [`DESIGN.md`](DESIGN.md) 设计规范模板的来源。
- **Expo** —— UI 外壳所采用的视觉设计语言（明亮通透的画布、胶囊形几何）。

## 许可证

MIT。种子代码来自 [OmniRoute](https://github.com/diegosouzapw/OmniRoute)（MIT）——上游署名保留在源码树中。
