# Delivery: Camofox service-proxy duplex fix + auth hardening

**Delivered by:** Angelia (camofox merge session) — **code change only.**
This project (astra-aigate) is responsible for rebuilding + verifying it;
the camofox side is already built, deployed, and validated.

## Why

Hermes routes its browser tools through Camofox (via `CAMOFOX_URL`).
The plan is for that path to go through **this** project's unified service
gateway (`/api/svc/camofox/*`) so Hermes only carries one AI Gate key and the
Camofox access key never leaves this gateway.

While testing that reverse-proxy path end-to-end, every **POST/PUT/PATCH**
failed at the gateway:

```
{"error":"Gateway upstream error: SafeOutboundFetchError:
 RequestInit: duplex option is required when sending a body."}
```

Root cause: `safeOutboundFetch` forwards `request.body` (a stream) and
Node's `fetch` requires `duplex: "half"` on any request with a stream body.
GET/HEAD (no body) worked; all body-carrying methods failed.

## Change 1 — duplex fix (already committed to the working tree)

File: `src/app/api/svc/[id]/[[...path]]/route.ts`

```diff
   let upstream: Response;
   try {
-    upstream = await safeOutboundFetch(target.url, {
-      method: request.method,
-      headers,
-      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
+    const requestBody = ["GET", "HEAD"].includes(request.method)
+      ? undefined
+      : request.body;
+    upstream = await safeOutboundFetch(target.url, {
+      method: request.method,
+      headers,
+      body: requestBody,
+      // Node's fetch requires `duplex: "half"` when forwarding a stream body —
+      // without it, every POST/PUT/PATCH via the service proxy fails with
+      // "RequestInit: duplex option is required when sending a body."
+      ...(requestBody ? { duplex: "half" } : {}),
       timeoutMs: 30_000,
       allowRedirect: false,
       retry: false,
```

Esbuild-diagnosed clean. No type error introduced.

## Change 2 — services row for camofox (db config, via API not SQL)

The `services` table currently has:

```
id=camofox  auth_type=none  required_scope=NULL  upstream=http://127.0.0.1:9377
```

It is **public today** (anyone reaching `/api/svc/camofox/*` with no key can
drive the browser). Harden it. `auth_secret` is stored encrypted
(`lib/db/services.ts` → `encrypt()`), so **do not** write it via SQL — use the
PATCH API (manage-auth / admin session):

```bash
# CAMOFOX_ACCESS_KEY: the key baked into the camofox-browser prod container
curl -X PATCH "$AIGATE/api/services/camofox" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $AIGATE_ADMIN_KEY" \
  -d '{
        "auth_type": "bearer",
        "auth_secret": "<CAMOFOX_ACCESS_KEY>",
        "required_scope": "svc:camofox"
      }'
```

(or edit in the Services admin panel with the same values.)

Verify:

```
curl -s http://127.0.0.1:20128/api/svc/camofox/health
# now requires a key → should 401 without one
```

## Change 3 — Hermes API-key scope (db config)

Hermes's AI Gate key must carry `svc:camofox` to pass
`checkServiceScopeAccess` once `required_scope` is set (Change 2).

Current Hermes key (`~/.hermes/.env` → `HERMES_CUSTOM_AIGATE_API_KEY`,
id `0b49529d-203f-4983-9f23-d9ec2b2d16b3`):
scopes = `["manage","self:usage","self:account-quota"]`

Add `svc:camofox` via `PATCH /api/keys/<id>` (or key admin UI).

## Rebuild + verify (this project's job)

1. `podman build -t localhost/astra-aigate:v113 -f Dockerfile .` (bump tag)
2. Replace running container (host net, restart=always — snapshot data first
   per this repo's `bin/snapshot-data.sh` convention).
3. Verify after restart:
   - `GET /api/svc/camofox/health` → 200 **with** an AI Gate key that has
     `svc:camofox`; 401 without.
   - **POST** through the gateway now works:
     ```bash
     curl -s -X POST http://127.0.0.1:20128/api/svc/camofox/tabs \
       -H 'Content-Type: application/json' \
       -H "Authorization: Bearer $HERMES_AIGATE_KEY" \
       -d '{"userId":"t","sessionKey":"s","url":"https://example.com"}'
     ```
     (previously `duplex` error).

## Not this delivery's scope

- `tools/browser_camofox.py` (Hermes) still uses `CAMOFOX_API_KEY` as its
  Bearer. When Hermes points `CAMOFOX_URL` at the gateway, that value must
  become the **AI Gate** key (with `svc:camofox`), and the camofox access
  key stays only inside this gateway's `auth_secret`. No code change
  required on the Hermes tool — it sends `Authorization: Bearer <key>`.
- camofox side (image, container, VNC, viewport) is already done and
  validated separately.
