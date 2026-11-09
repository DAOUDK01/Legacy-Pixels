/**
 * Administration, identity admin, policies, audit and reports (sections 3, 4, 15, 16, 17, 19, 30).
 */
import type * as T from "@/lib/types";
import { can, PRIVILEGED_ROLES, scopeOf } from "@/lib/rbac";
import { addDays, businessDate, weekday, zonedToUtc } from "@/lib/time";
import { toCsv } from "@/lib/csv";
import type {
  AgentVersionsDto, ChecklistDto, ExportResult, MediaHealthDto, ReportColumn, ReportResult, RetentionDto,
} from "@/lib/api/admin";
import { REPORT_CATALOG } from "@/lib/api/admin";
import type { MockDb } from "../db";
import {
  audit, bump, checkVersion, employeeLabel, fail, matchesSearch, notifyRole, nowIso, paginate, requirePerm,
  rolesForUser, uuid, validation, visibleEmployees, type MockReq,
} from "../helpers";
import { route } from "../routes";

const TB = 1024 ** 4;
const GB = 1024 ** 3;

const orgBase = (db: MockDb) => {
  const now = nowIso();
  return { organizationId: db.organization.id, createdAt: now, updatedAt: now, version: 1 };
};

/* ------------------------------------------------------------ admin derived data */

function mediaHealth(db: MockDb): MediaHealthDto {
  const cats: Record<string, number> = {};
  for (const m of db.media) if (!["DELETED", "EXPIRED"].includes(m.state)) cats[m.category] = (cats[m.category] ?? 0) + m.sizeBytes;
  // Modelled volumes not represented by individual seed rows.
  cats.SCREENSHOT = (cats.SCREENSHOT ?? 0) + db.screenshots.filter((s) => s.mediaId).length * 0.2 * 1024 * 1024 + 9.6 * GB;
  cats.PROJECT_OUTPUT = (cats.PROJECT_OUTPUT ?? 0) + 640 * GB;
  cats.HR_DOCUMENT = (cats.HR_DOCUMENT ?? 0) + 3.2 * GB;
  const other = 210 * GB;
  const byCategory = [
    ...Object.entries(cats).map(([category, bytes]) => ({ category: category as T.MediaCategory, bytes: Math.round(bytes) })),
    { category: "OTHER_WORKSPACE" as const, bytes: other },
  ].sort((a, b) => b.bytes - a.bytes);
  const used = byCategory.reduce((a, c) => a + c.bytes, 0);
  const pool = 2 * TB;
  const pct = Math.round((used / pool) * 1000) / 10;
  return {
    poolBytes: pool,
    usedBytes: used,
    usedPct: pct,
    thresholds: [70, 85, 95],
    level: pct >= 95 ? "CRITICAL_95" : pct >= 85 ? "HIGH_85" : pct >= 70 ? "WARN_70" : "OK",
    byCategory,
    pendingTransfers: db.media.filter((m) => ["RECEIVING", "SCANNING", "TRANSFERRING"].includes(m.state)).length,
    failedScans: db.media.filter((m) => m.state === "FAILED").length,
    quarantined: db.media.filter((m) => m.state === "QUARANTINED").length,
    outboxBacklog: db.sim.driveUnavailable ? 14 : 0,
    lastBackupAt: new Date(Date.now() - 3.5 * 3600_000).toISOString(),
    driveUnavailable: db.sim.driveUnavailable,
    screenshotForecastBytesPerMonth: Math.round(50 * 8 * 6 * 22 * 0.2 * 1e6),
  };
}

function agentVersions(db: MockDb): AgentVersionsDto {
  const map = new Map<string, { version: string; active: number; pending: number; revoked: number }>();
  for (const d of db.devices) {
    const v = map.get(d.agentVersion) ?? { version: d.agentVersion, active: 0, pending: 0, revoked: 0 };
    if (d.status === "ACTIVE") v.active++;
    else if (d.status === "PENDING") v.pending++;
    else v.revoked++;
    map.set(d.agentVersion, v);
  }
  return {
    versions: Array.from(map.values()).sort((a, b) => b.version.localeCompare(a.version)),
    devices: db.devices.map((d) => ({ id: d.id, employeeId: d.employeeId, employeeName: employeeLabel(db, d.employeeId), hostname: d.hostname, agentVersion: d.agentVersion, status: d.status, lastSeen: d.lastSeen })),
  };
}

function retention(db: MockDb): RetentionDto {
  const pol = db.policies.filter((p) => p.type === "RETENTION").sort((a, b) => b.version - a.version)[0];
  const approved = db.policies.some((p) => p.type === "RETENTION" && p.status === "APPROVED");
  const cutoff30 = Date.now() - 30 * 86400_000;
  const cutoff90 = Date.now() - 90 * 86400_000;
  const shots = db.screenshots.filter((s) => new Date(s.captureAt).getTime() < cutoff30);
  return {
    policyApproved: approved,
    policyStatus: pol?.status ?? "MISSING",
    rules: [
      { category: "Screenshots", period: `${pol?.config.screenshotsDays ?? 30} days`, eligible: shots.length, held: 0 },
      { category: "Raw app/domain/idle events", period: `${pol?.config.rawEventsDays ?? 90} days`, eligible: db.sessions.filter((s) => new Date(s.startedAt).getTime() < cutoff90).length, held: 0 },
      { category: "Temporary exports", period: `${pol?.config.exportsHours ?? 24} hours`, eligible: db.payrollRuns.flatMap((r) => r.exports).filter((e) => new Date(e.expiresAt).getTime() < Date.now()).length, held: 0 },
      { category: "HR documents", period: "Pending approved schedule", eligible: 0, held: db.privateProfiles.reduce((a, p) => a + p.documents.length, 0) },
      { category: "Approved attendance & payroll", period: "Per approved records schedule", eligible: 0, held: db.payrollRuns.length },
    ],
    lastRunAt: approved ? new Date(Date.now() - 6 * 3600_000).toISOString() : undefined,
    blockedReason: approved ? undefined : "Retention jobs and production release are blocked until the retention policy is approved by the owner.",
  };
}

function releaseChecklist(db: MockDb): ChecklistDto {
  const approvedType = (t: T.PolicyType) => db.policies.some((p) => p.type === t && p.status === "APPROVED");
  const pending = db.policies.filter((p) => ["DRAFT", "PENDING_APPROVAL"].includes(p.status));
  const paid = db.payrollRuns.filter((r) => r.state === "PAID").length;
  return {
    items: [
      { key: "scope", label: "Owner accepts module/screen scope and explicit exclusions", status: "MANUAL", detail: "Record acceptance in the decision register." },
      { key: "decisions", label: "Decision register resolves production-blocking policies and pay rules", status: pending.length ? "FAIL" : "PASS", detail: pending.length ? `${pending.length} policy version(s) not approved: ${pending.map((p) => p.title).join("; ")}` : "All policy versions approved." },
      { key: "storage", label: "Shared Drive role/scope combination passes storage proof of concept", status: db.sim.driveUnavailable ? "FAIL" : "MANUAL", detail: db.sim.driveUnavailable ? "Drive is currently unavailable." : "Attach the storage spike evidence (create/list/resume/download/delete)." },
      { key: "rbac", label: "Role and sensitive-field tests pass for browser, API, worker and exports", status: "MANUAL", detail: "Run AC01 suite against staging." },
      { key: "agent", label: "Signed agent build passes pause/stop/lock/lease/privacy tests", status: approvedType("MONITORING") ? "MANUAL" : "FAIL", detail: approvedType("MONITORING") ? "Monitoring policy approved; attach AC05/AC06 evidence." : "Monitoring policy not approved." },
      { key: "scoring", label: "Scoring calculations and zero-denominator handling match approved examples", status: "PASS", detail: "Unit tests: score example 88.0, rubric 87.50, N/A coverage normalization." },
      { key: "payroll", label: "Shadow payroll cycles reconcile; owner approval and immutable history verified", status: paid >= 2 ? "PASS" : "FAIL", detail: `${paid} paid run(s) on record; at least two shadow cycles required. Unit test: payroll example 106500.` },
      { key: "retention", label: "Backup restore and retention deletion procedures have recorded evidence", status: approvedType("RETENTION") ? "MANUAL" : "FAIL", detail: approvedType("RETENTION") ? "Attach restore drill evidence (AC11)." : "Retention policy is not approved — production release blocked." },
      { key: "gates", label: "Load/accessibility/security gates meet sections 25 and 26", status: "MANUAL", detail: "Attach load test, WCAG 2.2 AA and security review results." },
      { key: "training", label: "Operator, support, HR and payroll training complete with named escalation contacts", status: "MANUAL", detail: "Record trainees and on-call contacts." },
    ],
  };
}

/* ------------------------------------------------------------ reports */

interface Filters {
  from: string;
  to: string;
  team?: string;
  project?: string;
  employee?: string;
  status?: string;
}

function filtersOf(req: MockReq): Filters {
  const tz = req.db.organization.timezone;
  const today = businessDate(new Date(), tz);
  return {
    from: req.query.from || addDays(today, -30),
    to: req.query.to || today,
    team: req.query.team || undefined,
    project: req.query.project || undefined,
    employee: req.query.employee || undefined,
    status: req.query.status || undefined,
  };
}

function scopedEmployees(req: MockReq, f: Filters): T.Employee[] {
  const vis = visibleEmployees(req.db, req.me, "report.read");
  return req.db.employees.filter(
    (e) =>
      e.employmentStatus !== "INVITED" &&
      (vis === "all" || vis.has(e.id)) &&
      (!f.team || e.teamId === f.team) &&
      (!f.employee || e.id === f.employee),
  );
}

const inRange = (iso: string | undefined, f: Filters, tz: string) => {
  if (!iso) return false;
  const d = iso.length === 10 ? iso : businessDate(iso, tz);
  return d >= f.from && d <= f.to;
};

const hours = (ms: number) => Math.round((ms / 3600_000) * 10) / 10;

function buildReport(req: MockReq, key: string): ReportResult {
  const { db, me } = req;
  const tz = db.organization.timezone;
  const f = filtersOf(req);
  const today = businessDate(new Date(), tz);
  const cat = REPORT_CATALOG.find((r) => r.key === key);
  if (!cat) fail(404, "NOT_FOUND", "Unknown report.");
  if (cat!.requires && !can(me, cat!.requires)) fail(403, "FORBIDDEN", "This report requires payroll access.");
  const emps = scopedEmployees(req, f);
  const empIds = new Set(emps.map((e) => e.id));
  const name = (id?: string) => (id && empIds.has(id) ? employeeLabel(db, id) : id ? "Restricted" : "—");
  const projectName = (id: string) => db.projects.find((p) => p.id === id)?.code ?? "—";
  const tasks = db.tasks.filter((t) => (!f.project || t.projectId === f.project) && (!t.assigneeId || empIds.has(t.assigneeId) || scopeOf(me, "report.read") === "organization") && (!f.status || t.state === f.status));
  let columns: ReportColumn[] = [];
  let rows: Record<string, string | number | null>[] = [];
  const notes: string[] = [];
  const now = Date.now();

  switch (key) {
    case "task-status-aging": {
      columns = [{ key: "task", label: "Task" }, { key: "project", label: "Project" }, { key: "assignee", label: "Assignee" }, { key: "state", label: "State" }, { key: "daysInState", label: "Days in state", align: "right" }, { key: "due", label: "Due (current)" }, { key: "baselineDue", label: "Due (baseline)" }, { key: "overdue", label: "Overdue" }];
      rows = tasks.filter((t) => !["COMPLETED", "CANCELLED"].includes(t.state)).map((t) => {
        const last = db.taskEvents.filter((e) => e.taskId === t.id).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
        return {
          task: t.title, project: projectName(t.projectId), assignee: name(t.assigneeId), state: t.state,
          daysInState: last ? Math.max(0, Math.floor((now - new Date(last.occurredAt).getTime()) / 86400_000)) : null,
          due: businessDate(t.dueAt, tz), baselineDue: businessDate(t.baselineDueAt, tz),
          overdue: new Date(t.dueAt).getTime() < now && !["SUBMITTED", "APPROVED"].includes(t.state) ? "Yes" : "No",
        };
      });
      break;
    }
    case "project-progress": {
      columns = [{ key: "code", label: "Code" }, { key: "name", label: "Project" }, { key: "manager", label: "Manager" }, { key: "state", label: "State" }, { key: "tasks", label: "Tasks", align: "right" }, { key: "done", label: "Accepted/closed", align: "right" }, { key: "pct", label: "% complete", align: "right" }, { key: "pendingReviews", label: "Pending reviews", align: "right" }, { key: "plannedEnd", label: "Planned end" }];
      rows = db.projects.filter((p) => (!f.project || p.id === f.project) && (scopeOf(me, "report.read") === "organization" || p.memberIds.some((m) => empIds.has(m)))).map((p) => {
        const ts = db.tasks.filter((t) => t.projectId === p.id && t.state !== "CANCELLED");
        const done = ts.filter((t) => ["APPROVED", "COMPLETED"].includes(t.state)).length;
        return { code: p.code, name: p.name, manager: employeeLabel(db, p.managerId), state: p.state, tasks: ts.length, done, pct: ts.length ? Math.round((done / ts.length) * 100) : null, pendingReviews: ts.filter((t) => t.state === "SUBMITTED").length, plannedEnd: p.plannedEnd };
      });
      break;
    }
    case "output-accepted": {
      columns = [{ key: "employee", label: "Employee" }, { key: "tasks", label: "Accepted tasks", align: "right" }, { key: "points", label: "Accepted points", align: "right" }, { key: "avgQuality", label: "Avg quality", align: "right" }];
      const approvals = db.reviews.filter((r) => r.decision === "APPROVE" && inRange(r.decidedAt, f, tz));
      rows = emps.map((e) => {
        const mine = approvals.filter((r) => db.tasks.find((t) => t.id === r.taskId)?.assigneeId === e.id && (!f.project || db.tasks.find((t) => t.id === r.taskId)?.projectId === f.project));
        const pts = mine.reduce((a, r) => a + Number(db.tasks.find((t) => t.id === r.taskId)?.baselinePoints ?? 0), 0);
        const q = mine.length ? mine.reduce((a, r) => a + Number(r.weightedQuality ?? 0), 0) / mine.length : null;
        return { employee: e.displayName, tasks: mine.length, points: pts, avgQuality: q === null ? null : Math.round(q * 100) / 100 };
      }).filter((r) => (r.tasks as number) > 0 || f.employee);
      notes.push("Output is counted once per accepted task baseline; uploads and revision counts are not output.");
      break;
    }
    case "review-turnaround": {
      columns = [{ key: "reviewer", label: "Reviewer" }, { key: "decisions", label: "Decisions", align: "right" }, { key: "approvals", label: "Approvals", align: "right" }, { key: "revisions", label: "Revisions requested", align: "right" }, { key: "avgHours", label: "Avg hours to decision", align: "right" }, { key: "pending", label: "Pending now", align: "right" }];
      const reviewers = new Set(db.reviews.map((r) => r.reviewerId).concat(db.tasks.filter((t) => t.state === "SUBMITTED" && t.reviewerId).map((t) => t.reviewerId!)));
      rows = Array.from(reviewers).filter((id) => scopeOf(me, "report.read") === "organization" || empIds.has(id)).map((rid) => {
        const decs = db.reviews.filter((r) => r.reviewerId === rid && inRange(r.decidedAt, f, tz));
        const durations = decs.map((r) => {
          const s = db.submissions.find((x) => x.id === r.submissionId);
          return s?.submittedAt ? new Date(r.decidedAt).getTime() - new Date(s.submittedAt).getTime() : 0;
        });
        return {
          reviewer: employeeLabel(db, rid), decisions: decs.length, approvals: decs.filter((d) => d.decision === "APPROVE").length,
          revisions: decs.filter((d) => d.decision === "REQUEST_REVISION").length,
          avgHours: durations.length ? hours(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
          pending: db.tasks.filter((t) => t.reviewerId === rid && t.state === "SUBMITTED").length,
        };
      });
      break;
    }
    case "revision-reasons": {
      columns = [{ key: "date", label: "Date" }, { key: "task", label: "Task" }, { key: "employee", label: "Assignee" }, { key: "reviewer", label: "Reviewer" }, { key: "failed", label: "Failed checklist items" }, { key: "feedback", label: "Feedback" }];
      rows = db.reviews.filter((r) => r.decision === "REQUEST_REVISION" && inRange(r.decidedAt, f, tz)).flatMap((r) => {
        const t = db.tasks.find((x) => x.id === r.taskId);
        if (!t || (t.assigneeId && !empIds.has(t.assigneeId))) return [];
        const failed = Object.entries(r.checklist).filter(([, v]) => !v).map(([k]) => t.acceptanceChecklist.find((c) => c.id === k)?.label ?? k);
        return [{ date: businessDate(r.decidedAt, tz), task: t.title, employee: name(t.assigneeId), reviewer: employeeLabel(db, r.reviewerId), failed: failed.join("; "), feedback: r.feedback }];
      });
      notes.push("Revision counts are diagnostic and are not an automatic pay penalty.");
      break;
    }
    case "workload": {
      columns = [{ key: "employee", label: "Employee" }, { key: "team", label: "Team" }, { key: "open", label: "Open tasks", align: "right" }, { key: "points", label: "Open points", align: "right" }, { key: "estimateHours", label: "Estimated hours", align: "right" }, { key: "overdue", label: "Overdue", align: "right" }, { key: "blocked", label: "Blocked", align: "right" }];
      const open = ["ASSIGNED", "IN_PROGRESS", "SUBMITTED", "REVISION_REQUESTED", "BLOCKED"];
      rows = emps.filter((e) => e.employmentStatus === "ACTIVE").map((e) => {
        const ts = db.tasks.filter((t) => t.assigneeId === e.id && open.includes(t.state) && (!f.project || t.projectId === f.project));
        return {
          employee: e.displayName, team: db.teams.find((t) => t.id === e.teamId)?.name ?? "—", open: ts.length,
          points: ts.reduce((a, t) => a + Number(t.baselinePoints), 0), estimateHours: Math.round(ts.reduce((a, t) => a + (t.estimateMinutes ?? 0), 0) / 6) / 10,
          overdue: ts.filter((t) => new Date(t.dueAt).getTime() < now && t.state !== "SUBMITTED").length, blocked: ts.filter((t) => t.state === "BLOCKED").length,
        };
      });
      break;
    }
    case "attendance-summary": {
      columns = [{ key: "employee", label: "Employee" }, { key: "scheduled", label: "Scheduled days", align: "right" }, { key: "present", label: "Present", align: "right" }, { key: "late", label: "Late", align: "right" }, { key: "incomplete", label: "Incomplete", align: "right" }, { key: "leave", label: "Leave", align: "right" }, { key: "holiday", label: "Holiday", align: "right" }, { key: "absent", label: "Absent / unknown", align: "right" }];
      rows = emps.filter((e) => e.employmentStatus === "ACTIVE").map((e) => {
        const shift = db.shiftTemplates.find((s) => e.teamId && s.assignedTeamIds.includes(e.teamId)) ?? db.shiftTemplates[0];
        const r = { scheduled: 0, present: 0, late: 0, incomplete: 0, leave: 0, holiday: 0, absent: 0 };
        for (let d = f.from; d <= f.to && d <= today; d = addDays(d, 1)) {
          if (!shift.weekdays.includes(weekday(d))) continue;
          if (d < e.startDate) continue;
          r.scheduled++;
          if (db.holidays.some((h) => h.date === d)) { r.holiday++; continue; }
          if (db.leaveRequests.some((l) => l.employeeId === e.id && l.status === "APPROVED" && l.startDate <= d && l.endDate >= d)) { r.leave++; continue; }
          const evs = db.attendanceEvents.filter((x) => x.employeeId === e.id && businessDate(x.occurredAt, tz) === d);
          const ci = evs.find((x) => x.kind === "CHECK_IN");
          if (!ci) { r.absent++; continue; }
          r.present++;
          const lateCut = new Date(zonedToUtc(d, shift.localStart, tz)).getTime() + shift.graceMinutes * 60000;
          if (new Date(ci.occurredAt).getTime() > lateCut) r.late++;
          if (!evs.some((x) => x.kind === "CHECK_OUT") && d !== today) r.incomplete++;
        }
        return { employee: e.displayName, ...r };
      });
      notes.push("Absent/unknown means no check-in evidence; it is reviewed by a person, not assumed to be unpaid.");
      break;
    }
    case "leave-ledger": {
      columns = [{ key: "employee", label: "Employee" }, { key: "type", label: "Leave type" }, { key: "entitlement", label: "Entitlement + carryover (days)", align: "right" }, { key: "used", label: "Used (days)", align: "right" }, { key: "reserved", label: "Reserved (days)", align: "right" }, { key: "balance", label: "Balance (days)", align: "right" }];
      for (const e of emps) {
        for (const lt of db.leaveTypes) {
          const entries = db.leaveLedger.filter((l) => l.employeeId === e.id && l.typeId === lt.id);
          if (!entries.length) continue;
          const sum = (types: T.LeaveLedgerEntry["entryType"][]) => entries.filter((x) => types.includes(x.entryType)).reduce((a, x) => a + x.deltaMinutes, 0) / 480;
          const ent = sum(["ENTITLEMENT", "CARRYOVER", "ACCRUAL", "ADJUSTMENT"]);
          const used = -sum(["USE"]);
          const reserved = -sum(["RESERVE"]);
          rows.push({ employee: e.displayName, type: lt.name, entitlement: ent, used, reserved, balance: Math.round((ent - used - reserved) * 100) / 100 });
        }
      }
      break;
    }
    case "overtime-vs-actual": {
      columns = [{ key: "date", label: "Date" }, { key: "employee", label: "Employee" }, { key: "task", label: "Task" }, { key: "requested", label: "Requested min", align: "right" }, { key: "actual", label: "Actual min", align: "right" }, { key: "approved", label: "Approved min", align: "right" }, { key: "status", label: "Status" }, { key: "unscheduled", label: "Unscheduled" }];
      rows = db.overtime.filter((o) => empIds.has(o.employeeId) && inRange(o.date, f, tz)).map((o) => ({
        date: o.date, employee: name(o.employeeId), task: db.tasks.find((t) => t.id === o.taskId)?.title ?? "—",
        requested: o.requestedMinutes, actual: o.actualMinutes ?? null, approved: o.approvedMinutes ?? null, status: o.status, unscheduled: o.unscheduled ? "Yes" : "No",
      }));
      notes.push("Unscheduled overtime is flagged for human review; it is never automatically declared unpaid.");
      break;
    }
    case "monitoring-coverage": {
      if (!can(me, "monitoring.summary.read")) fail(403, "FORBIDDEN", "Monitoring summaries require monitoring access.");
      const mvis = visibleEmployees(db, me, "monitoring.summary.read");
      columns = [{ key: "date", label: "Date" }, { key: "employee", label: "Employee" }, { key: "device", label: "Device" }, { key: "active", label: "Active min", align: "right" }, { key: "idle", label: "Idle min", align: "right" }, { key: "paused", label: "Paused min", align: "right" }, { key: "unknown", label: "Unknown min", align: "right" }, { key: "gaps", label: "Gaps", align: "right" }, { key: "coverage", label: "Known coverage %", align: "right" }];
      rows = db.sessions.filter((s) => empIds.has(s.employeeId) && (mvis === "all" || mvis.has(s.employeeId)) && inRange(s.startedAt, f, tz)).map((s) => {
        const total = s.activeMinutes + s.idleMinutes + s.pausedMinutes + s.unknownMinutes;
        return {
          date: businessDate(s.startedAt, tz), employee: name(s.employeeId), device: db.devices.find((d) => d.id === s.deviceId)?.hostname ?? "—",
          active: s.activeMinutes, idle: s.idleMinutes, paused: s.pausedMinutes, unknown: s.unknownMinutes,
          gaps: db.gaps.filter((g) => g.sessionId === s.id).length, coverage: total ? Math.round(((total - s.unknownMinutes) / total) * 1000) / 10 : null,
        };
      }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
      notes.push("Gaps are shown as unknown coverage, never as worked or idle time. No screenshots or URLs appear in reports.");
      break;
    }
    case "score-components": {
      if (!can(me, "score.read")) fail(403, "FORBIDDEN", "Score reports require score access.");
      columns = [{ key: "employee", label: "Employee" }, { key: "period", label: "Period" }, { key: "A", label: "A", align: "right" }, { key: "O", label: "O", align: "right" }, { key: "Q", label: "Q", align: "right" }, { key: "D", label: "D", align: "right" }, { key: "L", label: "L", align: "right" }, { key: "coverage", label: "Coverage", align: "right" }, { key: "score", label: "Score", align: "right" }, { key: "status", label: "Status" }];
      const svis = visibleEmployees(db, me, "score.read");
      rows = db.scores.filter((s) => empIds.has(s.employeeId) && (svis === "all" || svis.has(s.employeeId)) && s.periodEnd >= f.from && s.periodStart <= f.to).map((s) => {
        const c = Object.fromEntries(s.components.map((x) => [x.key, x.value === null ? "N/A" : x.value]));
        return { employee: name(s.employeeId), period: `${s.periodStart} – ${s.periodEnd}`, ...c, coverage: `${Math.round(s.coverageWeight * 100)}%`, score: s.override?.score ?? s.weightedScore, status: s.status } as Record<string, string | number | null>;
      });
      notes.push("Scores support coaching and review; they don't calculate wages or trigger penalties. Coverage below 100% is not a full comparable score.");
      break;
    }
    case "payroll-register": {
      columns = [{ key: "period", label: "Period" }, { key: "run", label: "Run" }, { key: "state", label: "State" }, { key: "employee", label: "Employee" }, { key: "gross", label: "Gross", align: "right" }, { key: "deductions", label: "Deductions", align: "right" }, { key: "net", label: "Net", align: "right" }, { key: "adjustments", label: "Approved adjustments" }];
      for (const run of db.payrollRuns) {
        const period = db.payrollPeriods.find((p) => p.id === run.periodId);
        if (period && (period.end < f.from || period.start > f.to)) continue;
        for (const l of db.payrollLines.filter((x) => x.runId === run.id && empIds.has(x.employeeId))) {
          rows.push({
            period: period?.label ?? "—", run: `r${run.revision}`, state: run.state, employee: name(l.employeeId), gross: l.gross, deductions: l.deductions, net: l.net,
            adjustments: l.components.filter((c) => c.category !== "BASE" && c.status === "APPROVED").map((c) => `${c.category}: ${c.amount}`).join("; ") || "—",
          });
        }
      }
      notes.push("Payroll exports never initiate bank transfers. Access is logged.");
      break;
    }
    case "asset-custody": {
      columns = [{ key: "tag", label: "Asset tag" }, { key: "model", label: "Model" }, { key: "type", label: "Type" }, { key: "state", label: "State" }, { key: "custodian", label: "Custodian" }, { key: "issued", label: "Issued" }, { key: "acknowledged", label: "Acknowledged" }];
      const org = scopeOf(me, "report.read") === "organization";
      rows = db.assets.filter((a) => (org || (a.assignedEmployeeId && empIds.has(a.assignedEmployeeId))) && (!f.status || a.state === f.status) && (!f.employee || a.assignedEmployeeId === f.employee)).map((a) => {
        const asg = db.assetAssignments.find((x) => x.assetId === a.id && !x.returnedAt);
        return { tag: a.assetTag, model: a.model, type: a.type, state: a.state, custodian: a.assignedEmployeeId ? name(a.assignedEmployeeId) : "—", issued: asg ? businessDate(asg.issuedAt, tz) : "—", acknowledged: asg ? (asg.acknowledgedAt ? "Yes" : "No") : "—" };
      });
      break;
    }
    case "storage-utilization": {
      if (scopeOf(me, "report.read") !== "organization") fail(403, "FORBIDDEN", "Storage utilization is an organization-level report.");
      const h = mediaHealth(db);
      columns = [{ key: "category", label: "Category" }, { key: "gb", label: "GiB", align: "right" }, { key: "pct", label: "% of pool", align: "right" }, { key: "files", label: "Tracked files", align: "right" }];
      rows = h.byCategory.map((c) => ({ category: c.category, gb: Math.round((c.bytes / GB) * 10) / 10, pct: Math.round((c.bytes / h.poolBytes) * 1000) / 10, files: db.media.filter((m) => m.category === c.category).length }));
      notes.push(`Pool: 2 TB. Used ${h.usedPct}%. Alerts at 70%, 85% and 95%.`);
      break;
    }
  }

  const finalPeriod = f.to < today && key !== "task-status-aging" && key !== "workload";
  return {
    key,
    title: cat!.title,
    meta: { timezone: tz, generatedAt: nowIso(), dataCutoff: nowIso(), policyVersion: db.organization.activePolicyVersion, state: finalPeriod ? "FINAL" : "PROVISIONAL" },
    columns,
    rows,
    notes,
  };
}

/* ------------------------------------------------------------ policy impact */

function impactPreview(db: MockDb, p: T.PolicyVersion): string {
  const current = db.policies.find((x) => x.type === p.type && x.status === "APPROVED");
  const changes = Object.keys(p.config).filter((k) => JSON.stringify(p.config[k]) !== JSON.stringify(current?.config[k]));
  const active = db.employees.filter((e) => e.employmentStatus === "ACTIVE").length;
  const parts = [changes.length ? `Changes vs v${current?.version ?? "—"}: ${changes.map((k) => `${k} ${current?.config[k] ?? "unset"} → ${p.config[k]}`).join(", ")}.` : "No configuration changes vs the approved version."];
  if (p.type === "MONITORING") parts.push(`Collection scope change: all ${db.devices.filter((d) => d.status === "ACTIVE").length} enrolled employees must acknowledge v${p.version} before new sessions start.`);
  if (p.type === "COMPENSATION") parts.push("Applies to payroll periods starting on or after the effective date; locked runs are not changed.");
  if (p.type === "RETENTION") parts.push("Approval enables retention jobs and removes a production release blocker.");
  if (p.type === "ATTENDANCE" || p.type === "LEAVE") parts.push(`Affects ${active} active employees from the effective date; history keeps its original policy version.`);
  return parts.join(" ");
}

/* ------------------------------------------------------------ routes */

const ROLE_KEYS: T.RoleKey[] = ["OWNER", "ADMIN", "HR", "PAYROLL", "MANAGER", "REVIEWER", "EMPLOYEE", "AUDITOR"];

export const adminRoutes = [
  /* ---------------------------------------- invitations & users */
  route("GET", "/invitations", (req) => {
    requirePerm(req.me, "user.invite");
    for (const i of req.db.invitations) if (i.status === "PENDING" && new Date(i.expiresAt).getTime() < Date.now()) i.status = "EXPIRED";
    return { items: [...req.db.invitations].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
  }),
  route("POST", "/invitations", (req) => {
    requirePerm(req.me, "user.invite");
    const { email, role, teamId } = req.body as { email: string; role: T.RoleKey; teamId?: string };
    const errs: Record<string, string> = {};
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errs.email = "Enter a valid work email.";
    else if (req.db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) errs.email = "This person already has an account.";
    else if (req.db.invitations.some((i) => i.status === "PENDING" && i.email.toLowerCase() === email.toLowerCase())) errs.email = "A pending invitation already exists.";
    if (!ROLE_KEYS.includes(role)) errs.role = "Choose a role.";
    if (Object.keys(errs).length) validation(errs);
    if ((role === "OWNER" || PRIVILEGED_ROLES.includes(role)) && !req.me.roles.includes("OWNER")) fail(403, "FORBIDDEN", "Only the owner can invite privileged roles.");
    const inv: T.Invitation = { id: uuid(), email: email.toLowerCase(), role, teamId, expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(), status: "PENDING", createdAt: nowIso() };
    req.db.invitations.unshift(inv);
    audit(req, "invitation.create", "Invitation", inv.id, { after: { email: inv.email, role } });
    return inv;
  }),
  route("POST", "/invitations/:id/revoke", (req) => {
    requirePerm(req.me, "user.invite");
    const inv = req.db.invitations.find((i) => i.id === req.params.id);
    if (!inv) fail(404, "NOT_FOUND", "Invitation not found.");
    if (inv!.status !== "PENDING") fail(409, "INVALID_TRANSITION", "Only pending invitations can be revoked.");
    inv!.status = "REVOKED";
    audit(req, "invitation.revoke", "Invitation", inv!.id, { reason: req.body.reason });
    return inv;
  }),
  route("GET", "/users", (req) => {
    requirePerm(req.me, "role.assign");
    return {
      items: req.db.users.map((u) => ({ ...u, name: req.db.employees.find((e) => e.userId === u.id)?.displayName ?? u.email, roles: rolesForUser(req.db, u.id) })),
    };
  }),
  route("POST", "/users/:id/deactivate", (req) => {
    requirePerm(req.me, "user.deactivate");
    const u = req.db.users.find((x) => x.id === req.params.id);
    if (!u) fail(404, "NOT_FOUND", "User not found.");
    if (u!.id === req.me.user.id) fail(422, "POLICY_BLOCKED", "You can't deactivate your own account.");
    if (rolesForUser(req.db, u!.id).includes("OWNER")) fail(422, "POLICY_BLOCKED", "The owner account can't be deactivated here.");
    if (!req.body.reason || String(req.body.reason).trim().length < 3) validation({ reason: "A reason is required." });
    u!.status = "SUSPENDED";
    const e = req.db.employees.find((x) => x.userId === u!.id);
    if (e && e.employmentStatus === "ACTIVE") e.employmentStatus = "SUSPENDED";
    for (const d of req.db.devices) if (d.employeeId === e?.id && d.status !== "REVOKED") { d.status = "REVOKED"; d.revokedAt = nowIso(); }
    for (const s of req.db.sessions) if (s.employeeId === e?.id && s.state !== "STOPPED") { s.state = "STOPPED"; s.endedAt = nowIso(); }
    audit(req, "user.deactivate", "User", u!.id, { reason: req.body.reason });
    notifyRole(req.db, "OWNER", { kind: "SECURITY", title: "Account deactivated", body: `${e?.displayName ?? u!.email} was deactivated; sessions and device keys revoked.`, href: "/admin?tab=roles", mandatory: true });
    return { ok: true };
  }),

  /* ---------------------------------------- teams */
  route("GET", "/teams", (req) => {
    requirePerm(req.me, "employee.read");
    return { items: req.db.teams.map((t) => ({ ...t, managerName: t.managerEmployeeId ? employeeLabel(req.db, t.managerEmployeeId) : undefined })) };
  }),
  route("POST", "/teams", (req) => {
    requirePerm(req.me, "team.manage");
    const { name, managerEmployeeId } = req.body;
    if (!name?.trim()) validation({ name: "Team name is required." });
    if (req.db.teams.some((t) => t.name.toLowerCase() === name.trim().toLowerCase())) validation({ name: "A team with this name exists." });
    const t: T.Team = { ...orgBase(req.db), id: uuid(), name: name.trim(), managerEmployeeId: managerEmployeeId || undefined, memberIds: [] };
    req.db.teams.push(t);
    audit(req, "team.create", "Team", t.id);
    return t;
  }),
  route("PATCH", "/teams/:id", (req) => {
    requirePerm(req.me, "team.manage");
    const t = req.db.teams.find((x) => x.id === req.params.id);
    if (!t) fail(404, "NOT_FOUND", "Team not found.");
    checkVersion(req, t!);
    const before = { name: t!.name, managerEmployeeId: t!.managerEmployeeId, memberIds: t!.memberIds };
    if (req.body.name !== undefined) {
      if (!String(req.body.name).trim()) validation({ name: "Team name is required." });
      t!.name = String(req.body.name).trim();
    }
    if (req.body.managerEmployeeId !== undefined) t!.managerEmployeeId = req.body.managerEmployeeId || undefined;
    if (Array.isArray(req.body.memberIds)) {
      const inactive = (req.body.memberIds as string[]).filter((m) => req.db.employees.find((e) => e.id === m)?.employmentStatus === "OFFBOARDED");
      if (inactive.length) validation({ memberIds: "Offboarded employees can't be added to a team." });
      t!.memberIds = req.body.memberIds;
    }
    bump(t!);
    audit(req, "team.update", "Team", t!.id, { before, after: req.body });
    return t;
  }),

  /* ---------------------------------------- role assignments */
  route("GET", "/role-assignments", (req) => {
    requirePerm(req.me, "role.assign");
    return {
      items: req.db.roleAssignments
        .map((r) => ({ ...r, userName: req.db.employees.find((e) => e.userId === r.userId)?.displayName ?? req.db.users.find((u) => u.id === r.userId)?.email ?? r.userId, scopeName: r.scopeId ? req.db.teams.find((t) => t.id === r.scopeId)?.name ?? req.db.projects.find((p) => p.id === r.scopeId)?.code : undefined }))
        .sort((a, b) => a.userName.localeCompare(b.userName)),
    };
  }),
  route("POST", "/role-assignments", (req) => {
    requirePerm(req.me, "role.assign");
    const { userId, role, scopeType, scopeId, validFrom, validTo, reason } = req.body as { userId: string; role: T.RoleKey; scopeType: T.ScopeType; scopeId?: string; validFrom: string; validTo?: string; reason?: string };
    const errs: Record<string, string> = {};
    if (!req.db.users.some((u) => u.id === userId)) errs.userId = "Choose a person.";
    if (!ROLE_KEYS.includes(role)) errs.role = "Choose a role.";
    if (!validFrom) errs.validFrom = "Start date is required.";
    if (validTo && validFrom && validTo < validFrom) errs.validTo = "End date must be after the start date.";
    if ((scopeType === "team" || scopeType === "project") && !scopeId) errs.scopeId = "Choose a scope.";
    if (role === "AUDITOR" && !validTo) errs.validTo = "Auditor access must have a defined end date.";
    if (!reason || reason.trim().length < 3) errs.reason = "A reason is required.";
    if (Object.keys(errs).length) validation(errs);
    if ((role === "OWNER" || PRIVILEGED_ROLES.includes(role)) && !req.me.roles.includes("OWNER")) fail(403, "FORBIDDEN", "Only the owner can assign privileged roles.");
    const today = new Date().toISOString().slice(0, 10);
    if (req.db.roleAssignments.some((r) => r.userId === userId && r.role === role && (r.scopeId ?? null) === (scopeId ?? null) && (!r.validTo || r.validTo >= today))) validation({ role: "This person already has this role in this scope." });
    const ra: T.RoleAssignment = { ...orgBase(req.db), id: uuid(), userId, role, scopeType, scopeId, validFrom, validTo, approvedBy: req.me.user.id };
    req.db.roleAssignments.push(ra);
    audit(req, "role.assign", "RoleAssignment", ra.id, { reason, after: { userId, role, scopeType, scopeId, validFrom, validTo } });
    const emp = req.db.employees.find((e) => e.userId === userId);
    if (PRIVILEGED_ROLES.includes(role)) notifyRole(req.db, "OWNER", { kind: "SECURITY", title: "Privileged role assigned", body: `${emp?.displayName ?? userId} was granted ${role}.`, href: "/admin?tab=roles", mandatory: true });
    return ra;
  }),
  route("POST", "/role-assignments/:id/end", (req) => {
    requirePerm(req.me, "role.assign");
    const ra = req.db.roleAssignments.find((r) => r.id === req.params.id);
    if (!ra) fail(404, "NOT_FOUND", "Role assignment not found.");
    if (ra!.role === "OWNER" && req.db.roleAssignments.filter((r) => r.role === "OWNER" && !r.validTo).length <= 1) fail(422, "POLICY_BLOCKED", "The organization must keep at least one owner.");
    if (PRIVILEGED_ROLES.includes(ra!.role) && !req.me.roles.includes("OWNER")) fail(403, "FORBIDDEN", "Only the owner can end privileged roles.");
    if (!req.body.reason || String(req.body.reason).trim().length < 3) validation({ reason: "A reason is required." });
    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    ra!.validTo = yesterday < ra!.validFrom ? ra!.validFrom : yesterday;
    bump(ra!);
    audit(req, "role.end", "RoleAssignment", ra!.id, { reason: req.body.reason });
    return ra;
  }),

  /* ---------------------------------------- policies */
  route("GET", "/policies", (req) => {
    requirePerm(req.me, "policy.read");
    return {
      items: [...req.db.policies].sort((a, b) => a.type.localeCompare(b.type) || b.version - a.version).map((p) => ({ ...p, impact: impactPreview(req.db, p), approverName: p.approvedBy ? employeeLabel(req.db, p.approvedBy) : undefined })),
    };
  }),
  route("POST", "/policies", (req) => {
    if (!can(req.me, "policy.draft") && !can(req.me, "policy.approve")) fail(403, "FORBIDDEN", "You can't draft policies.");
    const { type, title, summary, config, effectiveFrom } = req.body as Partial<T.PolicyVersion>;
    const errs: Record<string, string> = {};
    if (!type) errs.type = "Choose a policy type.";
    if (!title?.trim()) errs.title = "Title is required.";
    if (!summary?.trim()) errs.summary = "Summary is required.";
    if (!effectiveFrom) errs.effectiveFrom = "Effective date is required.";
    if (Object.keys(errs).length) validation(errs);
    const latest = req.db.policies.filter((p) => p.type === type).sort((a, b) => b.version - a.version)[0];
    const p: T.PolicyVersion = { id: uuid(), type: type!, version: (latest?.version ?? 0) + 1, title: title!.trim(), summary: summary!.trim(), config: config ?? latest?.config ?? {}, effectiveFrom: effectiveFrom!, status: "DRAFT" };
    req.db.policies.push(p);
    audit(req, "policy.draft", "PolicyVersion", p.id);
    return { ...p, impact: impactPreview(req.db, p) };
  }),
  route("POST", "/policies/:id/submit", (req) => {
    if (!can(req.me, "policy.draft") && !can(req.me, "policy.approve")) fail(403, "FORBIDDEN", "You can't submit policies.");
    const p = req.db.policies.find((x) => x.id === req.params.id);
    if (!p) fail(404, "NOT_FOUND", "Policy not found.");
    if (p!.status !== "DRAFT") fail(409, "INVALID_TRANSITION", "Only drafts can be submitted for approval.");
    p!.status = "PENDING_APPROVAL";
    audit(req, "policy.submit", "PolicyVersion", p!.id);
    notifyRole(req.db, "OWNER", { kind: "POLICY_ACK", title: "Policy awaiting approval", body: `${p!.title} needs owner approval.`, href: "/admin?tab=policies", mandatory: true });
    return p;
  }),
  route("POST", "/policies/:id/approve", (req) => {
    requirePerm(req.me, "policy.approve");
    const p = req.db.policies.find((x) => x.id === req.params.id);
    if (!p) fail(404, "NOT_FOUND", "Policy not found.");
    if (!["PENDING_APPROVAL", "DRAFT"].includes(p!.status)) fail(409, "INVALID_TRANSITION", "This policy version can't be approved.");
    if (!req.body.reason || String(req.body.reason).trim().length < 3) validation({ reason: "Record the approval rationale." });
    for (const x of req.db.policies) if (x.type === p!.type && x.status === "APPROVED") x.status = "SUPERSEDED";
    p!.status = "APPROVED";
    p!.approvedBy = req.me.employee?.id;
    p!.approvedAt = nowIso();
    if (p!.type === "MONITORING") {
      req.db.organization.activePolicyVersion = p!.version;
      for (const u of req.db.users) {
        const emp = req.db.employees.find((e) => e.userId === u.id);
        if (emp && req.db.devices.some((d) => d.employeeId === emp.id && d.status === "ACTIVE")) {
          req.db.notifications.unshift({ id: uuid(), userId: u.id, kind: "POLICY_ACK", title: `Acknowledge monitoring policy v${p!.version}`, body: "The collection scope changed. New tracking sessions require your acknowledgement.", href: "/tracking", mandatory: true, createdAt: nowIso() });
        }
      }
    }
    audit(req, "policy.approve", "PolicyVersion", p!.id, { reason: req.body.reason });
    return { ...p, impact: impactPreview(req.db, p!) };
  }),

  /* ---------------------------------------- organization & ops */
  route("GET", "/admin/organization", (req) => {
    if (!can(req.me, "admin.settings") && !can(req.me, "policy.read")) fail(403, "FORBIDDEN", "Administration access required.");
    return { ...req.db.organization, canEdit: can(req.me, "admin.settings") };
  }),
  route("PATCH", "/admin/organization", (req) => {
    requirePerm(req.me, "admin.settings");
    const { name, timezone, payrollCurrency } = req.body;
    const errs: Record<string, string> = {};
    if (name !== undefined && !String(name).trim()) errs.name = "Name is required.";
    if (timezone !== undefined) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: timezone });
      } catch {
        errs.timezone = "Enter a valid IANA timezone, e.g. Asia/Karachi.";
      }
    }
    if (payrollCurrency !== undefined && !/^[A-Z]{3}$/.test(payrollCurrency)) errs.payrollCurrency = "Use an ISO 4217 code like PKR.";
    if (Object.keys(errs).length) validation(errs);
    const before = { ...req.db.organization };
    if (payrollCurrency && payrollCurrency !== before.payrollCurrency && req.db.payrollRuns.some((r) => ["UNDER_REVIEW", "DRAFT"].includes(r.state)))
      fail(422, "POLICY_BLOCKED", "Finish or reopen the open payroll run before changing the payroll currency.");
    Object.assign(req.db.organization, { ...(name !== undefined && { name: String(name).trim() }), ...(timezone && { timezone }), ...(payrollCurrency && { payrollCurrency }) });
    audit(req, "organization.update", "Organization", req.db.organization.id, { before, after: req.body });
    return req.db.organization;
  }),
  route("GET", "/admin/media-health", (req) => {
    if (!can(req.me, "media.health.read") && !can(req.me, "admin.settings")) fail(403, "FORBIDDEN", "Media health is visible to administrators.");
    return mediaHealth(req.db);
  }),
  route("GET", "/admin/agent-versions", (req) => {
    requirePerm(req.me, "device.read");
    return agentVersions(req.db);
  }),
  route("GET", "/admin/retention", (req) => {
    if (!can(req.me, "admin.settings")) fail(403, "FORBIDDEN", "Administration access required.");
    return retention(req.db);
  }),
  route("GET", "/admin/release-checklist", (req) => {
    if (!can(req.me, "admin.settings")) fail(403, "FORBIDDEN", "Administration access required.");
    return releaseChecklist(req.db);
  }),

  /* ---------------------------------------- audit */
  route("GET", "/audit", (req) => {
    requirePerm(req.me, "audit.read");
    const { actor, action, targetType, result, from, to, q } = req.query;
    const tz = req.db.organization.timezone;
    const rows = req.db.audit
      .filter((a) => !actor || a.actorLabel.toLowerCase().includes(actor.toLowerCase()) || a.actorId === actor)
      .filter((a) => !action || a.action.startsWith(action))
      .filter((a) => !targetType || a.targetType === targetType)
      .filter((a) => !result || a.result === result)
      .filter((a) => !from || businessDate(a.occurredAt, tz) >= from)
      .filter((a) => !to || businessDate(a.occurredAt, tz) <= to)
      .filter((a) => matchesSearch(q, a.action, a.targetId, a.reason, a.actorLabel))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));
    const page = paginate(rows, req.query);
    return { ...page, total: rows.length, targetTypes: Array.from(new Set(req.db.audit.map((a) => a.targetType))).sort() };
  }),

  /* ---------------------------------------- reports */
  route("GET", "/reports", (req) => {
    requirePerm(req.me, "report.read");
    return { items: REPORT_CATALOG.filter((r) => !r.requires || can(req.me, r.requires)) };
  }),
  route("GET", "/reports/:key", (req) => {
    requirePerm(req.me, "report.read");
    return buildReport(req, req.params.key);
  }),
  route("POST", "/reports/exports", (req): ExportResult => {
    requirePerm(req.me, "report.read");
    const key = String(req.body.key ?? "");
    req.query = { ...(req.body.filters ?? {}) };
    const report = buildReport(req, key);
    const csv = toCsv(report.columns, report.rows);
    const id = uuid();
    audit(req, "report.export", "Report", key, { after: { rows: report.rows.length, filters: req.body.filters ?? {} } });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    return { id, filename: `${key}-${stamp}.csv`, csv, expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString() };
  }),
];
