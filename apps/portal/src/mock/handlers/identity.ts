/** Identity, session, notifications, lookups, search and dashboard routes. */
import type * as T from "@/lib/types";
import { can, ROLE_LABELS, scopeOf } from "@/lib/rbac";
import { businessDate } from "@/lib/time";
import { resetDb } from "../db";
import {
  audit, buildMe, canSeeTask, fail, matchesSearch, nowIso, readSession, rolesForUser, visibleEmployees,
  visibleProjectIds, writeSession, type MockReq,
} from "../helpers";
import { route } from "../routes";

const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;

export interface Persona {
  userId: string;
  name: string;
  title: string;
  roles: string[];
  color: string;
  mfa: boolean;
}

export interface DashboardData {
  myTasks: { open: number; dueSoon: number; overdue: number; revision: number; items: T.Task[] };
  pendingReviews: { count: number; items: { task: T.Task; submission: T.Submission }[] };
  attendance?: { status: "NOT_CHECKED_IN" | "WORKING" | "ON_BREAK" | "CHECKED_OUT"; since?: string; shift?: string };
  tracking?: { state: T.SessionState | "NONE"; pendingUploads: number; sessionId?: string };
  syncIssues: { count: number; items: { label: string; href: string }[] };
  approvals: { label: string; count: number; href: string }[];
  org?: {
    activeProjects: number; openTasks: number; overdueTasks: number; pendingReviews: number;
    presentToday: number; activeEmployees: number; onLeaveToday: number; trackingNow: number;
    payrollState?: string; outputAcceptedPoints: number;
  };
  team?: { workload: { employee: T.Employee; open: number; points: number; overdue: number; blocked: number }[] };
}

function personas(req: Pick<MockReq, "db">): Persona[] {
  return req.db.users
    .filter((u) => u.status !== "INVITED")
    .map((u) => {
      const e = req.db.employees.find((x) => x.userId === u.id);
      const roles = rolesForUser(req.db, u.id);
      return {
        userId: u.id,
        name: e?.displayName ?? (u.email.startsWith("nadia") ? "Nadia Iqbal" : u.email),
        title: e?.title ?? "External Auditor",
        roles: roles.map((r) => ROLE_LABELS[r]),
        color: e?.avatarColor ?? "#475569",
        mfa: u.mfaEnrolled,
      };
    });
}

function attendanceStatus(req: MockReq, empId: string): DashboardData["attendance"] {
  const today = businessDate(new Date(), req.db.organization.timezone);
  const evs = req.db.attendanceEvents
    .filter((e) => e.employeeId === empId && businessDate(e.occurredAt, req.db.organization.timezone) === today)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const last = evs[evs.length - 1];
  const emp = req.db.employees.find((e) => e.id === empId);
  const shift = req.db.shiftTemplates.find((s) => emp?.teamId && s.assignedTeamIds.includes(emp.teamId));
  const shiftLabel = shift ? `${shift.name} ${shift.localStart}–${shift.localEnd}` : undefined;
  if (!last) return { status: "NOT_CHECKED_IN", shift: shiftLabel };
  const map: Record<T.AttendanceEventKind, NonNullable<DashboardData["attendance"]>["status"]> = {
    CHECK_IN: "WORKING", BREAK_END: "WORKING", BREAK_START: "ON_BREAK", CHECK_OUT: "CHECKED_OUT",
  };
  return { status: map[last.kind], since: last.occurredAt, shift: shiftLabel };
}

function dashboard(req: MockReq): DashboardData {
  const { db, me } = req;
  const eid = me.employee?.id;
  const now = Date.now();
  const soon = now + 3 * 86400000;
  const open: T.TaskState[] = ["ASSIGNED", "IN_PROGRESS", "REVISION_REQUESTED", "BLOCKED"];

  const mine = eid ? db.tasks.filter((t) => t.assigneeId === eid && open.concat("SUBMITTED").includes(t.state)) : [];
  const myTasks = {
    open: mine.length,
    dueSoon: mine.filter((t) => new Date(t.dueAt).getTime() < soon && new Date(t.dueAt).getTime() >= now).length,
    overdue: mine.filter((t) => new Date(t.dueAt).getTime() < now && t.state !== "SUBMITTED").length,
    revision: mine.filter((t) => t.state === "REVISION_REQUESTED").length,
    items: mine.sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, 6),
  };

  const reviewable = db.tasks.filter((t) => t.state === "SUBMITTED" && (t.reviewerId === eid || (scopeOf(me, "task.manage") && canSeeTask(db, me, t) && t.reviewerId === eid)));
  const pendingReviews = {
    count: reviewable.length,
    items: reviewable.map((task) => ({
      task,
      submission: db.submissions.filter((s) => s.taskId === task.id && s.state === "SUBMITTED").sort((a, b) => b.sequence - a.sequence)[0],
    })),
  };

  const syncItems: { label: string; href: string }[] = [];
  if (eid) {
    for (const s of db.submissions.filter((x) => x.authorId === eid && x.state === "DRAFT")) {
      const pending = s.mediaIds.map((m) => db.media.find((x) => x.id === m)).filter((m) => m && m.state !== "AVAILABLE");
      if (pending.length) syncItems.push({ label: `${pending.length} upload(s) still processing for "${db.tasks.find((t) => t.id === s.taskId)?.title}"`, href: `/tasks/${s.taskId}` });
    }
    for (const g of db.gaps.filter((g) => db.sessions.find((s) => s.id === g.sessionId)?.employeeId === eid)) {
      syncItems.push({ label: `Unknown coverage ${new Date(g.start).toISOString().slice(11, 16)}–${new Date(g.end).toISOString().slice(11, 16)} UTC (${g.reason.replace(/_/g, " ").toLowerCase()})`, href: "/tracking" });
    }
  }

  const approvals: DashboardData["approvals"] = [];
  const teamScope = visibleEmployees(db, me, "attendance.read");
  const inScope = (empId: string) => teamScope === "all" || teamScope.has(empId);
  if (can(me, "attendance.recommend")) {
    const c = db.corrections.filter((x) => x.status === "PROPOSED" && x.employeeId !== eid && inScope(x.employeeId)).length;
    if (c) approvals.push({ label: "Attendance corrections to validate", count: c, href: "/attendance/approvals" });
  }
  if (can(me, "attendance.approve")) {
    const c = db.corrections.filter((x) => x.status === "MANAGER_VALIDATED" && x.employeeId !== eid).length;
    if (c) approvals.push({ label: "Attendance corrections awaiting HR", count: c, href: "/attendance/approvals" });
  }
  if (can(me, "leave.recommend")) {
    const c = db.leaveRequests.filter((x) => x.status === "PENDING" && !x.managerDecision && x.employeeId !== eid && inScope(x.employeeId)).length;
    if (c) approvals.push({ label: "Leave requests to recommend", count: c, href: "/leave/approvals" });
  }
  if (can(me, "leave.approve")) {
    const c = db.leaveRequests.filter((x) => x.status === "PENDING" && x.employeeId !== eid).length;
    if (c) approvals.push({ label: "Leave requests awaiting HR", count: c, href: "/leave/approvals" });
  }
  if (can(me, "overtime.recommend")) {
    const c = db.overtime.filter((x) => ["PENDING", "FLAGGED"].includes(x.status) && inScope(x.employeeId)).length;
    if (c) approvals.push({ label: "Overtime to review", count: c, href: "/overtime" });
  }
  if (can(me, "overtime.validate")) {
    const c = db.overtime.filter((x) => x.status === "MANAGER_RECOMMENDED").length;
    if (c) approvals.push({ label: "Overtime awaiting payroll validation", count: c, href: "/overtime" });
  }
  if (can(me, "payroll.approve")) {
    const c = db.payrollRuns.filter((r) => r.state === "UNDER_REVIEW").length;
    if (c) approvals.push({ label: "Payroll runs awaiting owner approval", count: c, href: "/payroll" });
  }
  if (can(me, "policy.approve")) {
    const c = db.policies.filter((p) => p.status === "PENDING_APPROVAL").length;
    if (c) approvals.push({ label: "Policies awaiting approval", count: c, href: "/admin/policies" });
  }
  if (can(me, "score.dispute.resolve")) {
    const c = db.disputes.filter((x) => x.status === "OPEN" || x.status === "UNDER_REVIEW").length;
    if (c) approvals.push({ label: "Score disputes to resolve", count: c, href: "/scores" });
  }
  if (can(me, "worklog.review")) {
    const c = db.workLogs.filter((w) => w.status === "SUBMITTED" && w.employeeId !== eid && inScope(w.employeeId)).length;
    if (c) approvals.push({ label: "Work logs to review", count: c, href: "/worklogs" });
  }

  const result: DashboardData = { myTasks, pendingReviews, syncIssues: { count: syncItems.length, items: syncItems }, approvals };

  if (eid) {
    result.attendance = attendanceStatus(req, eid);
    const s = db.sessions.find((x) => x.employeeId === eid && x.state !== "STOPPED");
    result.tracking = { state: s?.state ?? "NONE", pendingUploads: s?.pendingUploads ?? 0, sessionId: s?.id };
  }

  if (can(me, "dashboard.owner") || scopeOf(me, "task.read") === "organization") {
    const today = businessDate(new Date(), db.organization.timezone);
    const active = db.employees.filter((e) => e.employmentStatus === "ACTIVE");
    result.org = {
      activeProjects: db.projects.filter((p) => p.state === "ACTIVE").length,
      openTasks: db.tasks.filter((t) => open.includes(t.state)).length,
      overdueTasks: db.tasks.filter((t) => open.includes(t.state) && new Date(t.dueAt).getTime() < now).length,
      pendingReviews: db.tasks.filter((t) => t.state === "SUBMITTED").length,
      presentToday: new Set(db.attendanceEvents.filter((e) => e.kind === "CHECK_IN" && businessDate(e.occurredAt, db.organization.timezone) === today).map((e) => e.employeeId)).size,
      activeEmployees: active.length,
      onLeaveToday: db.leaveRequests.filter((l) => l.status === "APPROVED" && l.startDate <= today && l.endDate >= today).length,
      trackingNow: db.sessions.filter((s) => s.state === "ACTIVE" || s.state === "IDLE").length,
      payrollState: can(me, "payroll.read") ? db.payrollRuns.find((r) => r.state !== "PAID")?.state : undefined,
      outputAcceptedPoints: db.tasks.filter((t) => ["APPROVED", "COMPLETED"].includes(t.state)).reduce((a, t) => a + Number(t.baselinePoints), 0),
    };
  }

  if (can(me, "dashboard.manager") || can(me, "dashboard.owner")) {
    const vis = visibleEmployees(db, me, "task.read");
    const emps = db.employees.filter((e) => e.employmentStatus === "ACTIVE" && (vis === "all" ? ["team-design", "team-video"].includes(e.teamId ?? "") : vis.has(e.id) && e.id !== eid));
    result.team = {
      workload: emps.map((employee) => {
        const ts = db.tasks.filter((t) => t.assigneeId === employee.id && open.concat("SUBMITTED").includes(t.state));
        return {
          employee,
          open: ts.length,
          points: ts.reduce((a, t) => a + Number(t.baselinePoints), 0),
          overdue: ts.filter((t) => new Date(t.dueAt).getTime() < now && t.state !== "SUBMITTED").length,
          blocked: ts.filter((t) => t.state === "BLOCKED").length,
        };
      }),
    };
  }
  return result;
}

export const identityRoutes = [
  route("GET", "/auth/personas", (req) => personas(req), { public: true }),

  /** Mock stand-in for the OIDC callback (Google Workspace). The real API validates issuer/audience/nonce. */
  route("POST", "/auth/login", (req) => {
    const user = req.db.users.find((u) => u.id === req.body.userId);
    if (!user) fail(404, "NOT_FOUND", "Unknown account.");
    const fakeReq = { db: req.db, me: { user: user!, employee: undefined, roles: [], permissions: [], organization: req.db.organization, authTime: nowIso(), sessionExpiresAt: nowIso() } as T.Me };
    if (user!.status !== "ACTIVE") {
      audit(fakeReq, "auth.login", "Session", user!.id, { result: "DENIED", reason: `Account ${user!.status.toLowerCase()}` });
      fail(403, "FORBIDDEN", user!.status === "SUSPENDED" ? "This account is suspended. Contact HR." : "This account is not active.");
    }
    const now = new Date();
    const session = { userId: user!.id, authTime: now.toISOString(), expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS).toISOString(), lastActivity: now.toISOString() };
    writeSession(session);
    user!.lastLogin = now.toISOString();
    const me = buildMe(req.db, session)!;
    audit({ db: req.db, me }, "auth.login", "Session", user!.id);
    return me;
  }, { public: true }),

  route("POST", "/auth/logout", (req) => {
    audit(req, "auth.logout", "Session", req.me.user.id);
    writeSession(null);
    return { ok: true };
  }),

  /** Re-authentication for sensitive approvals (must be within 10 minutes). */
  route("POST", "/auth/reauth", (req) => {
    const s = readSession();
    if (!s) fail(401, "AUTH_REQUIRED", "Please sign in.");
    if (!req.body.confirm) fail(400, "VALIDATION_ERROR", "Confirm your identity with the identity provider.");
    const authTime = nowIso();
    writeSession({ ...s!, authTime });
    audit(req, "auth.reauthenticate", "Session", req.me.user.id);
    return { authTime, proof: `reauth_${Date.now().toString(36)}` };
  }),

  route("GET", "/me", (req) => req.me),
  route("GET", "/me/permissions", (req) => ({ roles: req.me.roles, permissions: req.me.permissions })),
  route("GET", "/dashboard", (req) => dashboard(req)),

  route("GET", "/notifications", (req) => {
    const items = req.db.notifications.filter((n) => n.userId === req.me.user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const filtered = req.query.unread === "true" ? items.filter((n) => !n.readAt) : items;
    return { items: filtered, unread: items.filter((n) => !n.readAt).length };
  }),
  route("POST", "/notifications/:id/read", (req) => {
    const n = req.db.notifications.find((x) => x.id === req.params.id && x.userId === req.me.user.id);
    if (!n) fail(404, "NOT_FOUND", "Notification not found.");
    n!.readAt = n!.readAt ?? nowIso();
    return n;
  }),
  route("POST", "/notifications/read-all", (req) => {
    for (const n of req.db.notifications) if (n.userId === req.me.user.id && !n.readAt) n.readAt = nowIso();
    return { ok: true };
  }),

  /** Picker data, filtered to what the caller may see. */
  route("GET", "/lookups", (req) => {
    const { db, me } = req;
    const emps = visibleEmployees(db, me, "employee.read");
    const projectIds = visibleProjectIds(db, me);
    return {
      employees: db.employees
        .filter((e) => emps === "all" || emps.has(e.id) || db.projects.some((p) => (projectIds === "all" || projectIds.has(p.id)) && p.memberIds.includes(e.id)))
        .map((e) => ({ id: e.id, displayName: e.displayName, title: e.title, teamId: e.teamId, employmentStatus: e.employmentStatus, avatarColor: e.avatarColor, employeeCode: e.employeeCode })),
      teams: db.teams.map((t) => ({ id: t.id, name: t.name })),
      projects: db.projects.filter((p) => projectIds === "all" || projectIds.has(p.id)).map((p) => ({ id: p.id, code: p.code, name: p.name, state: p.state })),
      leaveTypes: db.leaveTypes,
      holidays: db.holidays,
    };
  }),

  /** Global search limited to visible objects (section 4). */
  route("GET", "/search", (req) => {
    const { db, me } = req;
    const q = (req.query.q ?? "").trim();
    if (q.length < 2) return { results: [] };
    const results: { type: string; id: string; title: string; subtitle: string; href: string }[] = [];
    const projectIds = visibleProjectIds(db, me);
    for (const p of db.projects) if ((projectIds === "all" || projectIds.has(p.id)) && matchesSearch(q, p.name, p.code)) results.push({ type: "Project", id: p.id, title: p.name, subtitle: p.code, href: `/projects/${p.id}` });
    for (const t of db.tasks) if (canSeeTask(db, me, t) && matchesSearch(q, t.title)) results.push({ type: "Task", id: t.id, title: t.title, subtitle: db.projects.find((p) => p.id === t.projectId)?.code ?? "", href: `/tasks/${t.id}` });
    const emps = visibleEmployees(db, me, "employee.read");
    for (const e of db.employees) if ((emps === "all" || emps.has(e.id)) && matchesSearch(q, e.displayName, e.employeeCode, e.title)) results.push({ type: "Person", id: e.id, title: e.displayName, subtitle: `${e.employeeCode} · ${e.title}`, href: `/people/${e.id}` });
    if (can(me, "asset.read:organization")) for (const a of db.assets) if (matchesSearch(q, a.assetTag, a.model, a.serial)) results.push({ type: "Asset", id: a.id, title: `${a.assetTag} ${a.model}`, subtitle: a.state, href: `/assets` });
    return { results: results.slice(0, 20) };
  }),

  /* ------------------------------------------------ mock-only controls (not part of the real API) */
  route("POST", "/_mock/reset", () => {
    resetDb();
    writeSession(null);
    return { ok: true };
  }, { public: true }),
  route("POST", "/_mock/sim", (req) => {
    Object.assign(req.db.sim, req.body);
    return req.db.sim;
  }, { public: true }),
  route("GET", "/_mock/sim", (req) => req.db.sim, { public: true }),
];
