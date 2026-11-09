/**
 * Delivery domain mock routes: projects, tasks, dependencies, comments, submissions, reviews,
 * uploads/media and work logs (spec sections 5, 6, 7, 18, 23, 24).
 */
import type * as T from "@/lib/types";
import { can, scopeOf } from "@/lib/rbac";
import { RUBRIC_V1, rubricCommentErrors, weightedQuality } from "@/lib/calc/rubric";
import { persist, type MockDb } from "../db";
import {
  audit, bump, canSeeTask, checkVersion, fail, matchesSearch, notifyEmployee, nowIso, paginate, requirePerm, uuid,
  validation, visibleEmployees, visibleProjectIds, type MockReq,
} from "../helpers";
import { route } from "../routes";

/* ------------------------------------------------------------------ internal types */

export type MediaX = T.MediaAsset & {
  submissionId?: string;
  taskId?: string;
  receivedBytes?: number;
  scanStartedAt?: string;
  expiresAt?: string;
};

type ProjectX = T.Project & { stateBeforeArchive?: T.ProjectState };

const TERMINAL: T.TaskState[] = ["COMPLETED", "CANCELLED"];
const DONE_STATES: T.TaskState[] = ["APPROVED", "COMPLETED"];
const MAX_FILE_BYTES = 10 * 1024 ** 3; // proposed 10 GiB (section 7)
const CHUNK_BYTES = 8 * 1024 * 1024; // proposed 8 MiB (section 18)
const BLOCKED_EXT = ["exe", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "jar", "dll", "sh", "app", "apk", "html", "htm", "svgz", "js", "rar", "7z", "tar", "gz", "iso"];
const BLOCKED_MIME = ["application/x-msdownload", "application/x-msdos-program", "application/x-sh", "application/x-executable", "text/html", "application/javascript", "application/x-rar-compressed", "application/x-7z-compressed"];
const CATEGORIES: T.MediaCategory[] = ["PROJECT_OUTPUT", "PROJECT_REFERENCE"];

/* ------------------------------------------------------------------ helpers */

function getProject(db: MockDb, id: string): ProjectX {
  const p = db.projects.find((x) => x.id === id);
  if (!p) fail(404, "NOT_FOUND", "Project not found.");
  return p as ProjectX;
}

function canSeeProject(req: MockReq, p: T.Project): boolean {
  const v = visibleProjectIds(req.db, req.me);
  return v === "all" || v.has(p.id);
}

function canManageProject(req: MockReq, p: T.Project): boolean {
  const s = scopeOf(req.me, "project.manage");
  if (s === "organization") return true;
  return s === "team" && !!req.me.employee && p.managerId === req.me.employee.id;
}

function canManageTask(req: MockReq, t: T.Task): boolean {
  const s = scopeOf(req.me, "task.manage");
  if (s === "organization") return true;
  const p = req.db.projects.find((x) => x.id === t.projectId);
  return s === "team" && !!req.me.employee && p?.managerId === req.me.employee.id;
}

function getTask(req: MockReq, id: string): T.Task {
  const t = req.db.tasks.find((x) => x.id === id);
  // Invisible and absent records both return 404 (section 23).
  if (!t || !canSeeTask(req.db, req.me, t)) fail(404, "NOT_FOUND", "Task not found.");
  return t!;
}

function refreshCounts(db: MockDb) {
  for (const p of db.projects) {
    const ts = db.tasks.filter((t) => t.projectId === p.id);
    p.taskCounts = { total: ts.length, completed: ts.filter((t) => DONE_STATES.includes(t.state)).length };
  }
}

function addEvent(req: MockReq, task: T.Task, transition: string, from: T.TaskState | undefined, to: T.TaskState, reason?: string) {
  bump(task);
  req.db.taskEvents.push({
    id: uuid(), taskId: task.id, transition, actorId: req.me.employee?.id ?? req.me.user.id, fromState: from, toState: to,
    reason, occurredAt: nowIso(), resultingVersion: task.version,
  });
}

function ensureProjectWritable(p: T.Project) {
  if (p.state === "ARCHIVED") fail(422, "POLICY_BLOCKED", "This project is archived. Unarchive it before making changes.");
  if (p.state === "CANCELLED") fail(422, "POLICY_BLOCKED", "This project is cancelled.");
}

function activeEmployee(db: MockDb, id: string | undefined): T.Employee | undefined {
  return db.employees.find((e) => e.id === id && e.employmentStatus === "ACTIVE");
}

function predecessorsIncomplete(db: MockDb, t: T.Task): T.Task[] {
  return t.dependencyIds
    .map((id) => db.tasks.find((x) => x.id === id))
    .filter((x): x is T.Task => !!x && !DONE_STATES.includes(x.state) && x.state !== "CANCELLED");
}

function hasDependencyOverride(db: MockDb, t: T.Task): boolean {
  return db.taskEvents.some((e) => e.taskId === t.id && e.transition === "dependency_override");
}

/** True when `from` (transitively) depends on `target`. */
function dependsOn(db: MockDb, from: string, target: string, seen = new Set<string>()): boolean {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  const t = db.tasks.find((x) => x.id === from);
  return !!t?.dependencyIds.some((d) => dependsOn(db, d, target, seen));
}

function fakeSha(id: string) {
  let h = 0;
  for (const c of id) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  return (h.toString(16).padStart(8, "0") + "9f86d081884c7d659a2feaa0c55ad015").slice(0, 40);
}

/** Simulates the scan/transfer workers: SCANNING -> TRANSFERRING -> AVAILABLE over a few seconds. */
function advanceMedia(db: MockDb) {
  const now = Date.now();
  let changed = false;
  for (const m of db.media as MediaX[]) {
    if (m.state !== "SCANNING" && m.state !== "TRANSFERRING") continue;
    if (!m.scanStartedAt) {
      m.scanStartedAt = nowIso();
      changed = true;
      continue;
    }
    const el = now - Date.parse(m.scanStartedAt);
    if (m.state === "SCANNING" && el > 2500) {
      if (/eicar/i.test(m.name)) {
        m.state = "QUARANTINED";
        m.scanResult = "INFECTED";
        m.lastError = "Malware scan failed. The file was quarantined and cannot be submitted.";
        changed = true;
        continue;
      }
      m.state = "TRANSFERRING";
      m.scanResult = "CLEAN";
      m.progress = 0;
      changed = true;
    }
    if (m.state === "TRANSFERRING") {
      if (db.sim.driveUnavailable) {
        if (!m.lastError) changed = true;
        m.lastError = "Google Drive is unavailable. The transfer will resume automatically.";
        continue;
      }
      m.lastError = undefined;
      m.progress = Math.max(0, Math.min(1, (el - 2500) / 3000));
      changed = true;
      if (el > 5500) {
        m.state = "AVAILABLE";
        m.sha256 = fakeSha(m.id);
        m.progress = undefined;
      }
    }
  }
  if (changed) persist();
}

function taskPerms(req: MockReq, t: T.Task) {
  const { db, me } = req;
  const eid = me.employee?.id;
  const project = db.projects.find((p) => p.id === t.projectId);
  const manager = canManageTask(req, t);
  const assignee = !!eid && t.assigneeId === eid;
  const reviewer = !!eid && t.reviewerId === eid && can(me, "submission.review");
  const writable = project?.state !== "ARCHIVED" && project?.state !== "CANCELLED";
  const transitions: string[] = [];
  const depsBlocking = predecessorsIncomplete(db, t).length > 0 && !hasDependencyOverride(db, t);
  if (writable) {
    if (t.state === "DRAFT" && manager) transitions.push("assign");
    if (t.state === "ASSIGNED" && assignee) transitions.push("start");
    if (t.state === "ASSIGNED" && manager && depsBlocking) transitions.push("override_dependencies");
    if (["ASSIGNED", "IN_PROGRESS"].includes(t.state) && (assignee || manager)) transitions.push("block");
    if (t.state === "BLOCKED" && (assignee || manager)) transitions.push("unblock");
    if (t.state === "APPROVED" && manager) transitions.push("complete");
    if (["APPROVED", "COMPLETED"].includes(t.state) && manager) transitions.push("reopen");
    if (!TERMINAL.includes(t.state) && manager) transitions.push("cancel");
  }
  return {
    isManager: manager,
    isAssignee: assignee,
    isReviewer: reviewer,
    canEdit: manager && writable && !TERMINAL.includes(t.state),
    canSubmit: assignee && writable && ["IN_PROGRESS", "REVISION_REQUESTED"].includes(t.state),
    canReview: reviewer && t.state === "SUBMITTED" && t.assigneeId !== eid,
    canComment: writable && (assignee || manager || reviewer || !!project?.memberIds.includes(eid ?? "")),
    canLogWork: assignee && writable && !TERMINAL.includes(t.state),
    selfReviewBlocked: !!t.assigneeId && t.assigneeId === t.reviewerId,
    dependencyBlocked: depsBlocking,
    transitions,
  };
}

function submissionView(db: MockDb, s: T.Submission) {
  return { ...s, media: s.mediaIds.map((id) => db.media.find((m) => m.id === id)).filter(Boolean) as T.MediaAsset[] };
}

function taskRow(db: MockDb, t: T.Task) {
  const p = db.projects.find((x) => x.id === t.projectId);
  return { ...t, projectCode: p?.code ?? "", projectName: p?.name ?? "", dependencyBlocked: predecessorsIncomplete(db, t).length > 0 && !hasDependencyOverride(db, t) };
}

function validateAssignment(db: MockDb, t: Partial<T.Task>): Record<string, string> {
  const e: Record<string, string> = {};
  if (!t.projectId) e.projectId = "Choose a project.";
  if (!t.brief?.trim()) e.brief = "A brief is required before assignment.";
  if (!t.assigneeId) e.assigneeId = "Choose an accountable assignee.";
  else if (!activeEmployee(db, t.assigneeId)) e.assigneeId = "The assignee is not an active employee.";
  if (!t.reviewerId) e.reviewerId = "Choose a reviewer.";
  else if (!activeEmployee(db, t.reviewerId)) e.reviewerId = "The reviewer is not an active employee.";
  if (!(t.estimateMinutes && t.estimateMinutes > 0) && !t.noEstimateReason?.trim()) e.estimateMinutes = "Give an estimate or an approved no-estimate reason.";
  if (!t.acceptanceChecklist?.length) e.acceptanceChecklist = "Add at least one acceptance criterion.";
  return e;
}

function normalizeChecklist(raw: unknown): T.ChecklistItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x, i) => (typeof x === "string" ? { id: `c${i + 1}`, label: x } : { id: (x as T.ChecklistItem).id || `c${i + 1}`, label: String((x as T.ChecklistItem).label ?? "") }))
    .filter((x) => x.label.trim())
    .map((x) => ({ ...x, label: x.label.trim() }));
}

/* ------------------------------------------------------------------ projects */

const projectRoutes = [
  route("GET", "/projects", (req) => {
    const { db, query } = req;
    requirePerm(req.me, "project.read");
    refreshCounts(db);
    const vis = visibleProjectIds(db, req.me);
    const rows = db.projects
      .filter((p) => vis === "all" || vis.has(p.id))
      .filter((p) => !query.state || p.state === query.state)
      .filter((p) => !query.managerId || p.managerId === query.managerId)
      .filter((p) => matchesSearch(query.q, p.name, p.code, p.externalReference))
      .sort((a, b) => a.code.localeCompare(b.code));
    return paginate(rows, query);
  }),

  route("POST", "/projects", (req) => {
    const { db, body, me } = req;
    requirePerm(me, "project.manage");
    const e: Record<string, string> = {};
    const code = String(body.code ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{1,23}$/.test(code)) e.code = "Use 2–24 letters, digits or dashes.";
    else if (db.projects.some((p) => p.code === code)) e.code = "This code is already used in the organization.";
    if (!String(body.name ?? "").trim()) e.name = "A title is required.";
    if (!activeEmployee(db, body.managerId)) e.managerId = "Choose an active manager.";
    else if (scopeOf(me, "project.manage") === "team" && body.managerId !== me.employee?.id) e.managerId = "Team managers can only create projects they manage.";
    if (!body.plannedStart) e.plannedStart = "Target start date is required.";
    if (!body.plannedEnd) e.plannedEnd = "Target end date is required.";
    else if (body.plannedStart && body.plannedEnd < body.plannedStart) e.plannedEnd = "End date must be on or after the start date.";
    const memberIds: string[] = Array.isArray(body.memberIds) ? body.memberIds : [];
    if (memberIds.length === 0) e.memberIds = "Add at least one member.";
    if (memberIds.some((m) => !activeEmployee(db, m))) e.memberIds = "All members must be active employees.";
    if (Object.keys(e).length) validation(e);
    const now = nowIso();
    const p: T.Project = {
      id: uuid(), organizationId: db.organization.id, createdAt: now, updatedAt: now, version: 1,
      code, name: String(body.name).trim(), brief: body.brief?.trim() || undefined, externalReference: body.externalReference?.trim() || undefined,
      managerId: body.managerId, state: "DRAFT", plannedStart: body.plannedStart, plannedEnd: body.plannedEnd, memberIds, taskCounts: { total: 0, completed: 0 },
    };
    db.projects.push(p);
    audit(req, "project.create", "Project", p.id, { after: { code, name: p.name } });
    return p;
  }),

  route("GET", "/projects/:id", (req) => {
    const { db } = req;
    refreshCounts(db);
    advanceMedia(db);
    const p = getProject(db, req.params.id);
    if (!canSeeProject(req, p)) fail(404, "NOT_FOUND", "Project not found.");
    const tasks = db.tasks.filter((t) => t.projectId === p.id && canSeeTask(db, req.me, t)).map((t) => taskRow(db, t));
    const taskIds = new Set(tasks.map((t) => t.id));
    const activity = [
      ...db.taskEvents.filter((e) => taskIds.has(e.taskId)).map((e) => ({
        id: e.id, at: e.occurredAt, actorId: e.actorId, kind: "task" as const, taskId: e.taskId,
        title: `${tasks.find((t) => t.id === e.taskId)?.title}: ${e.fromState ? `${e.fromState} → ` : ""}${e.toState}`, reason: e.reason,
      })),
      ...db.audit.filter((a) => a.targetType === "Project" && a.targetId === p.id).map((a) => ({
        id: a.id, at: a.occurredAt, actorId: undefined as string | undefined, actorLabel: a.actorLabel, kind: "project" as const, taskId: undefined as string | undefined,
        title: a.action.replace("project.", "Project ").replace(/[._]/g, " "), reason: a.reason,
      })),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60);
    const deliverables = db.reviews
      .filter((r) => r.decision === "APPROVE" && taskIds.has(r.taskId))
      .map((r) => {
        const s = db.submissions.find((x) => x.id === r.submissionId)!;
        return { review: r, submission: submissionView(db, s), task: tasks.find((t) => t.id === r.taskId)! };
      })
      .sort((a, b) => b.review.decidedAt.localeCompare(a.review.decidedAt));
    const manage = canManageProject(req, p);
    const s = p.state;
    const transitions: string[] = [];
    if (manage) {
      if (s === "DRAFT" || s === "ON_HOLD") transitions.push("activate");
      if (s === "ACTIVE") transitions.push("hold", "complete");
      if (s === "COMPLETED") transitions.push("reopen");
      if (s === "COMPLETED" || s === "CANCELLED") transitions.push("archive");
      if (s === "ARCHIVED") transitions.push("unarchive");
      if (["DRAFT", "ACTIVE", "ON_HOLD"].includes(s)) transitions.push("cancel");
    }
    return { project: p, tasks, activity, deliverables, permissions: { canManage: manage && !["ARCHIVED", "CANCELLED"].includes(s), canCreateTask: manage && ["DRAFT", "ACTIVE", "ON_HOLD"].includes(s), transitions } };
  }),

  route("PATCH", "/projects/:id", (req) => {
    const { db, body } = req;
    const p = getProject(db, req.params.id);
    if (!canSeeProject(req, p)) fail(404, "NOT_FOUND", "Project not found.");
    if (!canManageProject(req, p)) fail(403, "FORBIDDEN", "Only the project manager can edit this project.");
    checkVersion(req, p);
    ensureProjectWritable(p);
    const e: Record<string, string> = {};
    if (body.name !== undefined && !String(body.name).trim()) e.name = "A title is required.";
    if (body.managerId !== undefined && !activeEmployee(db, body.managerId)) e.managerId = "Choose an active manager.";
    const start = body.plannedStart ?? p.plannedStart;
    const end = body.plannedEnd ?? p.plannedEnd;
    if (end < start) e.plannedEnd = "End date must be on or after the start date.";
    if (body.memberIds !== undefined && (!Array.isArray(body.memberIds) || body.memberIds.length === 0)) e.memberIds = "Add at least one member.";
    if (Object.keys(e).length) validation(e);
    const before = { name: p.name, managerId: p.managerId, plannedStart: p.plannedStart, plannedEnd: p.plannedEnd, memberIds: p.memberIds };
    for (const k of ["name", "brief", "externalReference", "managerId", "plannedStart", "plannedEnd", "memberIds"] as const) {
      if (body[k] !== undefined) (p as unknown as Record<string, unknown>)[k] = typeof body[k] === "string" ? body[k].trim() : body[k];
    }
    bump(p);
    audit(req, "project.update", "Project", p.id, { before, after: { name: p.name, managerId: p.managerId, plannedStart: p.plannedStart, plannedEnd: p.plannedEnd, memberIds: p.memberIds } });
    return p;
  }),

  route("POST", "/projects/:id/transitions", (req) => {
    const { db, body } = req;
    const p = getProject(db, req.params.id);
    if (!canSeeProject(req, p)) fail(404, "NOT_FOUND", "Project not found.");
    if (!canManageProject(req, p)) fail(403, "FORBIDDEN", "Only the project manager can change project state.");
    checkVersion(req, p);
    const action = String(body.action ?? "");
    const reason = String(body.reason ?? "").trim();
    const from = p.state;
    const bad = () => fail(409, "INVALID_TRANSITION", `Cannot ${action} a project that is ${from.toLowerCase().replace("_", " ")}.`, { latest: p });
    const needReason = () => {
      if (reason.length < 3) validation({ reason: "A reason is required." }, "A reason is required for this change.");
    };
    const tasks = db.tasks.filter((t) => t.projectId === p.id);
    switch (action) {
      case "activate":
        if (from !== "DRAFT" && from !== "ON_HOLD") bad();
        p.state = "ACTIVE";
        break;
      case "hold":
        if (from !== "ACTIVE") bad();
        needReason();
        p.state = "ON_HOLD";
        break;
      case "complete": {
        if (from !== "ACTIVE") bad();
        const open = tasks.filter((t) => !TERMINAL.includes(t.state));
        const pendingReview = tasks.filter((t) => t.state === "SUBMITTED");
        const pendingTransfers = db.submissions
          .filter((s) => tasks.some((t) => t.id === s.taskId) && s.state === "DRAFT")
          .flatMap((s) => s.mediaIds)
          .filter((m) => ["INITIATED", "RECEIVING", "SCANNING", "TRANSFERRING"].includes(db.media.find((x) => x.id === m)?.state ?? ""));
        if (open.length || pendingReview.length || pendingTransfers.length) {
          fail(422, "POLICY_BLOCKED", `Completion is blocked: ${open.length} task(s) not completed or cancelled, ${pendingReview.length} pending review(s), ${pendingTransfers.length} pending transfer(s).`);
        }
        p.state = "COMPLETED";
        break;
      }
      case "reopen":
        if (from !== "COMPLETED") bad();
        needReason();
        p.state = "ACTIVE";
        break;
      case "archive":
        if (from !== "COMPLETED" && from !== "CANCELLED") bad();
        p.stateBeforeArchive = from;
        p.state = "ARCHIVED";
        p.archivedAt = nowIso();
        break;
      case "unarchive":
        if (from !== "ARCHIVED") bad();
        needReason();
        p.state = p.stateBeforeArchive ?? "COMPLETED";
        p.archivedAt = undefined;
        break;
      case "cancel":
        if (!["DRAFT", "ACTIVE", "ON_HOLD"].includes(from)) bad();
        if (from !== "DRAFT") needReason();
        p.state = "CANCELLED";
        break;
      default:
        fail(400, "VALIDATION_ERROR", "Unknown transition.");
    }
    bump(p);
    audit(req, `project.${action}`, "Project", p.id, { reason: reason || undefined, before: { state: from }, after: { state: p.state } });
    return p;
  }),
];

/* ------------------------------------------------------------------ tasks */

const taskRoutes = [
  route("GET", "/tasks", (req) => {
    const { db, query, me } = req;
    requirePerm(me, "task.read");
    const now = Date.now();
    let rows = db.tasks.filter((t) => canSeeTask(db, me, t));
    if (query.mine === "1") rows = rows.filter((t) => t.assigneeId === me.employee?.id);
    if (query.projectId) rows = rows.filter((t) => t.projectId === query.projectId);
    if (query.assigneeId) rows = rows.filter((t) => t.assigneeId === query.assigneeId);
    if (query.reviewerId) rows = rows.filter((t) => t.reviewerId === query.reviewerId);
    if (query.state) {
      const states = query.state.split(",");
      rows = rows.filter((t) => states.includes(t.state));
    } else if (query.includeClosed !== "1") rows = rows.filter((t) => t.state !== "CANCELLED");
    if (query.priority) rows = rows.filter((t) => t.priority === query.priority);
    if (query.dueFrom) rows = rows.filter((t) => t.dueAt >= query.dueFrom);
    if (query.dueTo) rows = rows.filter((t) => t.dueAt <= `${query.dueTo}T23:59:59Z`);
    if (query.overdue === "1") rows = rows.filter((t) => !TERMINAL.includes(t.state) && !DONE_STATES.includes(t.state) && t.state !== "SUBMITTED" && Date.parse(t.dueAt) < now);
    if (query.q) rows = rows.filter((t) => matchesSearch(query.q, t.title, t.brief));
    const prio: Record<T.Priority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    rows.sort((a, b) => (query.sort === "priority" ? prio[a.priority] - prio[b.priority] : 0) || a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id));
    const page = paginate(rows, { ...query, limit: query.limit ?? "100" });
    return { ...page, items: page.items.map((t) => taskRow(db, t)), total: rows.length };
  }),

  route("POST", "/tasks", (req) => {
    const { db, body, me } = req;
    requirePerm(me, "task.manage");
    const project = db.projects.find((p) => p.id === body.projectId);
    if (!project || !canSeeProject(req, project)) validation({ projectId: "Choose a project you manage." });
    if (!canManageProject(req, project!)) fail(403, "FORBIDDEN", "You can only create tasks in projects you manage.");
    ensureProjectWritable(project!);
    const e: Record<string, string> = {};
    if (!String(body.title ?? "").trim()) e.title = "A title is required.";
    if (!body.dueAt || Number.isNaN(Date.parse(body.dueAt))) e.dueAt = "A due date and time is required.";
    const pts = String(body.baselinePoints ?? "");
    if (!/^\d+(\.\d{1,2})?$/.test(pts)) e.baselinePoints = "Planned output points must be a number with up to 2 decimals.";
    if (body.assigneeId && !activeEmployee(db, body.assigneeId)) e.assigneeId = "Assignment to an inactive employee is rejected.";
    if (body.reviewerId && !activeEmployee(db, body.reviewerId)) e.reviewerId = "The reviewer is not an active employee.";
    const deps: string[] = Array.isArray(body.dependencyIds) ? body.dependencyIds : [];
    if (deps.some((d) => !db.tasks.some((t) => t.id === d))) e.dependencyIds = "Unknown predecessor task.";
    const checklist = normalizeChecklist(body.acceptanceChecklist);
    const draft: Partial<T.Task> = {
      projectId: body.projectId, brief: body.brief, assigneeId: body.assigneeId || undefined, reviewerId: body.reviewerId || undefined,
      estimateMinutes: body.estimateMinutes ? Number(body.estimateMinutes) : undefined, noEstimateReason: body.noEstimateReason, acceptanceChecklist: checklist,
    };
    const assignNow = !!body.assignNow;
    if (assignNow) Object.assign(e, validateAssignment(db, draft));
    if (Object.keys(e).length) validation(e);
    const now = nowIso();
    const t: T.Task = {
      id: uuid(), organizationId: db.organization.id, createdAt: now, updatedAt: now, version: 1,
      projectId: project!.id, title: String(body.title).trim(), brief: String(body.brief ?? "").trim(), acceptanceChecklist: checklist,
      assigneeId: draft.assigneeId, reviewerId: draft.reviewerId, state: "DRAFT", priority: (body.priority as T.Priority) || "MEDIUM",
      baselinePoints: Number(pts).toFixed(2), estimateMinutes: draft.estimateMinutes, noEstimateReason: body.noEstimateReason?.trim() || undefined,
      baselineDueAt: new Date(body.dueAt).toISOString(), dueAt: new Date(body.dueAt).toISOString(), baselineVersion: 1, rubricVersion: RUBRIC_V1.version, dependencyIds: deps,
    };
    db.tasks.push(t);
    db.taskEvents.push({ id: uuid(), taskId: t.id, transition: "create", actorId: me.employee?.id ?? me.user.id, toState: "DRAFT", occurredAt: now, resultingVersion: 1 });
    if (assignNow) {
      t.state = "ASSIGNED";
      addEvent(req, t, "assign", "DRAFT", "ASSIGNED");
      notifyEmployee(db, t.assigneeId, { kind: "ASSIGNMENT", title: `New task: ${t.title}`, body: `${me.employee?.displayName ?? "A manager"} assigned you a task.`, href: `/tasks/${t.id}` });
    }
    audit(req, "task.create", "Task", t.id, { after: { title: t.title, state: t.state } });
    return { id: t.id, state: t.state, version: t.version };
  }),

  route("GET", "/tasks/:id", (req) => {
    const { db } = req;
    advanceMedia(db);
    const t = getTask(req, req.params.id);
    const project = db.projects.find((p) => p.id === t.projectId)!;
    const subs = db.submissions.filter((s) => s.taskId === t.id).sort((a, b) => b.sequence - a.sequence);
    const perms = taskPerms(req, t);
    // Draft submissions are visible to their author and the managers only.
    const visibleSubs = subs.filter((s) => s.state !== "DRAFT" || s.authorId === req.me.employee?.id || perms.isManager);
    const dep = (id: string) => {
      const d = db.tasks.find((x) => x.id === id);
      return d ? { id: d.id, title: d.title, state: d.state, visible: canSeeTask(db, req.me, d) } : null;
    };
    return {
      task: t,
      project: { id: project.id, code: project.code, name: project.name, state: project.state, managerId: project.managerId, memberIds: project.memberIds },
      events: db.taskEvents.filter((e) => e.taskId === t.id).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
      comments: db.comments.filter((c) => c.taskId === t.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      submissions: visibleSubs.map((s) => submissionView(db, s)),
      reviews: db.reviews.filter((r) => r.taskId === t.id).sort((a, b) => b.decidedAt.localeCompare(a.decidedAt)),
      predecessors: t.dependencyIds.map(dep).filter(Boolean),
      successors: db.tasks.filter((x) => x.dependencyIds.includes(t.id)).map((x) => dep(x.id)).filter(Boolean),
      workLogs: db.workLogs.filter((w) => w.taskId === t.id && (perms.isManager || w.employeeId === req.me.employee?.id)).sort((a, b) => b.businessDate.localeCompare(a.businessDate)),
      audit: db.audit.filter((a) => a.targetType === "Task" && a.targetId === t.id).slice(0, 30),
      permissions: perms,
    };
  }),

  route("PATCH", "/tasks/:id", (req) => {
    const { db, body, me } = req;
    const t = getTask(req, req.params.id);
    if (!canManageTask(req, t)) fail(403, "FORBIDDEN", "Only the project manager can edit this task.");
    checkVersion(req, t);
    ensureProjectWritable(db.projects.find((p) => p.id === t.projectId)!);
    if (TERMINAL.includes(t.state)) fail(409, "INVALID_TRANSITION", "Completed or cancelled tasks cannot be edited.", { latest: t });
    const reason = String(body.reason ?? "").trim();
    const hasSubmission = db.submissions.some((s) => s.taskId === t.id && s.state !== "DRAFT");
    const e: Record<string, string> = {};
    if (body.title !== undefined && !String(body.title).trim()) e.title = "A title is required.";
    if (body.assigneeId !== undefined && body.assigneeId && !activeEmployee(db, body.assigneeId)) e.assigneeId = "Assignment to an inactive employee is rejected.";
    if (body.reviewerId !== undefined && body.reviewerId && !activeEmployee(db, body.reviewerId)) e.reviewerId = "The reviewer is not an active employee.";
    if (body.baselinePoints !== undefined && !/^\d+(\.\d{1,2})?$/.test(String(body.baselinePoints))) e.baselinePoints = "Enter a number with up to 2 decimals.";
    const pointsChange = body.baselinePoints !== undefined && Number(body.baselinePoints).toFixed(2) !== t.baselinePoints;
    const dueChange = body.dueAt !== undefined && new Date(body.dueAt).toISOString() !== t.dueAt;
    const assigneeChange = body.assigneeId !== undefined && (body.assigneeId || undefined) !== t.assigneeId;
    const reviewerChange = body.reviewerId !== undefined && (body.reviewerId || undefined) !== t.reviewerId;
    if (pointsChange && t.state !== "DRAFT" && t.actualStartAt && reason.length < 3) e.reason = "Changing planned output points after work begins requires a reason.";
    if (dueChange && t.state !== "DRAFT" && reason.length < 3) e.reason = "Deadline changes require a reason.";
    if ((assigneeChange || reviewerChange) && t.state !== "DRAFT" && reason.length < 3) e.reason = "Reassignment requires a reason.";
    if (t.state !== "DRAFT" && assigneeChange && !body.assigneeId) e.assigneeId = "An assigned task must keep an accountable assignee.";
    if (Object.keys(e).length) validation(e);

    const before = { title: t.title, assigneeId: t.assigneeId, reviewerId: t.reviewerId, dueAt: t.dueAt, baselinePoints: t.baselinePoints, priority: t.priority };
    if (body.title !== undefined) t.title = String(body.title).trim();
    if (body.brief !== undefined) t.brief = String(body.brief).trim();
    if (body.acceptanceChecklist !== undefined) {
      if (t.state !== "DRAFT" && hasSubmission) validation({ acceptanceChecklist: "Acceptance criteria are frozen once work has been submitted." });
      t.acceptanceChecklist = normalizeChecklist(body.acceptanceChecklist);
    }
    if (body.priority !== undefined) t.priority = body.priority;
    if (body.estimateMinutes !== undefined) t.estimateMinutes = body.estimateMinutes ? Number(body.estimateMinutes) : undefined;
    if (body.noEstimateReason !== undefined) t.noEstimateReason = body.noEstimateReason?.trim() || undefined;
    const prevAssignee = t.assigneeId;
    if (assigneeChange) t.assigneeId = body.assigneeId || undefined;
    if (reviewerChange) t.reviewerId = body.reviewerId || undefined;
    if (dueChange) {
      t.dueAt = new Date(body.dueAt).toISOString();
      if (t.state === "DRAFT") t.baselineDueAt = t.dueAt;
    }
    if (pointsChange) {
      t.baselinePoints = Number(body.baselinePoints).toFixed(2);
      if (t.state !== "DRAFT") t.baselineVersion += 1;
    }
    if (body.baselineDueChange && dueChange && t.state !== "DRAFT") {
      t.baselineDueAt = t.dueAt;
      t.baselineVersion += 1;
    }
    addEvent(req, t, assigneeChange ? "reassign" : reviewerChange ? "reassign_reviewer" : pointsChange || dueChange ? "baseline_revision" : "edit", t.state, t.state, reason || undefined);
    if (assigneeChange && t.assigneeId && t.state !== "DRAFT") {
      notifyEmployee(db, t.assigneeId, { kind: "ASSIGNMENT", title: `Task reassigned to you: ${t.title}`, body: reason, href: `/tasks/${t.id}` });
      notifyEmployee(db, prevAssignee, { kind: "ASSIGNMENT", title: `Task reassigned: ${t.title}`, body: "Your prior time and submissions stay attributed to you.", href: `/tasks/${t.id}` });
    }
    if (reviewerChange && t.reviewerId && t.state === "SUBMITTED") notifyEmployee(db, t.reviewerId, { kind: "ASSIGNMENT", title: `Review assigned: ${t.title}`, body: reason, href: `/tasks/${t.id}/review` });
    audit(req, reviewerChange ? "task.reviewer.reassign" : assigneeChange ? "task.reassign" : "task.update", "Task", t.id, {
      reason: reason || undefined, before, after: { title: t.title, assigneeId: t.assigneeId, reviewerId: t.reviewerId, dueAt: t.dueAt, baselinePoints: t.baselinePoints, priority: t.priority },
    });
    void me;
    return t;
  }),

  route("POST", "/tasks/:id/transitions", (req) => {
    const { db, body, me } = req;
    const t = getTask(req, req.params.id);
    checkVersion(req, t);
    const perms = taskPerms(req, t);
    const action = String(body.action ?? "");
    const reason = String(body.reason ?? "").trim();
    if (!perms.transitions.includes(action)) {
      const allowedSomewhere = ["assign", "start", "block", "unblock", "complete", "cancel", "reopen", "override_dependencies"].includes(action);
      if (!allowedSomewhere) fail(400, "VALIDATION_ERROR", "Unknown transition.");
      if (perms.isManager || perms.isAssignee) fail(409, "INVALID_TRANSITION", `This task can't ${action.replace("_", " ")} from ${t.state.toLowerCase().replace("_", " ")}.`, { latest: t });
      fail(403, "FORBIDDEN", "You can't perform this transition on this task.");
    }
    const from = t.state;
    const needReason = (msg = "A reason is required.") => {
      if (reason.length < 3) validation({ reason: msg }, msg);
    };
    switch (action) {
      case "assign": {
        const e = validateAssignment(db, t);
        if (Object.keys(e).length) validation(e, "Complete the required fields before assignment.");
        t.state = "ASSIGNED";
        addEvent(req, t, "assign", from, "ASSIGNED");
        notifyEmployee(db, t.assigneeId, { kind: "ASSIGNMENT", title: `New task: ${t.title}`, body: `${me.employee?.displayName ?? "A manager"} assigned you a task.`, href: `/tasks/${t.id}` });
        break;
      }
      case "override_dependencies":
        needReason("Record why work may start before predecessors are complete.");
        addEvent(req, t, "dependency_override", from, from, reason);
        break;
      case "start": {
        const open = predecessorsIncomplete(db, t);
        if (open.length && !hasDependencyOverride(db, t)) {
          fail(422, "POLICY_BLOCKED", `Blocked by ${open.length} incomplete predecessor(s): ${open.map((x) => x.title).join(", ")}. Ask your manager for an override.`);
        }
        t.state = "IN_PROGRESS";
        t.actualStartAt = nowIso();
        addEvent(req, t, "start", from, "IN_PROGRESS");
        break;
      }
      case "block": {
        needReason("Describe the blocker.");
        const party = String(body.responsibleParty ?? "").trim();
        if (!party) validation({ responsibleParty: "Name who is responsible for unblocking." });
        t.resumeState = from;
        t.blocker = { reason, responsibleParty: party };
        t.state = "BLOCKED";
        addEvent(req, t, "block", from, "BLOCKED", `${reason} (responsible: ${party})`);
        if (perms.isAssignee) {
          const p = db.projects.find((x) => x.id === t.projectId);
          notifyEmployee(db, p?.managerId, { kind: "ASSIGNMENT", title: `Task blocked: ${t.title}`, body: reason, href: `/tasks/${t.id}` });
        }
        break;
      }
      case "unblock":
        t.state = t.resumeState ?? "IN_PROGRESS";
        t.blocker = undefined;
        t.resumeState = undefined;
        addEvent(req, t, "unblock", from, t.state, reason || undefined);
        break;
      case "complete": {
        const pendingUploads = db.submissions.filter((s) => s.taskId === t.id && s.state === "DRAFT" && s.mediaIds.length).length;
        if (pendingUploads) fail(422, "POLICY_BLOCKED", "A draft submission with files is still open. Clear it before closing the task.");
        t.state = "COMPLETED";
        addEvent(req, t, "complete", from, "COMPLETED", reason || undefined);
        break;
      }
      case "cancel": {
        needReason("Cancellation requires a reason.");
        const credit = String(body.creditDisposition ?? "NO_CREDIT");
        // Pending upload cleanup: draft media is expired, never history-deleted.
        for (const s of db.submissions.filter((x) => x.taskId === t.id && x.state === "DRAFT")) {
          for (const mid of s.mediaIds) {
            const m = db.media.find((x) => x.id === mid);
            if (m && m.state !== "AVAILABLE") m.state = "EXPIRED";
          }
        }
        t.state = "CANCELLED";
        addEvent(req, t, "cancel", from, "CANCELLED", `${reason} (credit: ${credit.toLowerCase().replace(/_/g, " ")})`);
        notifyEmployee(db, t.assigneeId, { kind: "ASSIGNMENT", title: `Task cancelled: ${t.title}`, body: reason, href: `/tasks/${t.id}` });
        break;
      }
      case "reopen":
        needReason("Reopening approved work requires a reason.");
        t.state = "REVISION_REQUESTED";
        addEvent(req, t, "reopen", from, "REVISION_REQUESTED", `${reason} — score/payroll impact review triggered`);
        notifyEmployee(db, t.assigneeId, { kind: "REVISION", title: `Reopened: ${t.title}`, body: reason, href: `/tasks/${t.id}` });
        break;
    }
    audit(req, `task.transition.${action}`, "Task", t.id, { reason: reason || undefined, before: { state: from }, after: { state: t.state } });
    return t;
  }),

  route("POST", "/tasks/:id/dependencies", (req) => {
    const { db, body } = req;
    const t = getTask(req, req.params.id);
    if (!canManageTask(req, t)) fail(403, "FORBIDDEN", "Only the project manager can change dependencies.");
    checkVersion(req, t);
    const pred = String(body.predecessorId ?? "");
    if (pred === t.id) validation({ predecessorId: "A task cannot depend on itself." });
    const p = db.tasks.find((x) => x.id === pred);
    if (!p || p.organizationId !== t.organizationId) validation({ predecessorId: "Unknown task." });
    if (t.dependencyIds.includes(pred)) validation({ predecessorId: "This dependency already exists." });
    if (dependsOn(db, pred, t.id)) validation({ predecessorId: "This would create a dependency cycle." });
    t.dependencyIds.push(pred);
    addEvent(req, t, "dependency_add", t.state, t.state, `Depends on ${p!.title}`);
    audit(req, "task.dependency.add", "Task", t.id, { after: { predecessorId: pred } });
    return t;
  }),

  route("DELETE", "/tasks/:id/dependencies/:pred", (req) => {
    const t = getTask(req, req.params.id);
    if (!canManageTask(req, t)) fail(403, "FORBIDDEN", "Only the project manager can change dependencies.");
    checkVersion(req, t);
    t.dependencyIds = t.dependencyIds.filter((d) => d !== req.params.pred);
    addEvent(req, t, "dependency_remove", t.state, t.state);
    audit(req, "task.dependency.remove", "Task", t.id, { before: { predecessorId: req.params.pred } });
    return t;
  }),

  route("POST", "/tasks/:id/comments", (req) => {
    const { db, body, me } = req;
    const t = getTask(req, req.params.id);
    if (!taskPerms(req, t).canComment) fail(403, "FORBIDDEN", "You can't comment on this task.");
    const text = String(body.body ?? "").trim();
    if (!text) validation({ body: "Write a comment." });
    if (text.length > 4000) validation({ body: "Comments are limited to 4000 characters." });
    const c: T.TaskComment = { id: uuid(), taskId: t.id, authorId: me.employee?.id ?? me.user.id, body: text, createdAt: nowIso(), anchor: body.anchor?.submissionId ? body.anchor : undefined };
    db.comments.push(c);
    const target = me.employee?.id === t.assigneeId ? t.reviewerId : t.assigneeId;
    notifyEmployee(db, target, { kind: "ASSIGNMENT", title: `New comment on ${t.title}`, body: text.slice(0, 120), href: `/tasks/${t.id}` });
    return c;
  }),
];

/* ------------------------------------------------------------------ submissions & reviews */

const submissionRoutes = [
  /** Create or return the editable draft for the next version. */
  route("POST", "/tasks/:id/submissions", (req) => {
    const { db, me } = req;
    const t = getTask(req, req.params.id);
    if (!taskPerms(req, t).canSubmit) fail(403, "FORBIDDEN", "Only the assignee can prepare a submission while the task is in progress or awaiting revision.");
    const existing = db.submissions.find((s) => s.taskId === t.id && s.state === "DRAFT");
    if (existing) return submissionView(db, existing);
    const seq = Math.max(0, ...db.submissions.filter((s) => s.taskId === t.id).map((s) => s.sequence)) + 1;
    // Reuse unchanged files from the previous version by immutable reference.
    const prev = db.submissions.filter((s) => s.taskId === t.id && s.state !== "DRAFT").sort((a, b) => b.sequence - a.sequence)[0];
    const s: T.Submission = { id: uuid(), taskId: t.id, sequence: seq, authorId: me.employee!.id, summary: "", state: "DRAFT", mediaIds: [], workLogIds: [] };
    db.submissions.push(s);
    return { ...submissionView(db, s), previousMedia: prev ? submissionView(db, prev).media : [] };
  }),

  route("PATCH", "/submissions/:id", (req) => {
    const { db, body, me } = req;
    const s = db.submissions.find((x) => x.id === req.params.id);
    if (!s || s.authorId !== me.employee?.id) fail(404, "NOT_FOUND", "Submission not found.");
    if (s!.state !== "DRAFT") fail(409, "INVALID_TRANSITION", "Submitted versions are immutable.");
    if (body.summary !== undefined) s!.summary = String(body.summary).slice(0, 5000);
    if (Array.isArray(body.removeMediaIds)) s!.mediaIds = s!.mediaIds.filter((m) => !body.removeMediaIds.includes(m));
    if (Array.isArray(body.reuseMediaIds)) {
      const allowed = new Set(db.submissions.filter((x) => x.taskId === s!.taskId).flatMap((x) => x.mediaIds));
      for (const m of body.reuseMediaIds) if (allowed.has(m) && !s!.mediaIds.includes(m)) s!.mediaIds.push(m);
    }
    if (Array.isArray(body.workLogIds)) s!.workLogIds = body.workLogIds;
    return submissionView(db, s!);
  }),

  route("POST", "/submissions/:id/submit", (req) => {
    const { db, body, me } = req;
    advanceMedia(db);
    const s = db.submissions.find((x) => x.id === req.params.id);
    if (!s || s.authorId !== me.employee?.id) fail(404, "NOT_FOUND", "Submission not found.");
    const t = getTask(req, s!.taskId);
    checkVersion(req, t);
    if (s!.state !== "DRAFT") fail(409, "INVALID_TRANSITION", "This version was already submitted.");
    if (!["IN_PROGRESS", "REVISION_REQUESTED"].includes(t.state)) fail(409, "INVALID_TRANSITION", "The task isn't accepting submissions right now.", { latest: t });
    const summary = String(body.summary ?? s!.summary ?? "").trim();
    const e: Record<string, string> = {};
    if (summary.length < 10) e.summary = "Describe the delivered work (at least 10 characters).";
    const media = s!.mediaIds.map((id) => db.media.find((m) => m.id === id));
    if (media.length === 0) e.files = "Attach at least one file.";
    const notReady = media.filter((m) => !m || m.state !== "AVAILABLE");
    if (notReady.length) e.files = `${notReady.length} file(s) are not available yet. Wait for scanning and transfer to finish.`;
    if (Object.keys(e).length) validation(e, "The submission isn't ready yet.");
    for (const prev of db.submissions.filter((x) => x.taskId === t.id && x.state === "SUBMITTED")) prev.state = "SUPERSEDED";
    s!.summary = summary;
    s!.state = "SUBMITTED";
    s!.submittedAt = nowIso();
    s!.frozenAt = s!.submittedAt;
    const from = t.state;
    t.state = "SUBMITTED";
    addEvent(req, t, "submit", from, "SUBMITTED", `Version ${s!.sequence}`);
    notifyEmployee(db, t.reviewerId, { kind: "ASSIGNMENT", title: `Review waiting: ${t.title}`, body: `${me.employee?.displayName} submitted v${s!.sequence}.`, href: `/tasks/${t.id}/review` });
    audit(req, "submission.submit", "Submission", s!.id, { after: { taskId: t.id, sequence: s!.sequence } });
    return { submission: submissionView(db, s!), task: t };
  }),

  route("POST", "/submissions/:id/reviews", (req) => {
    const { db, body, me } = req;
    const s = db.submissions.find((x) => x.id === req.params.id);
    if (!s) fail(404, "NOT_FOUND", "Submission not found.");
    const t = getTask(req, s!.taskId);
    // Locks task (single-threaded mock), verifies version, role and state, then writes everything or nothing.
    if (req.ifMatch === undefined && body.taskVersion !== undefined) req.ifMatch = Number(body.taskVersion);
    checkVersion(req, t);
    requirePerm(me, "submission.review");
    if (t.reviewerId !== me.employee?.id) fail(403, "FORBIDDEN", "Only the assigned reviewer can decide on this submission.");
    if (s!.authorId === me.employee?.id || t.assigneeId === me.employee?.id) fail(403, "FORBIDDEN", "You cannot review your own work. Ask the manager to reassign the review.");
    if (t.state !== "SUBMITTED") fail(409, "INVALID_TRANSITION", "This task is not awaiting review.", { latest: t });
    if (s!.state !== "SUBMITTED") fail(409, "INVALID_TRANSITION", "Only the latest submitted version can be reviewed.", { latest: t });
    if (db.reviews.some((r) => r.submissionId === s!.id)) fail(409, "INVALID_TRANSITION", "A decision already exists for this version.", { latest: t });
    const decision = body.decision as T.ReviewDecisionKind;
    if (decision !== "APPROVE" && decision !== "REQUEST_REVISION") validation({ decision: "Choose approve or request revision." });
    const checklist: Record<string, boolean> = {};
    for (const c of t.acceptanceChecklist) checklist[c.id] = !!body.checklist?.[c.id];
    const feedback = String(body.feedback ?? "").trim();
    const e: Record<string, string> = {};
    let quality: string | undefined;
    let scores: T.RubricScores | undefined;
    if (decision === "APPROVE") {
      const missing = s!.mediaIds.map((m) => db.media.find((x) => x.id === m)).filter((m) => !m || m.state !== "AVAILABLE");
      if (missing.length) fail(422, "POLICY_BLOCKED", "Some submitted media is unavailable or quarantined. Approval is blocked until it is resolved.");
      if (Object.values(checklist).some((v) => !v)) e.checklist = "All acceptance criteria must be met to approve.";
      if (Number(body.rubricVersion ?? t.rubricVersion) !== t.rubricVersion) e.rubric = `This task uses rubric v${t.rubricVersion}.`;
      const sc = body.scores ?? {};
      scores = { brief: Number(sc.brief), technical: Number(sc.technical), presentation: Number(sc.presentation), organization: Number(sc.organization) };
      if (Object.values(scores).some((v) => !Number.isInteger(v) || v < 0 || v > 100)) e.rubric = "Score every rubric item with a whole number 0–100.";
      else {
        const ce = rubricCommentErrors(scores, body.rubricComments ?? {});
        for (const [k, v] of Object.entries(ce)) e[`rubric.${k}`] = v!;
        quality = weightedQuality(scores);
      }
    } else if (feedback.length < 10) e.feedback = "Give actionable feedback (at least 10 characters).";
    if (Object.keys(e).length) validation(e, "The review is incomplete.");
    const r: T.ReviewDecision = {
      id: uuid(), submissionId: s!.id, taskId: t.id, reviewerId: me.employee!.id, decision, rejected: decision === "REQUEST_REVISION" && !!body.rejected,
      checklist, rubricScores: scores, rubricComments: decision === "APPROVE" ? body.rubricComments : undefined, rubricVersion: t.rubricVersion,
      weightedQuality: quality, feedback: feedback || (decision === "APPROVE" ? "Approved." : ""), decidedAt: nowIso(),
    };
    db.reviews.push(r);
    const from = t.state;
    if (decision === "APPROVE") {
      t.state = "APPROVED";
      addEvent(req, t, "approve", from, "APPROVED", `v${s!.sequence} approved (quality ${quality})`);
      notifyEmployee(db, t.assigneeId, { kind: "REVIEW_APPROVED", title: `${t.title} approved`, body: `${me.employee?.displayName} approved v${s!.sequence} (quality ${quality}).`, href: `/tasks/${t.id}` });
    } else {
      t.state = "REVISION_REQUESTED";
      addEvent(req, t, "request_revision", from, "REVISION_REQUESTED", feedback);
      notifyEmployee(db, t.assigneeId, { kind: "REVISION", title: `Revision requested: ${t.title}`, body: `${me.employee?.displayName} requested changes on v${s!.sequence}.`, href: `/tasks/${t.id}` });
    }
    audit(req, decision === "APPROVE" ? "submission.review.approve" : "submission.review.request_revision", "Submission", s!.id, { after: { decision, quality, taskVersion: t.version } });
    return { reviewId: r.id, taskState: t.state, taskVersion: t.version, quality };
  }),

  route("GET", "/reviews", (req) => {
    const { db, me, query } = req;
    const eid = me.employee?.id;
    const team = query.scope === "team" && (scopeOf(me, "task.manage") !== null);
    const rows = db.tasks
      .filter((t) => t.state === "SUBMITTED" && canSeeTask(db, me, t))
      .filter((t) => (team ? canManageTask(req, t) : t.reviewerId === eid))
      .map((t) => {
        const sub = db.submissions.filter((s) => s.taskId === t.id && s.state === "SUBMITTED").sort((a, b) => b.sequence - a.sequence)[0];
        return { task: taskRow(db, t), submission: sub ? submissionView(db, sub) : undefined, selfReview: t.assigneeId === t.reviewerId, priorDecisions: db.reviews.filter((r) => r.taskId === t.id).length };
      })
      .sort((a, b) => (a.submission?.submittedAt ?? "").localeCompare(b.submission?.submittedAt ?? ""));
    const recent = db.reviews.filter((r) => r.reviewerId === eid).sort((a, b) => b.decidedAt.localeCompare(a.decidedAt)).slice(0, 10)
      .map((r) => ({ review: r, taskTitle: db.tasks.find((t) => t.id === r.taskId)?.title ?? "", sequence: db.submissions.find((s) => s.id === r.submissionId)?.sequence ?? 0 }));
    return { items: rows, recent, canSeeTeam: scopeOf(me, "task.manage") !== null };
  }),
];

/* ------------------------------------------------------------------ uploads & media */

const uploadRoutes = [
  route("POST", "/uploads", (req) => {
    const { db, body, me } = req;
    if (!me.employee) fail(403, "FORBIDDEN", "Only employees can upload work files.");
    const e: Record<string, string> = {};
    const name = String(body.name ?? "").trim();
    const size = Number(body.sizeBytes);
    const mime = String(body.mimeType ?? "application/octet-stream");
    const category = body.category as T.MediaCategory;
    if (!CATEGORIES.includes(category)) e.category = "Unsupported upload category.";
    if (!name || /[\\/]/.test(name)) e.name = "Invalid file name.";
    if (!Number.isFinite(size) || size <= 0) e.sizeBytes = "Empty files can't be uploaded.";
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    if (BLOCKED_EXT.includes(ext) || BLOCKED_MIME.includes(mime)) e.name = `.${ext} files are blocked (executables, active content and unapproved archive types). Use .zip for archives.`;
    if (Object.keys(e).length) validation(e, e.name ?? "The file can't be uploaded.");
    if (size > MAX_FILE_BYTES) fail(413, "FILE_TOO_LARGE", "Files are limited to 10 GiB each.");
    const sub = db.submissions.find((s) => s.id === body.submissionDraftId);
    if (!sub || sub.authorId !== me.employee!.id || sub.state !== "DRAFT") fail(404, "NOT_FOUND", "Submission draft not found.");
    if (sub!.taskId !== body.taskId) validation({ taskId: "The draft does not belong to this task." });
    const t = getTask(req, sub!.taskId);
    if (!taskPerms(req, t).canSubmit) fail(403, "FORBIDDEN", "This task isn't accepting uploads from you right now.");
    const active = (db.media as MediaX[]).filter((m) => m.uploaderId === me.employee!.id && ["INITIATED", "RECEIVING"].includes(m.state));
    if (active.length >= 2) fail(429, "RATE_LIMITED", "You already have two uploads in progress. Wait for one to finish.", { retryable: true });
    const m: MediaX = {
      id: uuid(), category, name, mimeType: mime, sizeBytes: size, state: "INITIATED", scanResult: "PENDING", uploaderId: me.employee!.id,
      createdAt: nowIso(), progress: 0, submissionId: sub!.id, taskId: t.id, receivedBytes: 0, expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
    };
    db.media.push(m);
    sub!.mediaIds.push(m.id);
    return { uploadId: m.id, mediaId: m.id, chunkBytes: CHUNK_BYTES, expiresAt: m.expiresAt };
  }),

  route("PUT", "/uploads/:id/chunks", (req) => {
    const { db, body, me } = req;
    const m = (db.media as MediaX[]).find((x) => x.id === req.params.id && x.uploaderId === me.employee?.id);
    if (!m) fail(404, "NOT_FOUND", "Upload not found.");
    if (!["INITIATED", "RECEIVING"].includes(m!.state)) fail(409, "INVALID_TRANSITION", "This upload is no longer accepting data.");
    const start = Number(body.start);
    const end = Number(body.end);
    if (start !== (m!.receivedBytes ?? 0)) fail(409, "VALIDATION_ERROR", `Expected offset ${m!.receivedBytes ?? 0}.`, { latest: { offset: m!.receivedBytes ?? 0 } });
    if (!(end > start) || end > m!.sizeBytes) validation({ range: "Invalid byte range." });
    m!.receivedBytes = end;
    m!.state = "RECEIVING";
    m!.progress = end / m!.sizeBytes;
    return { offset: end, state: m!.state };
  }),

  route("GET", "/uploads/:id", (req) => {
    advanceMedia(req.db);
    const m = (req.db.media as MediaX[]).find((x) => x.id === req.params.id && x.uploaderId === req.me.employee?.id);
    if (!m) fail(404, "NOT_FOUND", "Upload not found.");
    return { ...m, offset: m!.receivedBytes ?? 0 };
  }),

  route("POST", "/uploads/:id/complete", (req) => {
    const { db, me } = req;
    const m = (db.media as MediaX[]).find((x) => x.id === req.params.id && x.uploaderId === me.employee?.id);
    if (!m) fail(404, "NOT_FOUND", "Upload not found.");
    if (m!.state !== "RECEIVING" && m!.state !== "INITIATED") return { mediaId: m!.id, state: m!.state };
    if ((m!.receivedBytes ?? 0) < m!.sizeBytes) fail(409, "VALIDATION_ERROR", "Not all bytes have been received yet.", { latest: { offset: m!.receivedBytes ?? 0 } });
    if (db.sim.driveUnavailable) {
      m!.lastError = "Storage is unavailable. Your file is saved as a pending upload and will finish when storage recovers.";
      fail(503, "DEPENDENCY_UNAVAILABLE", m!.lastError, { retryable: true });
    }
    m!.state = "SCANNING";
    m!.lastError = undefined;
    m!.scanStartedAt = nowIso();
    m!.progress = undefined;
    return { mediaId: m!.id, state: m!.state };
  }),

  route("GET", "/media/:id/content", (req) => {
    const { db, me } = req;
    const m = db.media.find((x) => x.id === req.params.id);
    if (!m) fail(404, "NOT_FOUND", "File not found.");
    const sub = db.submissions.find((s) => s.mediaIds.includes(m!.id));
    const task = sub ? db.tasks.find((t) => t.id === sub.taskId) : undefined;
    if (!task || !canSeeTask(db, me, task)) fail(404, "NOT_FOUND", "File not found.");
    if (m!.state !== "AVAILABLE") fail(409, "INVALID_TRANSITION", `This file is ${m!.state.toLowerCase()} and can't be opened.`);
    audit(req, "media.access", "MediaAsset", m!.id);
    const previewable = /^image\/(png|jpeg|gif|webp)$/.test(m!.mimeType) || m!.mimeType === "application/pdf";
    return { media: m, ticket: `dl_${uuid().slice(0, 12)}`, expiresAt: new Date(Date.now() + 60_000).toISOString(), disposition: previewable ? "inline-sandboxed" : "attachment" };
  }),
];

/* ------------------------------------------------------------------ work logs */

const workLogRoutes = [
  route("GET", "/tasks/:id/work-logs", (req) => {
    const t = getTask(req, req.params.id);
    const manager = canManageTask(req, t);
    return { items: req.db.workLogs.filter((w) => w.taskId === t.id && (manager || w.employeeId === req.me.employee?.id)) };
  }),

  route("POST", "/tasks/:id/work-logs", (req) => {
    const { db, body, me } = req;
    const t = getTask(req, req.params.id);
    if (!taskPerms(req, t).canLogWork) fail(403, "FORBIDDEN", "Only the assignee can log work on this task.");
    const e: Record<string, string> = {};
    const date = String(body.businessDate ?? "");
    const mins = Number(body.durationMinutes);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: db.organization.timezone }).format(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) e.businessDate = "Choose a date.";
    else if (date > today) e.businessDate = "Work can't be logged for a future date.";
    if (!Number.isInteger(mins) || mins < 5 || mins > 720) e.durationMinutes = "Enter between 5 and 720 minutes.";
    if (String(body.description ?? "").trim().length < 5) e.description = "Describe the work (at least 5 characters).";
    const source = (body.source ?? "MANUAL") as T.WorkLog["source"];
    const dayTotal = db.workLogs.filter((w) => w.employeeId === me.employee!.id && w.businessDate === date && w.status !== "REJECTED").reduce((a, w) => a + w.durationMinutes, 0);
    if (!e.durationMinutes && dayTotal + mins > 720) e.durationMinutes = `This would bring ${date} to ${dayTotal + mins} minutes, above the 12-hour daily cap. Logs must reconcile to attendance.`;
    if (Object.keys(e).length) validation(e);
    const w: T.WorkLog = { id: uuid(), employeeId: me.employee!.id, taskId: t.id, businessDate: date, durationMinutes: mins, description: String(body.description).trim(), source, status: "SUBMITTED" };
    db.workLogs.push(w);
    return w;
  }),

  route("GET", "/worklogs", (req) => {
    const { db, me, query } = req;
    const scope = query.scope === "team" ? "team" : "mine";
    let rows: T.WorkLog[];
    if (scope === "team") {
      requirePerm(me, "worklog.review");
      const vis = visibleEmployees(db, me, "worklog.review");
      rows = db.workLogs.filter((w) => w.employeeId !== me.employee?.id && (vis === "all" || vis.has(w.employeeId)));
    } else rows = db.workLogs.filter((w) => w.employeeId === me.employee?.id);
    if (query.status) rows = rows.filter((w) => w.status === query.status);
    if (query.from) rows = rows.filter((w) => w.businessDate >= query.from);
    if (query.to) rows = rows.filter((w) => w.businessDate <= query.to);
    rows = rows.slice().sort((a, b) => b.businessDate.localeCompare(a.businessDate) || a.employeeId.localeCompare(b.employeeId));
    const items = rows.map((w) => ({ ...w, taskTitle: db.tasks.find((t) => t.id === w.taskId)?.title ?? "" }));
    const assignable = scope === "mine"
      ? db.tasks.filter((t) => t.assigneeId === me.employee?.id && !TERMINAL.includes(t.state) && t.state !== "DRAFT").map((t) => ({ id: t.id, title: t.title }))
      : [];
    return { items, assignable, canReview: can(me, "worklog.review") };
  }),

  route("POST", "/worklogs/:id/decision", (req) => {
    const { db, body, me } = req;
    requirePerm(me, "worklog.review");
    const w = db.workLogs.find((x) => x.id === req.params.id);
    const vis = visibleEmployees(db, me, "worklog.review");
    if (!w || (vis !== "all" && !vis.has(w.employeeId))) fail(404, "NOT_FOUND", "Work log not found.");
    if (w!.employeeId === me.employee?.id) fail(403, "FORBIDDEN", "You can't review your own work log.");
    if (w!.status !== "SUBMITTED") fail(409, "INVALID_TRANSITION", "This work log was already reviewed.");
    if (body.decision === "APPROVE") {
      const approved = body.approvedMinutes === undefined ? w!.durationMinutes : Number(body.approvedMinutes);
      if (!Number.isInteger(approved) || approved < 0 || approved > w!.durationMinutes) validation({ approvedMinutes: `Approve between 0 and ${w!.durationMinutes} minutes.` });
      w!.status = "APPROVED";
      w!.approvedMinutes = approved;
    } else if (body.decision === "REJECT") {
      if (String(body.reason ?? "").trim().length < 3) validation({ reason: "A reason is required." });
      w!.status = "REJECTED";
      w!.approvedMinutes = 0;
    } else validation({ decision: "Choose approve or reject." });
    w!.reviewerId = me.employee?.id;
    audit(req, `worklog.${String(body.decision).toLowerCase()}`, "WorkLog", w!.id, { reason: body.reason, after: { approvedMinutes: w!.approvedMinutes } });
    return w;
  }),
];

export const workRoutes = [...projectRoutes, ...taskRoutes, ...submissionRoutes, ...uploadRoutes, ...workLogRoutes];
