/**
 * Typed fetch helpers for browser code. Errors are normalised to ClientApiError so that UI
 * components can show the server's message and error code.
 */

export class ClientApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = "ClientApiError";
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ClientApiError) return error.message;
  if (error instanceof Error && error.name === "AbortError") return "";
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}

export async function apiRequest<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", signal };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, init);
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ClientApiError(`Unexpected response from server (${res.status})`, res.status, "bad_response");
    }
  }
  if (!res.ok) {
    const err = (data as { error?: { message?: string; code?: string; details?: unknown } } | null)?.error;
    throw new ClientApiError(err?.message ?? `Request failed (${res.status})`, res.status, err?.code ?? "error", err?.details ?? null);
  }
  return data as T;
}

export const apiGet = <T>(path: string, signal?: AbortSignal) => apiRequest<T>("GET", path, undefined, signal);
export const apiPost = <T>(path: string, body?: unknown) => apiRequest<T>("POST", path, body ?? {});
export const apiPatch = <T>(path: string, body: unknown) => apiRequest<T>("PATCH", path, body);
export const apiDelete = <T>(path: string) => apiRequest<T>("DELETE", path);

export function withQuery(path: string, params: URLSearchParams | string | null | undefined): string {
  const q = typeof params === "string" ? params : params?.toString();
  return q ? `${path}?${q}` : path;
}
