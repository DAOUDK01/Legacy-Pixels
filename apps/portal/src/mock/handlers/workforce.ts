/** Workforce routes: attendance, corrections, shifts, holidays, leave and overtime (spec sections 8-9). */
import type * as T from "@/lib/types";
import { can } from "@/lib/rbac";
import { addDays, businessDate, weekday, zonedToUtc } from "@/lib/time";
import type {
  AttendanceNowStatus, AttendanceResponse, CorrectionRow, LeaveBalance, LeaveRequestRow, OvertimeRow, TeamAttendanceRow,
} from "@/lib/api/workforce";
import type { MockDb } from "../db";
import {
  audit, bump, canSeeEmployee, checkVersion, employeeLabel, fail, notifyEmployee, notifyRole, nowIso, requirePerm, uuid,
  validation, visibleEmployees, type MockReq,
} from "../helpers";
import { route } from "../routes";

const MIN = 60000;
const minutesBetween = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / MIN));
const overlap = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
const tzOf = (db: MockDb) => db.organization.timezone;
const todayOf = (db: MockDb) => businessDate(new Date(), tzOf(db));

/* ------------------------------------------------------------------ shift resolution */

function shiftFor(db: MockDb, employeeId: string, date: string): T.ShiftTemplate | undefined {
  const emp = db.employees.find((e) => e.id === employeeId);
  if (!emp?.teamId) return undefined;
  return db.shiftTemplates.find(
    (s) =>
      s.assignedTeamIds.includes(emp.teamId!) &&
      s.effectiveFrom <= date &&
      (!s.effectiveTo || s.effectiveTo >= date) &&
      s.weekdays.includes(weekday(date)),
  );
}

/** Resolve a template on a business date to UTC bounds. Overnight shifts end on the next day but belong to the start date. */
function resolveShift(s: T.ShiftTemplate, date: string) {
  const start = zonedToUtc(date, s.localStart, s.timezone);
  const endDate = s.localEnd <= s.localStart ? addDays(date, 1) : date;
  const end = zonedToUtc(endDate, s.localEnd, s.timezone);
  return { start, end, spanMinutes: minutesBetween(start, end) };
}

function teamShiftFor(db: MockDb, employeeId: string): T.ShiftTemplate | undefined {
  const emp = db.employees.find((e) => e.id === employeeId);
  return db.shiftTemplates.find((s) => emp?.teamId && s.assignedTeamIds.includes(emp.teamId));
}

/* ------------------------------------------------------------------ daily attendance */

export function computeDaily(db: MockDb, employeeId: string, date: string): T.DailyAttendance {
  const tz = tzOf(db);
  const today = todayOf(db);
  const now = Date.now();
  const flags: string[] = [];
  const s = shiftFor(db, employeeId, date);
  const holiday = db.holidays.find((h) => h.date === date);
  const leave = db.leaveRequests.find((l) => l.employeeId === employeeId && l.status === "APPROVED" && l.startDate <= date && l.endDate >= date);
  const otMinutes = db.overtime
    .filter((o) => o.employeeId === employeeId && o.date === date && o.status === "PAYROLL_VALIDATED")
    .reduce((a, o) => a + (o.approvedMinutes ?? 0), 0);

  const day: T.DailyAttendance = {
    employeeId, businessDate: date, shiftName: s?.name, breakMinutes: 0, scheduledMinutes: 0, creditedMinutes: 0,
    trackedMinutes: 0, overtimeMinutes: otMinutes, status: "OFF", provisional: false, flags,
  };

  // Events attributed to this date: window around the scheduled shift, or the calendar day when unscheduled.
  let winStart: number;
  let winEnd: number;
  let sched: ReturnType<typeof resolveShift> | undefined;
  if (s) {
    sched = resolveShift(s, date);
    day.scheduledStart = sched.start;
    day.scheduledEnd = sched.end;
    winStart = new Date(sched.start).getTime() - 4 * 3600000;
    winEnd = new Date(sched.end).getTime() + 6 * 3600000;
  } else {
    winStart = new Date(zonedToUtc(date, "00:00", tz)).getTime();
    winEnd = winStart + 24 * 3600000;
  }
  const events = db.attendanceEvents
    .filter((e) => e.employeeId === employeeId && new Date(e.occurredAt).getTime() >= winStart && new Date(e.occurredAt).getTime() < winEnd)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  let checkIn = events.find((e) => e.kind === "CHECK_IN")?.occurredAt;
  let checkOut = [...events].reverse().find((e) => e.kind === "CHECK_OUT")?.occurredAt;
  if (checkIn && checkOut && checkOut < checkIn) checkOut = undefined;

  // Approved correction revision replaces the interval; original events remain for audit.
  const correction = db.corrections.filter((c) => c.employeeId === employeeId && c.businessDate === date && c.status === "APPROVED").pop();
  if (correction) {
    if (correction.proposedCheckIn) checkIn = correction.proposedCheckIn;
    if (correction.proposedCheckOut) checkOut = correction.proposedCheckOut;
    flags.push("Corrected (approved revision)");
  }
  if (db.corrections.some((c) => c.employeeId === employeeId && c.businessDate === date && ["PROPOSED", "MANAGER_VALIDATED"].includes(c.status))) {
    flags.push("Correction pending");
  }
  if (events.some((e) => e.source === "MANUAL")) flags.push("Manual entry");
  day.checkIn = checkIn;
  day.checkOut = checkOut;

  // Breaks
  let breakMin = 0;
  const breaks: [number, number][] = [];
  let open: number | null = null;
  for (const e of events) {
    if (e.kind === "BREAK_START") open = new Date(e.occurredAt).getTime();
    if (e.kind === "BREAK_END" && open !== null) {
      breaks.push([open, new Date(e.occurredAt).getTime()]);
      breakMin += Math.round((new Date(e.occurredAt).getTime() - open) / MIN);
      open = null;
    }
  }
  if (open !== null) {
    breaks.push([open, date === today ? now : open]);
    if (date === today) breakMin += Math.round((now - open) / MIN);
    flags.push("Break still open");
  }
  day.breakMinutes = breakMin;

  // Tracked time from authorized sessions (separate evidence, linked only for display)
  day.trackedMinutes = db.sessions
    .filter((x) => x.employeeId === employeeId && businessDate(x.startedAt, tz) === date)
    .reduce((a, x) => a + x.activeMinutes + x.idleMinutes, 0);

  if (holiday) {
    day.status = "HOLIDAY";
    flags.push(holiday.name);
    if (checkIn) flags.push("Worked on holiday");
    return day;
  }
  if (!s || !sched) {
    day.status = checkIn ? "PRESENT" : "OFF";
    if (checkIn) flags.push("Unscheduled attendance");
    return day;
  }

  const unpaid = s.unpaidBreakMinutes;
  day.scheduledMinutes = sched.spanMinutes - unpaid;

  if (leave) {
    const partial = leave.partialMinutes;
    if (!partial) {
      day.status = "LEAVE";
      day.scheduledMinutes = 0; // approved excused minutes remove the day from eligibility
      flags.push("Approved leave");
      return day;
    }
    day.scheduledMinutes = Math.max(0, day.scheduledMinutes - partial);
    flags.push(`Partial leave ${partial}m`);
  }

  const sStart = new Date(sched.start).getTime();
  const sEnd = new Date(sched.end).getTime();
  if (!checkIn) {
    if (date > today || (date === today && now < sStart + s.graceMinutes * MIN)) {
      day.status = "UNKNOWN";
      day.provisional = true;
      flags.push(date > today ? "Future date" : "Shift not started");
    } else if (date === today) {
      day.status = "ABSENT";
      day.provisional = true;
      flags.push("No check-in yet");
    } else {
      day.status = "ABSENT";
    }
    return day;
  }

  const inT = new Date(checkIn).getTime();
  let outT: number;
  if (checkOut) outT = new Date(checkOut).getTime();
  else if (date === today && now < sEnd + 2 * 3600000) outT = now;
  else {
    // Missing checkout: provisional end at last known event, never an assumed full shift.
    outT = Math.max(inT, ...events.map((e) => new Date(e.occurredAt).getTime()));
    flags.push("Missing checkout — provisional end, review required");
  }
  let credited = overlap(inT, outT, sStart, sEnd) / MIN;
  for (const [b1, b2] of breaks) credited -= overlap(b1, b2, Math.max(inT, sStart), Math.min(outT, sEnd)) / MIN;
  // Unpaid break is deducted even if not recorded as an event
  if (breaks.length === 0 && outT - inT > 5 * 3600000) credited -= unpaid;
  day.creditedMinutes = Math.max(0, Math.min(Math.round(credited), day.scheduledMinutes));

  const lateBy = Math.round((inT - sStart) / MIN);
  if (!checkOut && !(date === today)) {
    day.status = "INCOMPLETE";
    day.provisional = true;
  } else if (lateBy > s.graceMinutes) {
    day.status = "LATE";
    flags.push(`Late by ${lateBy}m (grace ${s.graceMinutes}m)`);
  } else {
    day.status = "PRESENT";
  }
  if (date === today && !checkOut) {
    day.provisional = true;
    flags.push("In progress");
  }
  if (events.some((e) => Math.abs(new Date(e.receivedAt).getTime() - new Date(e.occurredAt).getTime()) > 2 * MIN)) flags.push("Clock skew detected");
  return day;
}

function rangeDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 93; d = addDays(d, 1)) out.push(d);
  return out;
}

function totals(days: T.DailyAttendance[]): AttendanceResponse["totals"] {
  return {
    scheduledMinutes: days.reduce((a, d) => a + d.scheduledMinutes, 0),
    creditedMinutes: days.reduce((a, d) => a + d.creditedMinutes, 0),
    trackedMinutes: days.reduce((a, d) => a + d.trackedMinutes, 0),
    overtimeMinutes: days.reduce((a, d) => a + d.overtimeMinutes, 0),
    late: days.filter((d) => d.status === "LATE").length,
    absent: days.filter((d) => d.status === "ABSENT" && !d.provisional).length,
    incomplete: days.filter((d) => d.status === "INCOMPLETE").length,
  };
}

function nowStatus(db: MockDb, employeeId: string): { status: AttendanceNowStatus; events: T.AttendanceEvent[] } {
  const since = Date.now() - 20 * 3600000;
  const events = db.attendanceEvents
    .filter((e) => e.employeeId === employeeId && new Date(e.occurredAt).getTime() >= since)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  // Only events since the last check-in matter for the open interval
  const lastIn = events.map((e) => e.kind).lastIndexOf("CHECK_IN");
  const current = lastIn >= 0 ? events.slice(lastIn) : [];
  const last = current[current.length - 1];
  const map: Record<T.AttendanceEventKind, AttendanceNowStatus> = { CHECK_IN: "WORKING", BREAK_END: "WORKING", BREAK_START: "ON_BREAK", CHECK_OUT: "CHECKED_OUT" };
  return { status: last ? map[last.kind] : "NOT_CHECKED_IN", events: current };
}

function attendanceFor(db: MockDb, employeeId: string, from: string, to: string): AttendanceResponse {
  const days = rangeDays(from, to).map((d) => computeDaily(db, employeeId, d)).reverse();
  const ns = nowStatus(db, employeeId);
  const today = todayOf(db);
  const s = shiftFor(db, employeeId, today) ?? teamShiftFor(db, employeeId);
  const r = s && s.weekdays.includes(weekday(today)) ? resolveShift(s, today) : undefined;
  const next: AttendanceResponse["today"]["nextActions"] =
    ns.status === "NOT_CHECKED_IN" || ns.status === "CHECKED_OUT" ? ["CHECK_IN"] : ns.status === "WORKING" ? ["BREAK_START", "CHECK_OUT"] : ["BREAK_END"];
  return {
    employeeId, from, to, timezone: tzOf(db), days,
    today: { status: ns.status, events: ns.events, shift: s ? { name: s.name, start: r?.start, end: r?.end } : undefined, nextActions: next },
    totals: totals(days),
  };
}

function range(req: MockReq): [string, string] {
  const today = todayOf(req.db);
  const to = req.query.to ?? today;
  const from = req.query.from ?? addDays(to, -13);
  if (from > to) validation({ from: "Start date must be on or before the end date." });
  return [from, to];
}

function lockedPayrollFor(db: MockDb, date: string): boolean {
  const period = db.payrollPeriods.find((p) => p.start <= date && p.end >= date);
  if (!period) return false;
  return db.payrollRuns.some((r) => r.periodId === period.id && ["LOCKED", "EXPORTED", "PAID"].includes(r.state));
}

function isManagerOf(db: MockDb, managerEmpId: string | undefined, employeeId: string): boolean {
  if (!managerEmpId) return false;
  const emp = db.employees.find((e) => e.id === employeeId);
  if (emp?.managerId === managerEmpId) return true;
  return db.teams.some((t) => t.managerEmployeeId === managerEmpId && t.memberIds.includes(employeeId));
}

/* ------------------------------------------------------------------ corrections */

function correctionRow(req: MockReq, c: T.AttendanceCorrection): CorrectionRow {
  const { db, me } = req;
  const eid = me.employee?.id;
  return {
    ...c,
    employeeName: employeeLabel(db, c.employeeId),
    canValidate: c.status === "PROPOSED" && c.employeeId !== eid && can(me, "attendance.recommend") && (isManagerOf(db, eid, c.employeeId) || canSeeEmployee(db, me, "attendance.read", c.employeeId)),
    canApprove: c.status === "MANAGER_VALIDATED" && c.employeeId !== eid && can(me, "attendance.approve"),
  };
}

/* ------------------------------------------------------------------ leave */

function balances(db: MockDb, employeeId: string): LeaveBalance[] {
  return db.leaveTypes.map((type) => {
    const entries = db.leaveLedger.filter((l) => l.employeeId === employeeId && l.typeId === type.id);
    const sum = (types: T.LeaveLedgerEntry["entryType"][]) => entries.filter((e) => types.includes(e.entryType)).reduce((a, e) => a + e.deltaMinutes, 0);
    const entitled = sum(["ENTITLEMENT", "ACCRUAL", "CARRYOVER"]);
    const used = -sum(["USE"]);
    const reserved = -sum(["RESERVE"]);
    const adjustment = sum(["ADJUSTMENT", "REVERSAL"]);
    const pending = db.leaveRequests.filter((r) => r.employeeId === employeeId && r.typeId === type.id && r.status === "PENDING").reduce((a, r) => a + r.requestedMinutes, 0);
    return {
      type, entitledMinutes: entitled, usedMinutes: used, reservedMinutes: reserved, adjustmentMinutes: adjustment,
      availableMinutes: entries.reduce((a, e) => a + e.deltaMinutes, 0), pendingMinutes: pending,
    };
  });
}

function leaveRow(req: MockReq, l: T.LeaveRequest): LeaveRequestRow {
  const { db, me } = req;
  const eid = me.employee?.id;
  const today = todayOf(db);
  const isHr = can(me, "leave.approve");
  const own = l.employeeId === eid;
  // A manager's own leave routes to their manager (another approver).
  const recommender = isManagerOf(db, eid, l.employeeId) && !own;
  return {
    ...l,
    note: own || isHr ? l.note : undefined,
    noteHidden: !(own || isHr) && !!l.note,
    employeeName: employeeLabel(db, l.employeeId),
    typeName: db.leaveTypes.find((t) => t.id === l.typeId)?.name ?? "Leave",
    canRecommend: l.status === "PENDING" && !l.managerDecision && recommender && can(me, "leave.recommend"),
    canDecide: l.status === "PENDING" && isHr && !own,
    canWithdraw: own && ["PENDING", "DRAFT"].includes(l.status),
    canCancel: l.status === "APPROVED" && isHr && !own && l.startDate > today,
  };
}

function workingMinutesFor(db: MockDb, employeeId: string, start: string, end: string, partial?: number): number {
  let total = 0;
  for (const d of rangeDays(start, end)) {
    if (db.holidays.some((h) => h.date === d)) continue;
    const s = shiftFor(db, employeeId, d);
    if (s) total += resolveShift(s, d).spanMinutes - s.unpaidBreakMinutes;
    else if ([1, 2, 3, 4, 5].includes(weekday(d)) && !teamShiftFor(db, employeeId)) total += 480;
  }
  if (partial) return Math.min(partial, total);
  return total;
}

/* ------------------------------------------------------------------ overtime */

function otRow(req: MockReq, o: T.OvertimeRequest): OvertimeRow {
  const { db, me } = req;
  const eid = me.employee?.id;
  return {
    ...o,
    employeeName: employeeLabel(db, o.employeeId),
    taskTitle: db.tasks.find((t) => t.id === o.taskId)?.title,
    canRecommend: ["PENDING", "FLAGGED"].includes(o.status) && o.employeeId !== eid && can(me, "overtime.recommend") && isManagerOf(db, eid, o.employeeId),
    canValidate: ["MANAGER_RECOMMENDED"].includes(o.status) && o.employeeId !== eid && can(me, "overtime.validate"),
  };
}

/* ------------------------------------------------------------------ routes */

export const workforceRoutes = [
  /* ---------------- attendance */
  route("GET", "/me/attendance", (req) => {
    const eid = req.me.employee?.id;
    if (!eid) fail(404, "NOT_FOUND", "No employee record is linked to this account.");
    const [from, to] = range(req);
    return attendanceFor(req.db, eid!, from, to);
  }),

  route("GET", "/attendance", (req) => {
    requirePerm(req.me, "attendance.read");
    const [from, to] = range(req);
    if (req.query.employeeId) {
      if (!canSeeEmployee(req.db, req.me, "attendance.read", req.query.employeeId)) fail(404, "NOT_FOUND", "Employee not found.");
      return attendanceFor(req.db, req.query.employeeId, from, to);
    }
    const vis = visibleEmployees(req.db, req.me, "attendance.read");
    const rows: TeamAttendanceRow[] = req.db.employees
      .filter((e) => e.employmentStatus === "ACTIVE" && (vis === "all" || vis.has(e.id)))
      .filter((e) => !req.query.teamId || e.teamId === req.query.teamId)
      .map((e) => {
        const days = rangeDays(from, to).map((d) => computeDaily(req.db, e.id, d)).reverse();
        return { employeeId: e.id, days, totals: totals(days) };
      });
    return { from, to, timezone: tzOf(req.db), rows };
  }),

  route("POST", "/attendance/events", (req) => {
    const eid = req.me.employee?.id;
    requirePerm(req.me, "attendance.event");
    if (!eid) fail(403, "FORBIDDEN", "Only employees can record attendance.");
    const kind = req.body.kind as T.AttendanceEventKind;
    if (!["CHECK_IN", "BREAK_START", "BREAK_END", "CHECK_OUT"].includes(kind)) validation({ kind: "Unknown attendance event." });
    const { status } = nowStatus(req.db, eid!);
    const policy = req.db.policies.find((p) => p.type === "ATTENDANCE" && p.status === "APPROVED");
    if (policy && policy.config.webCheckInAllowed === false) fail(422, "POLICY_BLOCKED", "Web check-in is disabled by the attendance policy.");
    const errors: Record<T.AttendanceEventKind, string | null> = {
      CHECK_IN: status === "WORKING" || status === "ON_BREAK" ? "You already have an open attendance interval. Check out first." : null,
      BREAK_START: status === "ON_BREAK" ? "A break is already in progress." : status !== "WORKING" ? "Check in before starting a break." : null,
      BREAK_END: status !== "ON_BREAK" ? "There is no break in progress." : null,
      CHECK_OUT: status === "NOT_CHECKED_IN" || status === "CHECKED_OUT" ? "You can't check out before checking in." : status === "ON_BREAK" ? "End your break before checking out." : null,
    };
    if (errors[kind]) fail(409, "INVALID_TRANSITION", errors[kind]!);
    const ts = nowIso();
    const ev: T.AttendanceEvent = { id: uuid(), employeeId: eid!, kind, occurredAt: ts, receivedAt: ts, source: "WEB", flags: [] };
    req.db.attendanceEvents.push(ev);
    audit(req, `attendance.${kind.toLowerCase()}`, "AttendanceEvent", ev.id);
    return { event: ev, status: nowStatus(req.db, eid!).status };
  }),

  route("GET", "/attendance/corrections", (req) => {
    const { db, me } = req;
    const eid = me.employee?.id;
    const scope = req.query.scope ?? "mine";
    let rows = db.corrections;
    if (scope === "mine") rows = rows.filter((c) => c.employeeId === eid);
    else {
      const vis = visibleEmployees(db, me, "attendance.read");
      rows = rows.filter((c) => (vis === "all" || vis.has(c.employeeId)) && c.employeeId !== eid);
      if (!can(me, "attendance.recommend") && !can(me, "attendance.approve")) fail(403, "FORBIDDEN", "You can't review corrections.");
    }
    return rows.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((c) => correctionRow(req, c));
  }),

  route("POST", "/attendance/corrections", (req) => {
    const eid = req.me.employee?.id;
    requirePerm(req.me, "attendance.correct");
    if (!eid) fail(403, "FORBIDDEN", "Only employees can propose corrections.");
    const { businessDate: date, proposedCheckIn, proposedCheckOut, reason } = req.body as { businessDate: string; proposedCheckIn?: string; proposedCheckOut?: string; reason: string };
    const fe: Record<string, string> = {};
    if (!date) fe.businessDate = "Choose the day to correct.";
    else if (date > todayOf(req.db)) fe.businessDate = "You can't correct a future day.";
    if (!proposedCheckIn && !proposedCheckOut) fe.proposedCheckIn = "Propose a corrected check-in and/or check-out time.";
    if (proposedCheckIn && proposedCheckOut && proposedCheckOut <= proposedCheckIn) fe.proposedCheckOut = "Check-out must be after check-in.";
    if (!reason || reason.trim().length < 10) fe.reason = "Explain the correction (at least 10 characters).";
    if (req.db.corrections.some((c) => c.employeeId === eid && c.businessDate === date && ["PROPOSED", "MANAGER_VALIDATED"].includes(c.status))) fe.businessDate = "A correction for this day is already pending.";
    if (Object.keys(fe).length) validation(fe);
    const c: T.AttendanceCorrection = {
      id: uuid(), employeeId: eid!, businessDate: date, proposedCheckIn, proposedCheckOut, reason: reason.trim(), status: "PROPOSED",
      affectsLockedPayroll: lockedPayrollFor(req.db, date), createdAt: nowIso(),
    };
    req.db.corrections.push(c);
    const mgr = req.db.employees.find((e) => e.id === eid)?.managerId;
    notifyEmployee(req.db, mgr, { kind: "CORRECTION", title: "Correction to validate", body: `${employeeLabel(req.db, eid)} proposed an attendance correction for ${date}.`, href: "/attendance/approvals" });
    audit(req, "attendance.correction.propose", "AttendanceCorrection", c.id);
    return correctionRow(req, c);
  }),

  route("POST", "/attendance/corrections/:id/decision", (req) => {
    const c = req.db.corrections.find((x) => x.id === req.params.id);
    if (!c) fail(404, "NOT_FOUND", "Correction not found.");
    const row = correctionRow(req, c!);
    const { decision, reason } = req.body as { decision: "VALIDATE" | "APPROVE" | "REJECT"; reason?: string };
    if (decision === "REJECT" && (!reason || reason.trim().length < 3)) validation({ reason: "Give a reason for rejecting." });
    if (decision === "VALIDATE") {
      if (!row.canValidate) fail(403, "FORBIDDEN", "You can't validate this correction.");
      c!.status = "MANAGER_VALIDATED";
      c!.managerDecisionBy = req.me.employee?.id;
      notifyRole(req.db, "HR", { kind: "CORRECTION", title: "Correction awaiting HR", body: `${row.employeeName}'s correction for ${c!.businessDate} was validated.`, href: "/attendance/approvals" });
    } else if (decision === "APPROVE") {
      if (!row.canApprove) fail(403, "FORBIDDEN", c!.status === "PROPOSED" ? "A manager must validate before HR approval." : "You can't approve this correction.");
      c!.status = "APPROVED";
      c!.hrDecisionBy = req.me.employee?.id;
      c!.affectsLockedPayroll = lockedPayrollFor(req.db, c!.businessDate);
      notifyEmployee(req.db, c!.employeeId, {
        kind: "CORRECTION", title: "Attendance correction approved",
        body: c!.affectsLockedPayroll ? `Your ${c!.businessDate} correction was approved. The payroll period is locked, so a proposed adjustment goes to the next period.` : `Your ${c!.businessDate} correction was approved and daily totals recomputed.`,
        href: "/attendance",
      });
    } else if (decision === "REJECT") {
      if (!row.canValidate && !row.canApprove) fail(403, "FORBIDDEN", "You can't decide on this correction.");
      c!.status = "REJECTED";
      notifyEmployee(req.db, c!.employeeId, { kind: "CORRECTION", title: "Attendance correction rejected", body: reason!, href: "/attendance" });
    } else validation({ decision: "Unknown decision." });
    c!.decisionReason = reason;
    audit(req, `attendance.correction.${decision.toLowerCase()}`, "AttendanceCorrection", c!.id, { reason });
    return correctionRow(req, c!);
  }),

  /* ---------------- shifts & holidays */
  route("GET", "/shifts", (req) => {
    if (!can(req.me, "shift.manage") && !can(req.me, "attendance.read")) fail(403, "FORBIDDEN", "No access to shifts.");
    return { templates: req.db.shiftTemplates, holidays: req.db.holidays.slice().sort((a, b) => a.date.localeCompare(b.date)) };
  }),

  route("POST", "/shifts", (req) => {
    requirePerm(req.me, "shift.manage");
    const b = req.body as Partial<T.ShiftTemplate>;
    const fe = validateShift(b);
    if (Object.keys(fe).length) validation(fe);
    const now = nowIso();
    const s: T.ShiftTemplate = {
      id: uuid(), organizationId: req.db.organization.id, createdAt: now, updatedAt: now, version: 1,
      name: b.name!.trim(), timezone: b.timezone || tzOf(req.db), localStart: b.localStart!, localEnd: b.localEnd!, weekdays: b.weekdays!,
      paidBreakMinutes: Number(b.paidBreakMinutes ?? 0), unpaidBreakMinutes: Number(b.unpaidBreakMinutes ?? 0), graceMinutes: Number(b.graceMinutes ?? 0),
      policyVersion: req.db.policies.find((p) => p.type === "ATTENDANCE" && p.status === "APPROVED")?.version ?? 1,
      effectiveFrom: b.effectiveFrom!, effectiveTo: b.effectiveTo || undefined, assignedTeamIds: b.assignedTeamIds ?? [],
    };
    req.db.shiftTemplates.push(s);
    audit(req, "shift.create", "ShiftTemplate", s.id, { after: { name: s.name } });
    return s;
  }),

  route("PATCH", "/shifts/:id", (req) => {
    requirePerm(req.me, "shift.manage");
    const s = req.db.shiftTemplates.find((x) => x.id === req.params.id);
    if (!s) fail(404, "NOT_FOUND", "Shift not found.");
    checkVersion(req, s!);
    const b = { ...s, ...req.body } as Partial<T.ShiftTemplate>;
    const fe = validateShift(b);
    if (Object.keys(fe).length) validation(fe);
    const before = { localStart: s!.localStart, localEnd: s!.localEnd, weekdays: s!.weekdays, graceMinutes: s!.graceMinutes };
    Object.assign(s!, {
      name: b.name, localStart: b.localStart, localEnd: b.localEnd, weekdays: b.weekdays, paidBreakMinutes: Number(b.paidBreakMinutes),
      unpaidBreakMinutes: Number(b.unpaidBreakMinutes), graceMinutes: Number(b.graceMinutes), effectiveFrom: b.effectiveFrom,
      effectiveTo: b.effectiveTo || undefined, assignedTeamIds: b.assignedTeamIds, timezone: b.timezone,
    });
    bump(s!);
    audit(req, "shift.update", "ShiftTemplate", s!.id, { before, after: { localStart: s!.localStart, localEnd: s!.localEnd, weekdays: s!.weekdays, graceMinutes: s!.graceMinutes } });
    return s;
  }),

  route("GET", "/holidays", (req) => req.db.holidays.slice().sort((a, b) => a.date.localeCompare(b.date))),

  route("POST", "/holidays", (req) => {
    requirePerm(req.me, "shift.manage");
    const { date, name } = req.body as { date: string; name: string };
    const fe: Record<string, string> = {};
    if (!date) fe.date = "Pick a date.";
    if (!name?.trim()) fe.name = "Name the holiday.";
    if (req.db.holidays.some((h) => h.date === date)) fe.date = "A holiday already exists on this date.";
    if (Object.keys(fe).length) validation(fe);
    const h = { id: uuid(), date, name: name.trim() };
    req.db.holidays.push(h);
    audit(req, "holiday.create", "Holiday", h.id, { after: h });
    return h;
  }),

  /* ---------------- leave */
  route("GET", "/leave/balances", (req) => {
    const eid = req.query.employeeId ?? req.me.employee?.id;
    if (!eid) fail(404, "NOT_FOUND", "No employee selected.");
    if (eid !== req.me.employee?.id && !canSeeEmployee(req.db, req.me, "leave.read", eid!)) fail(404, "NOT_FOUND", "Employee not found.");
    return { employeeId: eid, balances: balances(req.db, eid!) };
  }),

  route("GET", "/leave/ledger", (req) => {
    const eid = req.query.employeeId ?? req.me.employee?.id;
    if (!eid) fail(404, "NOT_FOUND", "No employee selected.");
    if (eid !== req.me.employee?.id && !canSeeEmployee(req.db, req.me, "leave.read", eid!)) fail(404, "NOT_FOUND", "Employee not found.");
    const entries = req.db.leaveLedger
      .filter((l) => l.employeeId === eid && (!req.query.typeId || l.typeId === req.query.typeId))
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
      .map((l) => ({ ...l, typeName: req.db.leaveTypes.find((t) => t.id === l.typeId)?.name ?? "" }));
    return { entries };
  }),

  route("GET", "/leave-requests", (req) => {
    const { db, me } = req;
    const eid = me.employee?.id;
    const scope = req.query.scope ?? "mine";
    let rows = db.leaveRequests;
    if (scope === "mine") rows = rows.filter((l) => l.employeeId === eid);
    else if (scope === "approvals") {
      rows = rows.filter((l) => l.employeeId !== eid && (l.status === "PENDING"));
      if (!can(me, "leave.recommend") && !can(me, "leave.approve")) fail(403, "FORBIDDEN", "You can't review leave requests.");
      rows = rows.filter((l) => {
        const r = leaveRow(req, l);
        return r.canRecommend || r.canDecide;
      });
    } else {
      // team calendar: availability only
      const vis = visibleEmployees(db, me, "leave.read");
      const teamIds = new Set<string>();
      const myTeam = me.employee?.teamId;
      if (vis === "all") db.employees.forEach((e) => teamIds.add(e.id));
      else {
        vis.forEach((v) => teamIds.add(v));
        if (myTeam) db.teams.find((t) => t.id === myTeam)?.memberIds.forEach((m) => teamIds.add(m));
      }
      rows = rows.filter((l) => teamIds.has(l.employeeId) && ["APPROVED", "PENDING"].includes(l.status));
      if (req.query.from) rows = rows.filter((l) => l.endDate >= req.query.from);
      if (req.query.to) rows = rows.filter((l) => l.startDate <= req.query.to);
      return rows.map((l) => {
        const r = leaveRow(req, l);
        const isHr = can(me, "leave.approve");
        // Only availability for colleagues: hide type and notes unless HR or own
        return l.employeeId === eid || isHr ? r : { ...r, note: undefined, noteHidden: false, typeName: "Unavailable", hasDocument: false };
      });
    }
    return rows.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((l) => leaveRow(req, l));
  }),

  route("POST", "/leave-requests", (req) => {
    const eid = req.me.employee?.id;
    requirePerm(req.me, "leave.request");
    if (!eid) fail(403, "FORBIDDEN", "Only employees can request leave.");
    const b = req.body as { typeId: string; startDate: string; endDate: string; partialMinutes?: number; note?: string; hasDocument?: boolean; submit?: boolean };
    const type = req.db.leaveTypes.find((t) => t.id === b.typeId);
    const fe: Record<string, string> = {};
    if (!type) fe.typeId = "Choose a leave type.";
    if (!b.startDate) fe.startDate = "Choose a start date.";
    if (!b.endDate) fe.endDate = "Choose an end date.";
    if (b.startDate && b.endDate && b.endDate < b.startDate) fe.endDate = "End date must be on or after the start date.";
    if (b.partialMinutes !== undefined && b.partialMinutes !== null) {
      if (b.startDate !== b.endDate) fe.partialMinutes = "Partial-day leave must be a single day.";
      else if (b.partialMinutes < 30 || b.partialMinutes > 480) fe.partialMinutes = "Partial-day minutes must be between 30 and 480.";
    }
    if (type?.requiresDocument && !b.hasDocument && b.submit) fe.hasDocument = `${type.name} requires a supporting document.`;
    const clash = req.db.leaveRequests.find((l) => l.employeeId === eid && ["PENDING", "APPROVED"].includes(l.status) && l.startDate <= b.endDate && l.endDate >= b.startDate);
    if (clash) fe.startDate = `Overlaps an existing ${clash.status.toLowerCase()} request (${clash.startDate} – ${clash.endDate}).`;
    if (Object.keys(fe).length) validation(fe);
    const minutes = workingMinutesFor(req.db, eid!, b.startDate, b.endDate, b.partialMinutes || undefined);
    if (minutes === 0) validation({ startDate: "The selected dates contain no scheduled working time (weekends or holidays)." });
    const l: T.LeaveRequest = {
      id: uuid(), employeeId: eid!, typeId: b.typeId, startDate: b.startDate, endDate: b.endDate, partialMinutes: b.partialMinutes || undefined,
      requestedMinutes: minutes, note: b.note?.trim() || undefined, hasDocument: !!b.hasDocument, status: b.submit ? "PENDING" : "DRAFT", createdAt: nowIso(),
    };
    req.db.leaveRequests.push(l);
    if (b.submit) {
      const emp = req.db.employees.find((e) => e.id === eid);
      notifyEmployee(req.db, emp?.managerId, { kind: "LEAVE_DECISION", title: "Leave request to review", body: `${emp?.displayName} requested ${type!.name} ${l.startDate}${l.endDate !== l.startDate ? ` – ${l.endDate}` : ""}.`, href: "/leave/approvals" });
    }
    audit(req, b.submit ? "leave.submit" : "leave.draft", "LeaveRequest", l.id);
    return leaveRow(req, l);
  }),

  route("POST", "/leave-requests/:id/decision", (req) => {
    const { db, me } = req;
    const l = db.leaveRequests.find((x) => x.id === req.params.id);
    if (!l) fail(404, "NOT_FOUND", "Leave request not found.");
    const row = leaveRow(req, l!);
    const { action, reason } = req.body as { action: "SUBMIT" | "RECOMMEND" | "NOT_RECOMMENDED" | "APPROVE" | "REJECT" | "WITHDRAW" | "CANCEL"; reason?: string };
    const by = me.employee?.id ?? me.user.id;
    const at = nowIso();
    const needReason = ["NOT_RECOMMENDED", "REJECT", "CANCEL"].includes(action);
    if (needReason && (!reason || reason.trim().length < 3)) validation({ reason: "A reason is required." });
    const typeName = row.typeName;
    switch (action) {
      case "SUBMIT":
        if (l!.employeeId !== me.employee?.id || l!.status !== "DRAFT") fail(409, "INVALID_TRANSITION", "Only your own drafts can be submitted.");
        l!.status = "PENDING";
        break;
      case "RECOMMEND":
      case "NOT_RECOMMENDED":
        if (!row.canRecommend) fail(403, "FORBIDDEN", "You can't review this request.");
        l!.managerDecision = { by, decision: action, at, reason };
        notifyRole(db, "HR", { kind: "LEAVE_DECISION", title: "Leave awaiting HR", body: `${row.employeeName}'s ${typeName} was ${action === "RECOMMEND" ? "recommended" : "not recommended"} by the manager.`, href: "/leave/approvals" });
        break;
      case "APPROVE": {
        if (!row.canDecide) fail(403, "FORBIDDEN", "Only HR can approve leave, and never their own.");
        const type = db.leaveTypes.find((t) => t.id === l!.typeId)!;
        const available = balances(db, l!.employeeId).find((b) => b.type.id === type.id)!.availableMinutes;
        if (!type.allowNegative && available < l!.requestedMinutes) {
          fail(422, "POLICY_BLOCKED", `Insufficient ${type.name} balance: ${Math.round(available / 48) / 10} days available, ${Math.round(l!.requestedMinutes / 48) / 10} requested. Negative balances aren't permitted for this type.`);
        }
        // Reserve future leave, consume past/current leave — one ledger write in the same transaction.
        const future = l!.startDate > todayOf(db);
        db.leaveLedger.push({
          id: uuid(), employeeId: l!.employeeId, typeId: l!.typeId, requestId: l!.id, deltaMinutes: -l!.requestedMinutes,
          entryType: future ? "RESERVE" : "USE", effectiveDate: l!.startDate, policyVersion: db.policies.find((p) => p.type === "LEAVE" && p.status === "APPROVED")?.version ?? 1,
        });
        l!.status = "APPROVED";
        l!.hrDecision = { by, decision: "APPROVED", at, reason };
        notifyEmployee(db, l!.employeeId, { kind: "LEAVE_DECISION", title: "Leave approved", body: `${typeName} ${l!.startDate}${l!.endDate !== l!.startDate ? ` – ${l!.endDate}` : ""} was approved.`, href: "/leave" });
        break;
      }
      case "REJECT":
        if (!row.canDecide) fail(403, "FORBIDDEN", "Only HR can reject leave.");
        l!.status = "REJECTED";
        l!.hrDecision = { by, decision: "REJECTED", at, reason };
        notifyEmployee(db, l!.employeeId, { kind: "LEAVE_DECISION", title: "Leave not approved", body: reason!, href: "/leave" });
        break;
      case "WITHDRAW":
        if (!row.canWithdraw) fail(409, "INVALID_TRANSITION", "Only pending or draft requests can be withdrawn.");
        l!.status = "WITHDRAWN";
        break;
      case "CANCEL": {
        if (!row.canCancel) fail(409, "INVALID_TRANSITION", "Only HR can cancel approved future leave.");
        const reserve = db.leaveLedger.find((e) => e.requestId === l!.id && ["RESERVE", "USE"].includes(e.entryType) && !db.leaveLedger.some((r) => r.entryType === "REVERSAL" && r.requestId === l!.id));
        if (reserve) {
          db.leaveLedger.push({ id: uuid(), employeeId: l!.employeeId, typeId: l!.typeId, requestId: l!.id, deltaMinutes: -reserve.deltaMinutes, entryType: "REVERSAL", effectiveDate: todayOf(db), policyVersion: reserve.policyVersion, note: `Reversal of ${reserve.id}: ${reason}` });
        }
        l!.status = "CANCELLED";
        l!.hrDecision = { by, decision: "CANCELLED", at, reason };
        notifyEmployee(db, l!.employeeId, { kind: "LEAVE_DECISION", title: "Approved leave cancelled", body: reason!, href: "/leave" });
        break;
      }
      default:
        validation({ action: "Unknown action." });
    }
    audit(req, `leave.${action.toLowerCase()}`, "LeaveRequest", l!.id, { reason });
    return leaveRow(req, l!);
  }),

  /* ---------------- overtime */
  route("GET", "/overtime-requests", (req) => {
    const { db, me } = req;
    const eid = me.employee?.id;
    const scope = req.query.scope ?? "mine";
    let rows = db.overtime;
    if (scope === "mine") rows = rows.filter((o) => o.employeeId === eid);
    else {
      if (!can(me, "overtime.read")) fail(403, "FORBIDDEN", "You can't view team overtime.");
      const vis = visibleEmployees(db, me, "overtime.read");
      rows = rows.filter((o) => (vis === "all" || vis.has(o.employeeId)) && o.employeeId !== eid);
    }
    return rows.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((o) => otRow(req, o));
  }),

  route("POST", "/overtime-requests", (req) => {
    const eid = req.me.employee?.id;
    requirePerm(req.me, "overtime.request");
    if (!eid) fail(403, "FORBIDDEN", "Only employees can request overtime.");
    const b = req.body as { date: string; taskId?: string; requestedMinutes: number; reason: string };
    const fe: Record<string, string> = {};
    if (!b.date) fe.date = "Choose the date.";
    if (!b.requestedMinutes || b.requestedMinutes < 15 || b.requestedMinutes > 720) fe.requestedMinutes = "Estimate between 15 and 720 minutes.";
    if (!b.reason || b.reason.trim().length < 5) fe.reason = "Explain why overtime is needed.";
    if (b.taskId) {
      const t = req.db.tasks.find((x) => x.id === b.taskId);
      if (!t || t.assigneeId !== eid) fe.taskId = "Choose one of your assigned tasks.";
    }
    if (Object.keys(fe).length) validation(fe);
    const o: T.OvertimeRequest = { id: uuid(), employeeId: eid!, date: b.date, taskId: b.taskId || undefined, requestedMinutes: Number(b.requestedMinutes), reason: b.reason.trim(), status: "PENDING", unscheduled: false, createdAt: nowIso() };
    req.db.overtime.push(o);
    notifyEmployee(req.db, req.db.employees.find((e) => e.id === eid)?.managerId, { kind: "ASSIGNMENT", title: "Overtime request", body: `${employeeLabel(req.db, eid)} requested ${o.requestedMinutes} minutes on ${o.date}.`, href: "/overtime" });
    audit(req, "overtime.request", "OvertimeRequest", o.id);
    return otRow(req, o);
  }),

  route("POST", "/overtime-requests/:id/decision", (req) => {
    const o = req.db.overtime.find((x) => x.id === req.params.id);
    if (!o) fail(404, "NOT_FOUND", "Overtime request not found.");
    const row = otRow(req, o!);
    const b = req.body as { action: "RECOMMEND" | "VALIDATE" | "REJECT"; approvedMinutes?: number; rateBasis?: "FULL_RATE" | "PREMIUM_ONLY"; multiplier?: string; reason?: string; approvalToWork?: boolean };
    if (b.action === "RECOMMEND") {
      if (!row.canRecommend) fail(403, "FORBIDDEN", "Only the employee's manager can recommend overtime.");
      o!.status = "MANAGER_RECOMMENDED";
      o!.approvalToWork = b.approvalToWork ?? true;
      notifyRole(req.db, "PAYROLL", { kind: "ASSIGNMENT", title: "Overtime to validate", body: `${row.employeeName} — ${o!.date}`, href: "/overtime" });
    } else if (b.action === "VALIDATE") {
      if (!row.canValidate) fail(403, "FORBIDDEN", "Only payroll can validate recommended overtime.");
      const fe: Record<string, string> = {};
      const actual = o!.actualMinutes ?? o!.requestedMinutes;
      if (b.approvedMinutes === undefined || b.approvedMinutes < 0) fe.approvedMinutes = "Enter approved payable minutes.";
      else if (b.approvedMinutes > actual) fe.approvedMinutes = `Approved minutes can't exceed verified actual minutes (${actual}).`;
      if (!b.rateBasis) fe.rateBasis = "Choose whether the amount is full rate or premium only.";
      if (Object.keys(fe).length) validation(fe);
      o!.status = "PAYROLL_VALIDATED";
      o!.approvedMinutes = b.approvedMinutes;
      o!.rateBasis = b.rateBasis;
      o!.multiplier = b.multiplier || String(req.db.policies.find((p) => p.type === "OVERTIME" && p.status === "APPROVED")?.config.multiplier ?? "1.0");
      notifyEmployee(req.db, o!.employeeId, { kind: "ASSIGNMENT", title: "Overtime validated", body: `${b.approvedMinutes} minutes on ${o!.date} will appear in the next payroll draft for owner approval.`, href: "/overtime" });
    } else if (b.action === "REJECT") {
      if (!row.canRecommend && !row.canValidate) fail(403, "FORBIDDEN", "You can't decide on this request.");
      if (!b.reason || b.reason.trim().length < 3) validation({ reason: "A reason is required." });
      o!.status = "REJECTED";
      notifyEmployee(req.db, o!.employeeId, { kind: "ASSIGNMENT", title: "Overtime not approved", body: b.reason!, href: "/overtime" });
    } else validation({ action: "Unknown action." });
    audit(req, `overtime.${b.action.toLowerCase()}`, "OvertimeRequest", o!.id, { reason: b.reason });
    return otRow(req, o!);
  }),
];

function validateShift(b: Partial<T.ShiftTemplate>): Record<string, string> {
  const fe: Record<string, string> = {};
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!b.name?.trim()) fe.name = "Name the shift.";
  if (!b.localStart || !hhmm.test(b.localStart)) fe.localStart = "Use HH:mm.";
  if (!b.localEnd || !hhmm.test(b.localEnd)) fe.localEnd = "Use HH:mm.";
  if (b.localStart && b.localStart === b.localEnd) fe.localEnd = "End must differ from start.";
  if (!b.weekdays?.length) fe.weekdays = "Choose at least one weekday.";
  if (!b.effectiveFrom) fe.effectiveFrom = "Choose an effective date.";
  if (b.effectiveTo && b.effectiveFrom && b.effectiveTo < b.effectiveFrom) fe.effectiveTo = "Must be after the effective-from date.";
  for (const k of ["paidBreakMinutes", "unpaidBreakMinutes", "graceMinutes"] as const) {
    const v = Number(b[k] ?? 0);
    if (!Number.isFinite(v) || v < 0 || v > 240) fe[k] = "Between 0 and 240 minutes.";
  }
  return fe;
}
