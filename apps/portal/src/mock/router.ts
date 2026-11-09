/**
 * Mock API router. Dispatches "METHOD /path" to handler modules that implement the /v1 contract
 * from spec section 23, including the error envelope, If-Match versioning and idempotency keys.
 */
import type { ApiErrorBody, Me } from "@/lib/types";
import { ApiError, type HttpMethod, type RequestOptions } from "@/lib/api/transport";
import { getDb, persist } from "./db";
import { MockHttpError, buildMe, readSession, writeSession, type MockReq } from "./helpers";
import type { RouteDef } from "./routes";
import { identityRoutes } from "./handlers/identity";
import { workRoutes } from "./handlers/work";
import { workforceRoutes } from "./handlers/workforce";
import { monitoringRoutes } from "./handlers/monitoring";
import { performanceRoutes } from "./handlers/performance";
import { payrollRoutes } from "./handlers/payroll";
import { peopleRoutes } from "./handlers/people";
import { adminRoutes } from "./handlers/admin";

interface Compiled extends RouteDef {
  regex: RegExp;
  keys: string[];
}

const compiled: Compiled[] = [
  ...identityRoutes,
  ...workRoutes,
  ...workforceRoutes,
  ...monitoringRoutes,
  ...performanceRoutes,
  ...payrollRoutes,
  ...peopleRoutes,
  ...adminRoutes,
].map((r) => {
  const keys: string[] = [];
  const pattern = r.path.replace(/:([a-zA-Z]+)/g, (_, k) => {
    keys.push(k);
    return "([^/]+)";
  });
  return { ...r, regex: new RegExp(`^${pattern}$`), keys };
});

const idempotency = new Map<string, { bodyHash: string; result: unknown }>();

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // proposed portal idle timeout (section 4)

function toApiError(status: number, body: Omit<ApiErrorBody, "requestId">): ApiError {
  return new ApiError(status, { ...body, requestId: `req_${Math.random().toString(36).slice(2, 10)}` });
}

export async function mockRequest<T>(method: HttpMethod, rawPath: string, opts: RequestOptions): Promise<T> {
  const db = getDb();
  await new Promise((r) => setTimeout(r, db.sim.latencyMs + Math.random() * 120));

  const path = rawPath.split("?")[0];
  const route = compiled.find((r) => r.method === method && r.regex.test(path));
  if (!route) throw toApiError(404, { code: "NOT_FOUND", message: `No route ${method} ${path}`, retryable: false });

  const m = path.match(route.regex)!;
  const params: Record<string, string> = {};
  route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== "") query[k] = String(v);

  // Authentication
  let me: Me | null = null;
  if (!route.public) {
    const session = readSession();
    if (!session) throw toApiError(401, { code: "AUTH_REQUIRED", message: "Please sign in.", retryable: false });
    if (Date.now() > new Date(session.expiresAt).getTime() || Date.now() - new Date(session.lastActivity).getTime() > IDLE_TIMEOUT_MS) {
      writeSession(null);
      throw toApiError(401, { code: "AUTH_REQUIRED", message: "Your session expired. Please sign in again.", retryable: false });
    }
    me = buildMe(db, session);
    if (!me) {
      writeSession(null);
      throw toApiError(401, { code: "AUTH_REQUIRED", message: "Your account is not active.", retryable: false });
    }
    writeSession({ ...session, lastActivity: new Date().toISOString() });
  }

  // Idempotency (mutations only): same key + same body returns the original result; different body is 409.
  let idemKey: string | undefined;
  let bodyHash = "";
  if (method !== "GET" && opts.idempotencyKey) {
    idemKey = `${me?.user.id ?? "anon"}|${method}|${path}|${opts.idempotencyKey}`;
    bodyHash = JSON.stringify(opts.body ?? null);
    const prior = idempotency.get(idemKey);
    if (prior) {
      if (prior.bodyHash !== bodyHash)
        throw toApiError(409, { code: "VALIDATION_ERROR", message: "Idempotency key reused with a different request body.", retryable: false });
      return structuredClone(prior.result) as T;
    }
  }

  const req: MockReq = { method, path, params, query, body: opts.body ?? {}, ifMatch: opts.ifMatch, me: me as Me, db };
  try {
    const result = await route.handler(req);
    if (method !== "GET") persist();
    if (idemKey) idempotency.set(idemKey, { bodyHash, result });
    return structuredClone(result) as T;
  } catch (e) {
    if (e instanceof MockHttpError) {
      throw toApiError(e.status, {
        code: e.code,
        message: e.message,
        fieldErrors: e.extra.fieldErrors,
        latest: e.extra.latest,
        retryable: e.extra.retryable ?? (e.status === 429 || e.status === 503),
      });
    }
    console.error("[mock api]", e);
    throw toApiError(500, { code: "DEPENDENCY_UNAVAILABLE", message: "Unexpected server error.", retryable: true });
  }
}
