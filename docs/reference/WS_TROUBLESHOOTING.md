# WebSocket Troubleshooting

Operational troubleshooting for the live-dashboard / combo-studio WebSocket
endpoints. Mirrors the code comments in `src/server/ws/liveServer.ts` (loopback
default, opt-in LAN exposure) from an operator's symptom → root-cause → fix
perspective.

> Apply to the **management/WS** plane (dashboard live status, combo studio).
> For the relay (SSE-to-target) plane see `RELAY_TROUBLESHOOTING.md`.

---

## When to use

- Live dashboard / combo studio shows **disconnected** even though the page
  loads and HTTP endpoints respond.
- A WebSocket that worked on one host fails after moving the container to
  another host.
- You changed an Origin allow-list or `LIVE_WS_*` env var and WS broke.

---

## Fixed facts (read these first)

| Fact                     | Value                                                              |
| ------------------------ | ------------------------------------------------------------------ |
| WS server host default   | `127.0.0.1` (loopback)                                             |
| Opt-in LAN exposure      | `LIVE_WS_HOST=0.0.0.0`                                             |
| Management connector     | `LIVE_WS_ALLOWED_HOSTS` (host-level)                               |
| Origin allow-list        | `LIVE_WS_ALLOWED_ORIGINS` (`src/server/ws/liveServerAllowList.ts`) |
| Unauthorised close code  | `4003`                                                             |
| Missing-token close code | `4001`                                                             |
| Listen source            | `src/server/ws/liveServer.ts` + `src/app/api/v1/ws/route.ts`       |

There are **two WS surfaces** and they can disagree on listen bind:

- The **dashboard WS** (`useLiveDashboard.ts` → `DEFAULT_WS_URL`) binds to the
  browser's host on port `20132`.
- The **HTTP plane** on port `20128`.

A common failure is the HTTP plane listening on `0.0.0.0` (LAN-accessible) while
the WS plane stays on `127.0.0.1` (loopback only). The page then loads fine over
LAN but every WS connection fails → UI shows "disconnected".

---

## Failure mode 1 — page loads but WS stays disconnected

**Symptom**: dashboard/combo-studio reachable over LAN or a DNS name, page
renders, but live status spins forever / combo list empty / "disconnected".

**Root cause** (observed 2026-08-09 after a container migration): the WS
listener was bound to loopback (`127.0.0.1`) while HTTP was bound to `0.0.0.0`.
The migrated container inherited env that set the HTTP host but omitted
`LIVE_WS_HOST`, so the WS server fell back to its loopback default.

**Diagnosis — check the listen bind (not the HTTP bind):**

```bash
# Compare the two planes:
ss -tlnp | grep -E ':(20128|20132)\b'
# Expect:
#   20128  *:*            (0.0.0.0)  ← HTTP, LAN-accessible
#   20132  *:*  OR  127.0.0.1:*     ← WS; if 127.0.0.1, that's the bug
```

**Fix** — set the WS host explicitly in the runtime env (does not belong in
`src/` or README):

```bash
# server.env (runtime config, outside the repo)
LIVE_WS_HOST=0.0.0.0
```

Restart the container, then re-check `ss` — the WS plane should now bind
`0.0.0.0`.

> `LIVE_WS_HOST=::` equivalent is accepted (`0.0.0.0`, `::`, `*` all mean
> "all interfaces", per `liveServer.ts`). This is a **runtime config change
> only** — it must not go into git.

---

## Failure mode 2 — WS upgraded (101) but then closes

**Symptom**: raw utility shows `101 Switching Protocols` but the socket closes
right after; someone assumes everything is fine.

**Root cause**: a 101 does **not** mean the Origin/auth checks passed — those
run _after_ the upgrade and close the connection with a specific code. Inspect
the **close frame**, not the handshake.

Two close codes to know:

| Code   | Meaning                           |
| ------ | --------------------------------- |
| `4003` | Origin rejected by the allow-list |
| `4001` | Missing/invalid WebSocket token   |

**Diagnosis — read the close frame (curl cannot)**:

`curl` only reports the 101 handshake; it never sees the close frame. Use a raw
socket or a real WS client library.

```bash
# Node, from a directory that can resolve the app's `ws` dependency
node test-ws.mjs
```

Script sketch (raw socket) that prints the close code from the close frame:

```js
// raw socket handshake then read close frame
const net = require("net");
const url = new URL(process.env.WS_URL); // e.g. ws://host:20132/live-ws
const c = net.connect(+url.port, url.hostname, () => {
  c.write(
    "GET " +
      url.pathname +
      " HTTP/1.1\r\n" +
      "Host: " +
      url.hostname +
      "\r\n" +
      "Origin: " +
      process.env.WS_ORIGIN +
      "\r\n" + // e.g. http://my-spa:20128
      "Connection: Upgrade\r\n" +
      "Upgrade: websocket\r\n" +
      "Sec-WebSocket-Version: 13\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n"
  );
});
c.on("data", (d) => {
  const s = d.toString();
  console.log(s.slice(0, 300));
  c.end();
});
```

- A legit browser client is also fine — it sends the session cookie, which the
  server's `wsAuth` accepts; a bare-socket client with no cookie/token gets
  `4001` by design.

**Fix** for `4003`: add the caller's Origin host to `LIVE_WS_ALLOWED_ORIGINS`
(or its host to `LIVE_WS_ALLOWED_HOSTS`). For `4001`: the client must present a
valid token / session cookie.

---

## Verification

- **All-interfaces**: `ss -tlnp` shows WS port on `0.0.0.0`.
- **Loopback + token**: real `ws`-library client to `ws://127.0.0.1:20132/live-ws`
  with a cookie/token → `welcome` + `subscribed` on the combo channel.
- **DNS/LAN + token**: same client via the LAN/DNS host with the allowed Origin
  → subscribed.
- **Disallowed Origin**: same client with a hostile Origin → closes with `4003`
  (proves the allow-list still gates exposure).

---

## Gotchas

- **`curl` 101 does not prove success** — it can't read the close frame. Only a
  raw socket / real WS client can.
- **`ws`-library test scripts must run from a directory that resolves the app's
  `node_modules/ws`** — a script in `/tmp` will fail to require `ws`. Copy it
  into the repo root, run, delete.
- **Runtime env vs code**: `LIVE_WS_HOST` and the origin/port config are runtime
  (e.g. `server.env`) and must stay out of `src/` and README. The _defaults_ live
  in `src/server/ws/liveServer.ts` — always check that file before assuming a
  port is LAN-exposed.
- **Two planes, one env**: the HTTP plane and the WS plane listen independently.
  Exposing HTTP (`*:20128`) does not expose WS — set `LIVE_WS_HOST` too.
