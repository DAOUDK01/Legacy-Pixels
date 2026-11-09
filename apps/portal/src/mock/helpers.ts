/** Shared helpers for mock route handlers: errors, authz, audit, notifications, versioning. */
import type * as T from "@/lib/types";
import { can, permissionsFor, scopeOf } from "@/lib/rbac";
import { getDb, type MockDb } from "./db";

export class MockHttpError extends Error {
  constructor(
    public status: number,
    public code: T.ApiErrorCode,
    message: string,
    public extra: { fieldErrors?: Record<string, string>; latest?: unknown; retryable?: boolean } = {},
  ) {
    super(message);
  }
}

export const fail = (status: number, code: T.ApiErrorCode, message: string, extra?: MockHttpError["extra"]): never => {
  throw new MockHttpError(status, code, message, extra);
};

export const validation = (fieldErrors: Record<string, string>, message = "Some fields need attention."): never =>
  fail(400, "VALIDATION_ERROR", message, { fieldErrors });

export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const nowIso = () => new Date().toISOString();

export interface MockReq {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  ifMatch?: number;
  me: T.Me;
  db: MockDb;
}

/* ------------------------------------------------------------ session / identity */

const SESSION_KEY = "lp.session";

export interface MockSession {
  userId: string;
  authTime: string;
  expiresAt: string;
  lastActivity: string;
}

export function readSession(): MockSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as MockSession) : null;
  } catch {
    return null;
  }
}

export function writeSession(s: MockSession | null): void {
  if (typeof window === "undefined") return;
  try {
    if (s) window.localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function rolesForUser(db: MockDb, userId: string): T.RoleKey[] {
  const today = new Date().toISOString().slice(0, 10);
  return Array.from(
    new Set(
      db.roleAssignments
        .filter((r) => r.userId === userId && r.validFrom <= today && (!r.validTo || r.validTo >= today))
        .map((r) => r.role),
    ),
  );
}

export function buildMe(db: MockDb, s: MockSession): T.Me | null {
  const user = db.users.find((u) => u.id === s.userId);
  if (!user || user.status !== "ACTIVE") return null;
  const employee = db.employees.find((e) => e.userId === user.id);
  if (employee && employee.employmentStatus !== "ACTIVE") return null;
  const roles = rolesForUser(db, user.id);
  return {
    user,
    employee,
    roles,
    permissions: permissionsFor(roles),
    organization: db.organization,
    authTime: s.authTime,
    sessionExpiresAt: s.expiresAt,
  };
}

/* ------------------------------------------------------------ authorization */

export function requirePerm(me: T.Me, permission: string): void {
  if (!can(me, permission)) fail(403, "FORBIDDEN", "You do not have permission to perform this action.");
}

/** Employee IDs the caller may see for an action, or "all". Deny by default. */
export function visibleEmployees(db: MockDb, me: T.Me, action: string): "all" | Set<string> {
  const scope = scopeOf(me, action);
  if (scope === "organization") return "all";
  const ids = new Set<string>();
  if (me.employee) {
    if (scope === "self" || scope === "team" || scope === "project") ids.add(me.employee.id);
    if (scope === "team") {
      for (const t of db.teams) if (t.managerEmployeeId === me.employee.id) t.memberIds.forEach((m) => ids.add(m));
      for (const e of db.employees) if (e.managerId === me.employee.id) ids.add(e.id);
    }
  }
  // Additional self scope from employee role even if a broader team scope exists
  if (me.employee && can(me, `${action}:self`)) ids.add(me.employee.id);
  return ids;
}

export function canSeeEmployee(db: MockDb, me: T.Me, action: string, employeeId: string): boolean {
  const v = visibleEmployees(db, me, action);
  return v === "all" || v.has(employeeId);
}

export function filterByEmployee<X extends { employeeId: string }>(db: MockDb, me: T.Me, action: string, rows: X[]): X[] {
  const v = visibleEmployees(db, me, action);
  return v === "all" ? rows : rows.filter((r) => v.has(r.employeeId));
}

/** Projects visible to the caller: org scope, managed/member teams, assigned review, or own assignments. */
export function visibleProjectIds(db: MockDb, me: T.Me): "all" | Set<string> {
  if (scopeOf(me, "project.read") === "organization") return "all";
  const ids = new Set<string>();
  const eid = me.employee?.id;
  if (!eid) return ids;
  const teamMembers = visibleEmployees(db, me, "task.read");
  for (const p of db.projects) {
    if (p.managerId === eid || p.memberIds.includes(eid)) ids.add(p.id);
    if (teamMembers !== "all" && p.memberIds.some((m) => teamMembers.has(m)) && scopeOf(me, "project.read") === "team") ids.add(p.id);
  }
  for (const t of db.tasks) if (t.reviewerId === eid || t.assigneeId === eid) ids.add(t.projectId);
  return ids;
}

export function canSeeTask(db: MockDb, me: T.Me, task: T.Task): boolean {
  if (scopeOf(me, "task.read") === "organization") return true;
  const eid = me.employee?.id;
  if (!eid) return false;
  if (task.assigneeId === eid || task.reviewerId === eid) return true;
  const project = db.projects.find((p) => p.id === task.projectId);
  if (project?.managerId === eid) return true;
  if (scopeOf(me, "task.read") === "team") {
    const v = visibleEmployees(db, me, "task.read");
    if (v !== "all" && task.assigneeId && v.has(task.assigneeId)) return true;
    if (project && project.memberIds.some((m) => v !== "all" && v.has(m))) return true;
  }
  return false;
}

/* ------------------------------------------------------------ versioning, audit, notifications */

export function checkVersion<X extends { version: number }>(req: MockReq, record: X): void {
  if (req.ifMatch !== undefined && req.ifMatch !== record.version) {
    fail(409, "VERSION_CONFLICT", "This record changed since you opened it. Review the latest version and retry.", {
      latest: record,
    });
  }
}

export function bump<X extends { version: number; updatedAt?: string }>(record: X): X {
  record.version += 1;
  if ("updatedAt" in record) record.updatedAt = nowIso();
  return record;
}

export function employeeLabel(db: MockDb, id?: string): string {
  return db.employees.find((e) => e.id === id)?.displayName ?? "Unknown";
}

export function audit(
  req: Pick<MockReq, "db" | "me">,
  action: string,
  targetType: string,
  targetId: string,
  opts: { reason?: string; result?: T.AuditEvent["result"]; before?: Record<string, unknown>; after?: Record<string, unknown> } = {},
): void {
  req.db.audit.unshift({
    id: uuid(),
    actorType: "USER",
    actorId: req.me.user.id,
    actorLabel: req.me.employee?.displayName ?? req.me.user.email,
    action,
    targetType,
    targetId,
    occurredAt: nowIso(),
    requestId: `req_${Math.random().toString(36).slice(2, 10)}`,
    reason: opts.reason,
    result: opts.result ?? "SUCCESS",
    change: opts.before || opts.after ? { before: opts.before, after: opts.after } : undefined,
  });
}

export function notifyEmployee(
  db: MockDb,
  employeeId: string | undefined,
  n: Omit<T.Notification, "id" | "userId" | "createdAt" | "mandatory"> & { mandatory?: boolean },
): void {
  const emp = db.employees.find((e) => e.id === employeeId);
  if (!emp?.userId) return;
  db.notifications.unshift({ id: uuid(), userId: emp.userId, createdAt: nowIso(), mandatory: false, ...n });
}

export function notifyRole(
  db: MockDb,
  role: T.RoleKey,
  n: Omit<T.Notification, "id" | "userId" | "createdAt" | "mandatory"> & { mandatory?: boolean },
): void {
  for (const u of db.users) {
    if (u.status === "ACTIVE" && rolesForUser(db, u.id).includes(role)) {
      db.notifications.unshift({ id: uuid(), userId: u.id, createdAt: nowIso(), mandatory: false, ...n });
    }
  }
}

export function reauthFresh(me: T.Me, withinMinutes = 10): boolean {
  return Date.now() - new Date(me.authTime).getTime() <= withinMinutes * 60000;
}

/** Cursor pagination over an already-sorted array (opaque cursor = offset). */
export function paginate<X>(rows: X[], query: Record<string, string>): T.Page<X> {
  const limit = Math.min(Number(query.limit ?? 50) || 50, 100);
  const offset = query.cursor ? Number(atob(query.cursor)) || 0 : 0;
  const items = rows.slice(offset, offset + limit);
  const next = offset + limit < rows.length ? btoa(String(offset + limit)) : undefined;
  return { items, nextCursor: next };
}

export function matchesSearch(q: string | undefined, ...fields: (string | undefined)[]): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return fields.some((f) => f?.toLowerCase().includes(needle));
}
