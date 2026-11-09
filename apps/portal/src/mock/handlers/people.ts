/** People operations: directory, profiles, status changes, offboarding and assets (sections 4, 15). */
import type * as T from "@/lib/types";
import { can } from "@/lib/rbac";
import type { AssetHistoryEntry, AssetRow, DirectoryRow, EmployeeDetail, OffboardingChecklist } from "@/lib/api/people";
import type { MockDb } from "../db";
import {
  audit, bump, canSeeEmployee, checkVersion, employeeLabel, fail, matchesSearch, notifyEmployee, notifyRole, nowIso,
  requirePerm, rolesForUser, uuid, validation, visibleEmployees, type MockReq,
} from "../helpers";
import { route } from "../routes";

interface AssetCase {
  id: string;
  assetId: string;
  employeeId?: string;
  description: string;
  openedBy: string;
  openedAt: string;
  status: "OPEN";
}
interface AssetEvent {
  id: string;
  assetId: string;
  at: string;
  kind: AssetHistoryEntry["kind"];
  text: string;
}
type Ext = MockDb & { assetCases?: AssetCase[]; assetEvents?: AssetEvent[] };

function toRow(db: MockDb, e: T.Employee): DirectoryRow {
  return {
    ...e,
    teamName: db.teams.find((t) => t.id === e.teamId)?.name,
    managerName: e.managerId ? employeeLabel(db, e.managerId) : undefined,
    roles: e.userId ? rolesForUser(db, e.userId) : [],
  };
}

function findEmployee(req: MockReq, id: string): T.Employee {
  const e = req.db.employees.find((x) => x.id === id);
  if (!e || !canSeeEmployee(req.db, req.me, "employee.read", id)) fail(404, "NOT_FOUND", "Employee not found.");
  return e!;
}

const isSelf = (req: MockReq, id: string) => req.me.employee?.id === id;
const canManagePeople = (req: MockReq) => can(req.me, "employee.manage") || can(req.me, "user.deactivate");

function revokeAccess(req: MockReq, e: T.Employee, reason: string) {
  const { db } = req;
  for (const d of db.devices) {
    if (d.employeeId === e.id && d.status !== "REVOKED") {
      d.status = "REVOKED";
      d.revokedAt = nowIso();
      audit(req, "device.revoke", "Device", d.id, { reason });
    }
  }
  for (const s of db.sessions) {
    if (s.employeeId === e.id && s.state !== "STOPPED") {
      s.state = "STOPPED";
      s.endedAt = nowIso();
      s.authorizationExpiresAt = nowIso();
    }
  }
  const u = db.users.find((x) => x.id === e.userId);
  if (u) u.status = e.employmentStatus === "OFFBOARDED" ? "OFFBOARDED" : "SUSPENDED";
}

function offboarding(req: MockReq, e: T.Employee): OffboardingChecklist {
  const { db } = req;
  const open: T.TaskState[] = ["DRAFT", "ASSIGNED", "IN_PROGRESS", "SUBMITTED", "REVISION_REQUESTED", "BLOCKED"];
  const tasks = db.tasks.filter((t) => t.assigneeId === e.id && open.includes(t.state));
  const reviews = db.tasks.filter((t) => t.reviewerId === e.id && t.state === "SUBMITTED");
  const corrections = db.corrections.filter((c) => c.employeeId === e.id && ["PROPOSED", "MANAGER_VALIDATED"].includes(c.status));
  const pendingRun = db.payrollRuns.find((r) => !["PAID", "EXPORTED"].includes(r.state));
  const inRun = pendingRun && db.payrollLines.some((l) => l.runId === pendingRun.id && l.employeeId === e.id);
  const assets = db.assets.filter((a) => a.assignedEmployeeId === e.id && ["ASSIGNED", "RETURN_REQUESTED"].includes(a.state));
  const devices = db.devices.filter((d) => d.employeeId === e.id && d.status !== "REVOKED");
  const user = db.users.find((u) => u.id === e.userId);
  const leaves = db.leaveRequests.filter((l) => l.employeeId === e.id && ["PENDING", "DRAFT"].includes(l.status));
  return {
    employeeId: e.id,
    employmentStatus: e.employmentStatus,
    items: [
      { key: "tasks", label: "Reassign open tasks", status: tasks.length ? "PENDING" : "DONE", detail: tasks.length ? `${tasks.length} open task(s): ${tasks.map((t) => t.title).join(", ")}` : "No open assignments.", href: "/tasks" },
      { key: "reviews", label: "Reassign pending reviews", status: reviews.length ? "PENDING" : "DONE", detail: reviews.length ? `${reviews.length} submission(s) waiting for this reviewer.` : "No pending reviews.", href: "/reviews" },
      { key: "attendance", label: "Finalize attendance & leave", status: corrections.length || leaves.length ? "PENDING" : "DONE", detail: `${corrections.length} open correction(s), ${leaves.length} pending leave request(s).`, href: "/attendance/approvals" },
      { key: "payroll", label: "Final payroll review", status: inRun ? "PENDING" : "N/A", detail: inRun ? "Included in an unapproved payroll run — review the final line with payroll." : "Not in an open payroll run.", href: "/payroll" },
      { key: "assets", label: "Recover assets", status: assets.length ? "PENDING" : "DONE", detail: assets.length ? assets.map((a) => `${a.assetTag} (${a.model})`).join(", ") : "No assets in custody.", href: "/assets" },
      { key: "access", label: "Revoke portal sessions & device keys", status: devices.length || user?.status === "ACTIVE" ? "PENDING" : "DONE", detail: `${devices.length} active device credential(s); portal account ${user?.status.toLowerCase() ?? "none"}.` },
      { key: "drive", label: "Remove & verify direct Drive access", status: "N/A", detail: "Employees have portal-only media access by default; verify no native Shared Drive membership exists." },
      { key: "retention", label: "Apply retention schedule", status: e.employmentStatus === "OFFBOARDED" ? "PENDING" : "N/A", detail: "Historical submissions, approvals and payroll are preserved; personal data follows the approved retention workflow." },
    ],
  };
}

/* ------------------------------------------------------------ assets */

function assetRow(req: MockReq, a: T.Asset): AssetRow {
  const active = req.db.assetAssignments.find((x) => x.assetId === a.id && !x.returnedAt);
  return {
    ...a,
    assignedName: a.assignedEmployeeId ? employeeLabel(req.db, a.assignedEmployeeId) : undefined,
    activeAssignment: active,
    canManage: can(req.me, "asset.manage"),
    canAcknowledge: !!active && active.employeeId === req.me.employee?.id && !active.acknowledgedAt,
  };
}

function findAsset(req: MockReq): T.Asset {
  const a = req.db.assets.find((x) => x.id === req.params.id);
  if (!a) fail(404, "NOT_FOUND", "Asset not found.");
  const vis = visibleEmployees(req.db, req.me, "asset.read");
  if (vis !== "all" && !(a!.assignedEmployeeId && vis.has(a!.assignedEmployeeId))) fail(404, "NOT_FOUND", "Asset not found.");
  return a!;
}

function assetEvent(req: MockReq, assetId: string, kind: AssetHistoryEntry["kind"], text: string) {
  const db = req.db as Ext;
  db.assetEvents = db.assetEvents ?? [];
  db.assetEvents.unshift({ id: uuid(), assetId, at: nowIso(), kind, text });
}

const actor = (req: MockReq) => req.me.employee?.displayName ?? req.me.user.email;

export const peopleRoutes = [
  /* -------------------------------------------------------- directory */
  route("GET", "/employees", (req) => {
    requirePerm(req.me, "employee.read");
    const vis = visibleEmployees(req.db, req.me, "employee.read");
    const { q, team, status } = req.query;
    const rows = req.db.employees
      .filter((e) => vis === "all" || vis.has(e.id))
      .filter((e) => !team || e.teamId === team)
      .filter((e) => !status || e.employmentStatus === status)
      .filter((e) => matchesSearch(q, e.displayName, e.employeeCode, e.title, e.workEmail))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map((e) => toRow(req.db, e));
    return { items: rows };
  }),

  route("GET", "/employees/:id", (req): EmployeeDetail => {
    const e = findEmployee(req, req.params.id);
    return {
      ...toRow(req.db, e),
      isSelf: isSelf(req, e.id),
      canEditContact: isSelf(req, e.id) || can(req.me, "employee.manage"),
      canManage: canManagePeople(req),
      canReadPrivate: can(req.me, "employee.private.read") || isSelf(req, e.id),
    };
  }),

  route("GET", "/employees/:id/private", (req) => {
    const e = findEmployee(req, req.params.id);
    if (!isSelf(req, e.id) && !can(req.me, "employee.private.read")) {
      audit(req, "employee.private.read", "Employee", e.id, { result: "DENIED" });
      fail(403, "FORBIDDEN", "Private HR records are restricted to HR and the owner.");
    }
    if (!isSelf(req, e.id)) audit(req, "employee.private.read", "Employee", e.id, { reason: req.query.reason });
    const p = req.db.privateProfiles.find((x) => x.employeeId === e.id);
    if (!p) fail(404, "NOT_FOUND", "No private profile on record.");
    return p;
  }),

  route("PATCH", "/employees/:id", (req) => {
    const e = findEmployee(req, req.params.id);
    checkVersion(req, e);
    const self = isSelf(req, e.id);
    const hr = can(req.me, "employee.manage");
    if (!self && !hr) fail(403, "FORBIDDEN", "You can't edit this profile.");
    const selfFields = ["workPhone"];
    const hrFields = ["workPhone", "title", "teamId", "managerId", "displayName", "workEmail"];
    const allowed = hr ? hrFields : selfFields;
    const unknown = Object.keys(req.body).filter((k) => !allowed.includes(k));
    if (unknown.length) validation(Object.fromEntries(unknown.map((k) => [k, "This field can't be changed here."])), "Some fields are controlled and need HR approval.");
    if (req.body.workPhone !== undefined && !/^[+0-9 ()-]{6,20}$/.test(req.body.workPhone)) validation({ workPhone: "Enter a valid phone number." });
    if (req.body.managerId && req.body.managerId === e.id) validation({ managerId: "An employee can't manage themselves." });
    const before: Record<string, unknown> = {};
    for (const k of Object.keys(req.body)) before[k] = (e as unknown as Record<string, unknown>)[k];
    Object.assign(e, req.body);
    if (req.body.teamId) {
      for (const t of req.db.teams) t.memberIds = t.memberIds.filter((m) => m !== e.id);
      req.db.teams.find((t) => t.id === req.body.teamId)?.memberIds.push(e.id);
    }
    bump(e);
    audit(req, "employee.update", "Employee", e.id, { before, after: req.body });
    return toRow(req.db, e);
  }),

  route("POST", "/employees/:id/status", (req) => {
    if (!canManagePeople(req)) fail(403, "FORBIDDEN", "Only HR or administrators can change employment status.");
    const e = findEmployee(req, req.params.id);
    checkVersion(req, e);
    const { action, reason } = req.body as { action: "SUSPEND" | "REACTIVATE" | "OFFBOARD"; reason?: string };
    if (!reason || reason.trim().length < 3) validation({ reason: "A reason is required." });
    if (isSelf(req, e.id)) fail(422, "POLICY_BLOCKED", "You can't change your own employment status.");
    const owner = e.userId && rolesForUser(req.db, e.userId).includes("OWNER");
    if (owner) fail(422, "POLICY_BLOCKED", "The owner account can't be suspended from the portal.");
    const from = e.employmentStatus;
    if (action === "SUSPEND") {
      if (from !== "ACTIVE") fail(409, "INVALID_TRANSITION", "Only active employees can be suspended.");
      e.employmentStatus = "SUSPENDED";
      revokeAccess(req, e, reason!);
    } else if (action === "REACTIVATE") {
      if (from !== "SUSPENDED") fail(409, "INVALID_TRANSITION", "Only suspended employees can be reactivated.");
      e.employmentStatus = "ACTIVE";
      const u = req.db.users.find((x) => x.id === e.userId);
      if (u) u.status = "ACTIVE";
    } else if (action === "OFFBOARD") {
      if (!["ACTIVE", "SUSPENDED"].includes(from)) fail(409, "INVALID_TRANSITION", "This employee can't be offboarded.");
      e.employmentStatus = "OFFBOARDED";
      e.endDate = new Date().toISOString().slice(0, 10);
      revokeAccess(req, e, reason!);
      for (const a of req.db.assets) {
        if (a.assignedEmployeeId === e.id && a.state === "ASSIGNED") {
          a.state = "RETURN_REQUESTED";
          bump(a);
          assetEvent(req, a.id, "RETURN_REQUESTED", `Return requested during offboarding by ${actor(req)}`);
        }
      }
      notifyRole(req.db, "PAYROLL", { kind: "PAYROLL_PUBLISHED", title: `Final payroll review: ${e.displayName}`, body: "An employee was offboarded; review their final payroll line.", href: "/payroll" });
    } else validation({ action: "Unknown action." });
    bump(e);
    audit(req, `employee.${String(action).toLowerCase()}`, "Employee", e.id, { reason, before: { employmentStatus: from }, after: { employmentStatus: e.employmentStatus } });
    return toRow(req.db, e);
  }),

  route("GET", "/employees/:id/offboarding", (req) => {
    if (!canManagePeople(req)) fail(403, "FORBIDDEN", "Offboarding is managed by HR and administrators.");
    return offboarding(req, findEmployee(req, req.params.id));
  }),

  /* -------------------------------------------------------- assets */
  route("GET", "/assets", (req) => {
    requirePerm(req.me, "asset.read");
    const vis = visibleEmployees(req.db, req.me, "asset.read");
    const { q, type, state, employeeId } = req.query;
    const items = req.db.assets
      .filter((a) => vis === "all" || (a.assignedEmployeeId && vis.has(a.assignedEmployeeId)))
      .filter((a) => !type || a.type === type)
      .filter((a) => !state || a.state === state)
      .filter((a) => !employeeId || a.assignedEmployeeId === employeeId)
      .filter((a) => matchesSearch(q, a.assetTag, a.model, a.serial, a.type))
      .sort((a, b) => a.assetTag.localeCompare(b.assetTag))
      .map((a) => assetRow(req, a));
    return { items, types: Array.from(new Set(req.db.assets.map((a) => a.type))).sort() };
  }),

  route("POST", "/assets", (req) => {
    requirePerm(req.me, "asset.manage");
    const { assetTag, serial, type, model, condition = "NEW", referenceDate } = req.body;
    const errs: Record<string, string> = {};
    if (!assetTag?.trim()) errs.assetTag = "Asset tag is required.";
    else if (req.db.assets.some((a) => a.assetTag.toLowerCase() === assetTag.trim().toLowerCase())) errs.assetTag = "This asset tag already exists.";
    if (!serial?.trim()) errs.serial = "Serial is required.";
    if (!type?.trim()) errs.type = "Type is required.";
    if (!model?.trim()) errs.model = "Model is required.";
    if (Object.keys(errs).length) validation(errs);
    const now = nowIso();
    const a: T.Asset = { id: uuid(), organizationId: req.db.organization.id, createdAt: now, updatedAt: now, version: 1, assetTag: assetTag.trim(), serial: serial.trim(), type: type.trim(), model: model.trim(), condition, state: "AVAILABLE", referenceDate };
    req.db.assets.push(a);
    audit(req, "asset.create", "Asset", a.id);
    return assetRow(req, a);
  }),

  route("POST", "/assets/:id/assignments", (req) => {
    requirePerm(req.me, "asset.manage");
    const a = findAsset(req);
    checkVersion(req, a);
    const { employeeId, issueCondition } = req.body;
    const emp = req.db.employees.find((e) => e.id === employeeId);
    if (!emp) validation({ employeeId: "Choose an employee." });
    if (emp!.employmentStatus !== "ACTIVE") validation({ employeeId: "Assets can only be issued to active employees." });
    if (!issueCondition?.trim()) validation({ issueCondition: "Record the condition at issue." });
    if (a.state !== "AVAILABLE") fail(409, "INVALID_TRANSITION", `Asset is ${a.state.toLowerCase().replace(/_/g, " ")}, not available.`);
    if (req.db.assetAssignments.some((x) => x.assetId === a.id && !x.returnedAt)) fail(409, "INVALID_TRANSITION", "This asset already has an active custodian.");
    const asg: T.AssetAssignment = { id: uuid(), assetId: a.id, employeeId, issuedAt: nowIso(), issueCondition };
    req.db.assetAssignments.push(asg);
    a.state = "ASSIGNED";
    a.assignedEmployeeId = employeeId;
    bump(a);
    assetEvent(req, a.id, "ISSUED", `Issued to ${emp!.displayName} by ${actor(req)} — ${issueCondition}`);
    notifyEmployee(req.db, employeeId, { kind: "ASSET_ACTION", title: `Asset issued: ${a.assetTag}`, body: `${a.model} was assigned to you. Please acknowledge receipt.`, href: "/assets" });
    audit(req, "asset.assign", "Asset", a.id, { after: { employeeId } });
    return assetRow(req, a);
  }),

  route("POST", "/assets/:id/return-request", (req) => {
    requirePerm(req.me, "asset.manage");
    const a = findAsset(req);
    checkVersion(req, a);
    if (a.state !== "ASSIGNED") fail(409, "INVALID_TRANSITION", "Only assigned assets can have a return requested.");
    a.state = "RETURN_REQUESTED";
    bump(a);
    assetEvent(req, a.id, "RETURN_REQUESTED", `Return requested by ${actor(req)}${req.body.reason ? `: ${req.body.reason}` : ""}`);
    notifyEmployee(req.db, a.assignedEmployeeId, { kind: "ASSET_ACTION", title: `Return requested: ${a.assetTag}`, body: `Please return ${a.model} to HR.`, href: "/assets" });
    audit(req, "asset.return_request", "Asset", a.id, { reason: req.body.reason });
    return assetRow(req, a);
  }),

  route("POST", "/assets/:id/return", (req) => {
    requirePerm(req.me, "asset.manage");
    const a = findAsset(req);
    checkVersion(req, a);
    if (!["ASSIGNED", "RETURN_REQUESTED"].includes(a.state)) fail(409, "INVALID_TRANSITION", "This asset isn't checked out.");
    const { returnCondition, condition } = req.body;
    if (!returnCondition?.trim()) validation({ returnCondition: "Record the condition on return." });
    const asg = req.db.assetAssignments.find((x) => x.assetId === a.id && !x.returnedAt);
    if (asg) {
      asg.returnedAt = nowIso();
      asg.returnCondition = returnCondition;
    }
    const holder = employeeLabel(req.db, a.assignedEmployeeId);
    a.state = "RETURNED";
    a.assignedEmployeeId = undefined;
    if (condition) a.condition = condition;
    bump(a);
    assetEvent(req, a.id, "RETURNED", `Returned by ${holder}, received by ${actor(req)} — ${returnCondition}`);
    audit(req, "asset.return", "Asset", a.id);
    return assetRow(req, a);
  }),

  route("POST", "/assets/:id/acknowledge", (req) => {
    const a = req.db.assets.find((x) => x.id === req.params.id);
    if (!a) fail(404, "NOT_FOUND", "Asset not found.");
    const asg = req.db.assetAssignments.find((x) => x.assetId === a!.id && !x.returnedAt);
    if (!asg || asg.employeeId !== req.me.employee?.id) fail(403, "FORBIDDEN", "Only the current custodian can acknowledge receipt.");
    if (asg!.acknowledgedAt) return assetRow(req, a!);
    asg!.acknowledgedAt = nowIso();
    assetEvent(req, a!.id, "ACKNOWLEDGED", `Receipt acknowledged by ${actor(req)}`);
    audit(req, "asset.acknowledge", "Asset", a!.id);
    return assetRow(req, a!);
  }),

  route("POST", "/assets/:id/state", (req) => {
    requirePerm(req.me, "asset.manage");
    const a = findAsset(req);
    checkVersion(req, a);
    const { state, reason } = req.body as { state: T.AssetState; reason?: string };
    const allowed: Record<string, T.AssetState[]> = {
      RETURNED: ["AVAILABLE", "MAINTENANCE", "RETIRED"],
      AVAILABLE: ["MAINTENANCE", "RETIRED"],
      MAINTENANCE: ["AVAILABLE", "RETIRED"],
    };
    if (!allowed[a.state]?.includes(state)) fail(409, "INVALID_TRANSITION", `Can't move an asset from ${a.state.toLowerCase()} to ${String(state).toLowerCase()}.`);
    if (["RETIRED", "MAINTENANCE"].includes(state) && (!reason || reason.trim().length < 3)) validation({ reason: "A reason is required." });
    const from = a.state;
    a.state = state;
    bump(a);
    assetEvent(req, a.id, "STATE", `${from.toLowerCase()} → ${state.toLowerCase()} by ${actor(req)}${reason ? `: ${reason}` : ""}`);
    audit(req, "asset.state", "Asset", a.id, { reason, before: { state: from }, after: { state } });
    return assetRow(req, a);
  }),

  route("POST", "/assets/:id/damage-case", (req) => {
    requirePerm(req.me, "asset.manage");
    const a = findAsset(req);
    const { description } = req.body;
    if (!description?.trim() || description.trim().length < 5) validation({ description: "Describe the loss or damage." });
    const db = req.db as Ext;
    db.assetCases = db.assetCases ?? [];
    const c: AssetCase = { id: uuid(), assetId: a.id, employeeId: a.assignedEmployeeId, description, openedBy: actor(req), openedAt: nowIso(), status: "OPEN" };
    db.assetCases.push(c);
    a.condition = "DAMAGED";
    bump(a);
    assetEvent(req, a.id, "DAMAGE_CASE", `Review case opened by ${actor(req)}: ${description} (no automatic payroll deduction)`);
    audit(req, "asset.damage_case", "Asset", a.id, { reason: description });
    return c;
  }),

  route("GET", "/assets/:id/history", (req) => {
    const a = findAsset(req);
    const db = req.db as Ext;
    const entries: AssetHistoryEntry[] = [];
    for (const x of req.db.assetAssignments.filter((y) => y.assetId === a.id)) {
      entries.push({ id: `${x.id}-i`, at: x.issuedAt, kind: "ISSUED", text: `Issued to ${employeeLabel(req.db, x.employeeId)} — ${x.issueCondition}` });
      if (x.acknowledgedAt) entries.push({ id: `${x.id}-a`, at: x.acknowledgedAt, kind: "ACKNOWLEDGED", text: `Receipt acknowledged by ${employeeLabel(req.db, x.employeeId)}` });
      if (x.returnedAt) entries.push({ id: `${x.id}-r`, at: x.returnedAt, kind: "RETURNED", text: `Returned — ${x.returnCondition ?? ""}` });
    }
    for (const ev of (db.assetEvents ?? []).filter((e) => e.assetId === a.id && ["STATE", "RETURN_REQUESTED", "DAMAGE_CASE"].includes(e.kind))) entries.push(ev);
    entries.sort((x, y) => y.at.localeCompare(x.at));
    return { asset: assetRow(req, a), entries, cases: (db.assetCases ?? []).filter((c) => c.assetId === a.id) };
  }),
];
