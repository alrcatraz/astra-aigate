<div align="center">

# astra-aigate — Unified AI Service Gateway

One web UI to configure, monitor and route **LLM providers**, **MCP servers** and **auxiliary services**.

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
2. **MCP Servers** — MCP server registration, tool aggregation and connectivity checks
3. **Auxiliary Services** — health monitoring and reverse proxying for non-MCP tools (Camofox, SearXNG, etc.)

It is an **independent project** (not a GitHub fork), seeded from [OmniRoute](https://github.com/diegosouzapw/OmniRoute) (MIT) and evolving its own identity: Expo design language, Next.js 16 + React 19 frontend, British English locale, zh-CN/zh-TW translations.

## Features

- **Expo design language** — luminous monochrome UI with pure-black (#000000) primary actions
- **Data-driven sidebar** — `sections.ts` is the single source of truth for navigation; collapsible sub-groups (Routing & Access, Combos); redundant redirect stubs removed
- **Independent scrolling** — fixed-height layout with sidebar-internal and main-content scroll reset on route change
- **i18n** — English (British), zh-CN, zh-TW; language switcher in Settings > Appearance and docs layout
- **Podman deployment** — multi-stage standalone build, no Turbopack (webpack-only)

## Quick Start

```bash
# Run the prebuilt image on the target host:
podman run -d --name astra-aigate --env-file .env -p <port>:20128 localhost/astra-aigate:latest
# Open http://<host>:<port> — first login uses INITIAL_PASSWORD from .env
```

## Tech Stack

| Layer         | Choice                                                  |
| ------------- | ------------------------------------------------------- |
| Runtime       | Node.js 26 (container, trixie)                          |
| Database      | SQLite via better-sqlite3                               |
| API framework | Fastify (carried from OmniRoute)                        |
| Frontend      | Next.js 16 (App Router) + React 19 + Expo design tokens |
| i18n          | next-intl (messages bundled at build time)              |
| Auth          | Password + API keys (JWT)                               |
| Deployment    | Podman multi-stage standalone build                     |

## Project Layout

```
src/shared/constants/sidebarVisibility/sections.ts  # single nav data source
src/shared/components/Sidebar.tsx                   # sidebar (collapsible sub-groups)
src/shared/components/layouts/DashboardLayout.tsx   # fixed-height layout + scroll reset
src/i18n/messages/{en,zh-CN,zh-TW}.json             # locales (British English)
scripts/test/regression-final.mjs                   # Playwright regression suite
```

## Usage

```bash
# Route an LLM request through a provider combo (fallback built in):
curl http://<host>:<port>/v1/chat/completions \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"<combo-name>","messages":[{"role":"user","content":"Hello"}]}'

# Aggregate MCP tools across registered servers:
curl http://<host>:<port>/mcp \
  -H "Authorization: Bearer <api-key>" \
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
2. **MCP 服务器** — MCP 服务器注册、工具聚合和连通性检查
3. **辅助服务** — 非 MCP 工具（Camofox、SearXNG 等）的健康监控和反向代理

本项目是**独立项目**（非 GitHub fork），种子代码来自 [OmniRoute](https://github.com/diegosouzapw/OmniRoute)（MIT），正在形成自己的身份：以 Expo 设计语言，Next.js 16 + React 19 前端，英式英语 locale，zh-CN/zh-TW 翻译。

## 特性

- **Expo 设计语言** — 明亮单色 UI，纯黑（#000000）主按钮
- **数据驱动侧边栏** — `sections.ts` 是导航的唯一数据源；可折叠子分组（Routing & Access、Combos）；清除纯重定向冗余项
- **独立滚动** — 固定高度布局，侧边栏内部滚动 + 路由切换时主内容滚动归零
- **i18n** — 英语（英式）、zh-CN、zh-TW；Settings > Appearance 和 docs 布局中有语言切换器
- **Podman 部署** — 多阶段 standalone 构建，仅 webpack（禁用 Turbopack）

## 快速开始

```bash
# 在目标主机上运行预构建镜像：
podman run -d --name astra-aigate --env-file .env -p <port>:20128 localhost/astra-aigate:latest
# 打开 http://<host>:<port> — 首次登录使用 .env 中的 INITIAL_PASSWORD
```

## 技术栈

| 层       | 选型                                               |
| -------- | -------------------------------------------------- |
| 运行时   | Node.js 26（容器，trixie）                         |
| 数据库   | SQLite via better-sqlite3                          |
| API 框架 | Fastify（继承自 OmniRoute）                        |
| 前端     | Next.js 16（App Router）+ React 19 + Expo 设计令牌 |
| i18n     | next-intl（messages 构建时打包）                   |
| 认证     | 密码 + API 密钥（JWT）                             |
| 部署     | Podman 多阶段 standalone 构建                      |

## 项目结构

```
src/shared/constants/sidebarVisibility/sections.ts  # 导航唯一数据源
src/shared/components/Sidebar.tsx                   # 侧边栏（可折叠子分组）
src/shared/components/layouts/DashboardLayout.tsx   # 固定高度布局 + 滚动重置
src/i18n/messages/{en,zh-CN,zh-TW}.json             # locale（英式英语）
scripts/test/regression-final.mjs                   # Playwright 回归套件
```

## 用法

```bash
# 通过提供商组合路由 LLM 请求（内置故障转移）：
curl http://<host>:<port>/v1/chat/completions \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"<combo-name>","messages":[{"role":"user","content":"你好"}]}'

# 跨已注册服务器聚合 MCP 工具：
curl http://<host>:<port>/mcp \
  -H "Authorization: Bearer <api-key>" \
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
