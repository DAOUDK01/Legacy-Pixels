import type { ApiErrorBody, ApiErrorCode } from "@/lib/types";

/**
 * Single request function used by every screen. In "mock" mode requests are dispatched to the
 * in-browser mock API (src/mock) that implements the same /v1 routes; in "http" mode they go to
 * the NestJS API with the cookie session, If-Match and Idempotency-Key headers (section 23).
 */

export const API_MODE: "mock" | "http" = process.env.NEXT_PUBLIC_API_MODE === "http" ? "http" : "mock";
const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/v1";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ApiErrorBody,
  ) {
    super(body.message);
    this.name = "ApiError";
  }
  get code(): ApiErrorCode {
    return this.body.code;
  }
}

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  ifMatch?: number;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildQuery(query?: RequestOptions["query"]): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : "";
}

function readCsrfToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie.split("; ").find((c) => c.startsWith("csrf_token="))?.split("=")[1];
}

async function httpRequest<T>(method: HttpMethod, path: string, opts: RequestOptions): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.ifMatch !== undefined) headers["If-Match"] = `"${opts.ifMatch}"`;
  if (method !== "GET") {
    headers["Idempotency-Key"] = opts.idempotencyKey ?? newIdempotencyKey();
    const csrf = readCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}${buildQuery(opts.query)}`, {
      method,
      headers,
      credentials: "include",
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, {
      code: "DEPENDENCY_UNAVAILABLE",
      message: "The portal could not reach the server. Check your connection and retry.",
      requestId: "client",
      retryable: true,
    });
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json as ApiErrorBody);
  return json as T;
}

export async function request<T>(method: HttpMethod, path: string, opts: RequestOptions = {}): Promise<T> {
  if (API_MODE === "http") return httpRequest<T>(method, path, opts);
  const { mockRequest } = await import("@/mock/router");
  return mockRequest<T>(method, path, opts);
}

export const api = {
  get: <T>(path: string, query?: RequestOptions["query"]) => request<T>("GET", path, { query }),
  post: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, "body"> = {}) =>
    request<T>("POST", path, { ...opts, body }),
  patch: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, "body"> = {}) =>
    request<T>("PATCH", path, { ...opts, body }),
  put: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, "body"> = {}) =>
    request<T>("PUT", path, { ...opts, body }),
  del: <T>(path: string, opts: RequestOptions = {}) => request<T>("DELETE", path, opts),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.body.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
