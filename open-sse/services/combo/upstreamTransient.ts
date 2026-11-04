/**
 * Upstream failures that arrive wearing a client-error status code.
 *
 * Some providers report their own upstream breakage as HTTP 400 with a
 * `[server_error]` marker in the message. The request was valid, so treating
 * that as terminal drops the combo off the preferred model on a single bad hop.
 *
 * Deliberately narrow. In the recorded 400s the genuine client errors carry
 * different text — "Unsupported value", "Model does not exist", "uploaded an
 * unsupported image" — and none of them include this marker, so the test
 * separates the two classes without a provider list.
 */
const UPSTREAM_SERVER_ERROR = /\[server_error\]/i;

export function isUpstreamServerError(
  status: number | undefined,
  errorText: string | undefined
): boolean {
  return status === 400 && UPSTREAM_SERVER_ERROR.test(errorText || "");
}

/**
 * Attempts to allow when the failure came from that 400 class.
 *
 * Measured recovery within 30s is ~54% on one model and ~31% on another, so a
 * second retry mostly buys latency instead of keeping the request on the
 * preferred model.
 */
export const UPSTREAM_SERVER_ERROR_RETRY_BUDGET = 1;
