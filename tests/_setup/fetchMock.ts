/** Shared fetch-mocking helpers for service tests. */

export type TestFetch = typeof fetch;

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function textResponse(text: string, status = 400) {
  return new Response(text, {
    status,
    headers: { "content-type": "text/plain" },
  });
}

export function bodyToString(body: BodyInit | null | undefined) {
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  return String(body ?? "");
}

export async function withMockedFetch<TResult>(fetchImpl: TestFetch, fn: () => Promise<TResult>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}
