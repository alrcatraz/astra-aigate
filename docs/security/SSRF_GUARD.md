---
title: "Outbound SSRF Guard (Provider Endpoints)"
version: 3.8.40
lastUpdated: 2026-08-01
---

# Outbound SSRF Guard (Provider Endpoints)

> **Block server-side request forgery at the provider-validation boundary — local-first by default, with explicit opt-ins for private/LAN endpoints and cloud-metadata always blocked.**

> **Source of truth:** `src/shared/network/outboundUrlGuard.ts`, `src/shared/network/outboundUrlGuardPolicy.ts`, `src/shared/constants/featureFlagDefinitions.ts` (`OUTBOUND_SSRF_GUARD_ENABLED`), `src/lib/audit/highLevelActions.ts` (`provider.validation.ssrf_blocked`)

OmniRoute validates and calls provider endpoints server-side. A malicious or compromised provider URL could otherwise be pointed at internal infrastructure (`169.254.169.254` cloud metadata, `172.16/12` Docker bridges, `::1` loopback, LAN hosts) — the classic SSRF → IAM-credential pivot. The outbound URL guard runs on the provider validation/use path and rejects such targets unless explicitly allowed.

---

## Table of Contents

- [The Three Switches](#the-three-switches)
- [Resolution Precedence](#resolution-precedence)
- [Default Behaviour (Local-First)](#default-behaviour-local-first)
- [Allowing Internal Provider Endpoints](#allowing-internal-provider-endpoints)
- [What Stays Blocked Regardless](#what-stays-blocked-regardless)
- [Audit Events](#audit-events)
- [Related Documentation](#related-documentation)

---

## The Three Switches

| Switch                                  | Scope          | Default | Meaning                                                                                                                                                                                              |
| --------------------------------------- | -------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OUTBOUND_SSRF_GUARD_ENABLED`           | Global guard   | `true`  | Master switch. Set to `false`/`0`/`no`/`off` to disable the guard entirely (legacy escape hatch — also implies private URLs are allowed).                                                            |
| `OMNIROUTE_ALLOW_PRIVATE_PROVIDER_URLS` | Private/LAN    | `false` | Allows provider endpoints on private (RFC 1918) addresses. DB-backed: the dashboard toggle **"Allow Private Provider URLs"** takes precedence over env; env only matters pre-boot (headless/Docker). |
| `OMNIROUTE_ALLOW_LOCAL_PROVIDER_URLS`   | Loopback/local | `true`  | Allows provider endpoints on loopback (`127.0.0.1`, `localhost`, `::1`). DB-backed with env fallback. OmniRoute is local-first: local OpenAI-compatible providers validate out of the box.           |

## Resolution Precedence

For the private/LAN switch (`arePrivateProviderUrlsAllowed`):

1. **DB feature-flag override** — an explicit dashboard toggle wins over anything else (critical for the Electron build, where the env value is captured at boot and later UI toggles would otherwise be masked).
2. **Explicit env opt-in** — `OMNIROUTE_ALLOW_PRIVATE_PROVIDER_URLS=1` for headless/Docker deployments set before boot.
3. **Legacy escape hatch** — `OUTBOUND_SSRF_GUARD_ENABLED=false` implies private URLs allowed.

For the local/loopback switch (`areLocalProviderUrlsAllowed`): DB flag first, then env, then **default ON**.

The resulting guard mode (`getProviderOutboundGuard`) is either `"none"` (checks disabled — power users) or `"public-only"` (block private + loopback targets, allow public hosts).

## Default Behaviour (Local-First)

With no configuration, OmniRoute:

- ✅ Allows provider endpoints on loopback (`127.0.0.1`, `localhost`, `::1`) — local-first.
- ✅ Allows public provider endpoints (OpenAI, Anthropic, SiliconFlow, …).
- ❌ Blocks private RFC 1918 / CGNAT (`172.16/12`, `10/8`, `192.168/16`, `100.64/10`) and cloud-metadata endpoints.

## Allowing Internal Provider Endpoints

**Local (same host) endpoints — no action needed.** Loopback is allowed by default.

**Private/LAN endpoints** (e.g. `http://192.168.0.10:11434/v1`, or an internal gateway on `10.20.x.x`):

1. Dashboard → **Settings → "Allow Private Provider URLs"** toggle (persisted in DB, survives restarts), **or**
2. Env for headless/Docker: `OMNIROUTE_ALLOW_PRIVATE_PROVIDER_URLS=1` in the container environment.

Example Docker env:

```yaml
# docker-compose.yml — self-hosted OmniRoute reaching an internal gateway
services:
  omniroute:
    environment:
      - OMNIROUTE_ALLOW_PRIVATE_PROVIDER_URLS=1
```

The guard then validates internal endpoints while still enforcing credential hygiene (URL-embedded credentials are rejected by `parseOutboundUrl`).

## What Stays Blocked Regardless

- **Cloud-metadata endpoints** (`169.254.169.254`, AWS/GCP/Azure IMDS) — the SSRF → IAM-credential pivot, never a legitimate provider endpoint. Blocked even when the private opt-in is enabled.
- **Credentials embedded in URLs** (`http://user:pass@host`) — rejected to prevent credential leakage via SSRF redirects (`localHealthCheck` enforces the same rule).

## Audit Events

Blocked attempts emit `provider.validation.ssrf_blocked` (see `src/lib/audit/highLevelActions.ts`), surfaced in the dashboard activity log as **"Provider SSRF blocked"** (`activityIcons.ts`).

## Related Documentation

- [Egress IP Family Policy](EGRESS_POLICY.md) — pinning outbound traffic to IPv4/IPv6.
- [Route Guard Tiers](ROUTE_GUARD_TIERS.md) — which request classes require what authentication.
- [CORS Policy](CORS.md) — browser-origin enforcement for the same API surface.
