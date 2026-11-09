/** Payroll routes: periods, runs, components, owner approval, exports and payslips (spec sections 14, 24). */
import type * as T from "@/lib/types";
import { can } from "@/lib/rbac";
import { computeLine, inputHash, sumMoney } from "@/lib/calc/payroll";
import { dec, toFixed } from "@/lib/calc/money";
import { fmtDateTime } from "@/lib/time";
import type { CompensationRow, LineDetail, OwnerException, PeriodSummary, RunDetail, RunWithExtras } from "@/lib/api/payroll";
import type { MockDb } from "../db";
import {
  audit, bump, checkVersion, employeeLabel, fail, notifyEmployee, notifyRole, nowIso, reauthFresh, requirePerm, rolesForUser, uuid, validation,
  type MockReq,
} from "../helpers";
import { route } from "../routes";

const MONEY_RE = /^\d{1,14}(\.\d{1,4})?$/;
const SCHEDULED_MINUTES = 10080; // 21 days x 480 (seed baseline)
const OWNER_EXCEPTION = "Owner's own payroll line requires a recorded exception";

const runOf = (db: MockDb, id: string) => db.payrollRuns.find((r) => r.id === id) as RunWithExtras | undefined;

function isOwnerEmployee(db: MockDb, employeeId: string): boolean {
  const e = db.employees.find((x) => x.id === employeeId);
  return !!e?.userId && rolesForUser(db, e.userId).includes("OWNER");
}

function profileFor(db: MockDb, employeeId: string, period: T.PayrollPeriod): T.CompensationProfile | undefined {
  return db.compensation.find((c) => c.employeeId === employeeId && c.effectiveFrom <= period.end && (!c.effectiveTo || c.effectiveTo >= period.start));
}

function recomputeLine(db: MockDb, run: RunWithExtras, line: T.PayrollLine): void {
  const totals = computeLine(line.components);
  line.gross = totals.gross;
  line.deductions = totals.deductions;
  line.net = totals.net;
  const ex: string[] = [];
  if (!line.compensationProfileId) ex.push("Missing compensation profile");
  if (line.components.some((c) => c.status === "PROPOSED")) ex.push("Unapproved component pending");
  if (totals.negative) ex.push("Negative net payable");
  if (isOwnerEmployee(db, line.employeeId) && !run.ownerExceptions?.some((o) => o.employeeId === line.employeeId)) ex.push(OWNER_EXCEPTION);
  line.exceptions = ex;
}

function recomputeRun(db: MockDb, run: RunWithExtras): void {
  const lines = db.payrollLines.filter((l) => l.runId === run.id);
  lines.forEach((l) => recomputeLine(db, run, l));
  run.totals = {
    gross: sumMoney(lines.map((l) => l.gross)),
    deductions: sumMoney(lines.map((l) => l.deductions)),
    net: sumMoney(lines.map((l) => l.net)),
    currency: run.totals.currency,
    employees: lines.length,
  };
  run.inputHash = inputHash(lines.map((l) => [l.employeeId, l.net, l.components.map((x) => [x.amount, x.status])]));
}

function getRun(req: MockReq, id: string): RunWithExtras {
  requirePerm(req.me, "payroll.read");
  const run = runOf(req.db, id);
  if (!run) return fail(404, "NOT_FOUND", "Payroll run not found.");
  return run;
}

function assertEditable(run: RunWithExtras): void {
  if (!["DRAFT", "UNDER_REVIEW"].includes(run.state))
    fail(409, "INVALID_TRANSITION", "This run is locked. Locked and paid snapshots never change — reopen with an owner reason or add a next-period adjustment.");
}

/** Any input change invalidates a pending approval: back to Draft with a new hash. */
function invalidate(req: MockReq, run: RunWithExtras): void {
  recomputeRun(req.db, run);
  if (run.state === "UNDER_REVIEW") {
    run.state = "DRAFT";
    audit(req, "payroll.run.approval_invalidated", "PayrollRun", run.id, { reason: "Line changed while under review" });
  }
  bump(run);
}

function runDetail(req: MockReq, run: RunWithExtras): RunDetail {
  const period = req.db.payrollPeriods.find((p) => p.id === run.periodId)!;
  const lines = req.db.payrollLines
    .filter((l) => l.runId === run.id)
    .map((l) => {
      const e = req.db.employees.find((x) => x.id === l.employeeId);
      return { ...l, basis: req.db.compensation.find((c) => c.id === l.compensationProfileId)?.basis, employeeName: e?.displayName ?? "Unknown", employeeCode: e?.employeeCode ?? "" };
    })
    .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
  const eid = req.me.employee?.id;
  return {
    run,
    period,
    lines,
    exceptionCount: lines.reduce((a, l) => a + l.exceptions.length, 0),
    permissions: {
      canPrepare: can(req.me, "payroll.prepare"),
      canApprove: can(req.me, "payroll.approve") && run.preparedBy !== eid,
      canExport: can(req.me, "payroll.export"),
      canReopen: can(req.me, "payroll.reopen"),
      canDecideComponents: can(req.me, "payroll.approve") || can(req.me, "overtime.validate"),
      isPreparer: run.preparedBy === eid,
    },
    reauthValidUntil: new Date(new Date(req.me.authTime).getTime() + 10 * 60000).toISOString(),
  };
}

function buildLines(req: MockReq, run: RunWithExtras, period: T.PayrollPeriod): T.PayrollLine[] {
  const { db } = req;
  const active = db.employees.filter((e) => e.employmentStatus === "ACTIVE");
  const missing = active.filter((e) => !profileFor(db, e.id, period));
  if (missing.length) fail(422, "POLICY_BLOCKED", `Missing compensation profile for: ${missing.map((m) => m.displayName).join(", ")}.`);
  const preparer = req.me.employee?.id ?? req.me.user.id;
  return active.map((e) => {
    const p = profileFor(db, e.id, period)!;
    const lineId = uuid();
    const comps: T.PayComponent[] = [];
    if (p.basis === "HOURLY") {
      const minutes = 9600;
      const amount = toFixed((dec(p.baseRate) * BigInt(minutes) + 30n) / 60n);
      comps.push({ id: uuid(), lineId, category: "BASE", description: "Approved payable minutes x hourly rate", quantity: `${minutes} min`, unitRate: p.baseRate, amount, status: "APPROVED", proposedBy: "system", approvedBy: "policy" });
    } else {
      comps.push({ id: uuid(), lineId, category: "BASE", description: `Monthly base (${p.proration === "CALENDAR_DAY" ? "calendar-day" : "scheduled-minute"} proration, full period)`, amount: toFixed(dec(p.baseRate)), status: "APPROVED", proposedBy: "system", approvedBy: "policy" });
    }
    for (const ot of db.overtime.filter((o) => o.employeeId === e.id && o.status === "PAYROLL_VALIDATED" && o.date >= period.start && o.date <= period.end && o.approvedMinutes)) {
      const hourly = p.basis === "HOURLY" ? dec(p.baseRate) : (dec(p.baseRate) * 60n) / BigInt(SCHEDULED_MINUTES);
      const mult = dec(ot.multiplier ?? "1");
      const amount = toFixed((((hourly * BigInt(ot.approvedMinutes!)) / 60n) * mult) / 10000n);
      comps.push({ id: uuid(), lineId, category: "OVERTIME", description: `Approved overtime ${ot.approvedMinutes} min (x${ot.multiplier ?? "1"})`, amount, status: "PROPOSED", proposedBy: preparer, evidence: ot.id, otRateBasis: ot.rateBasis ?? "FULL_RATE" });
    }
    const line: T.PayrollLine = {
      id: lineId, runId: run.id, employeeId: e.id, compensationProfileId: p.id, scheduledMinutes: SCHEDULED_MINUTES,
      payableMinutes: p.basis === "HOURLY" ? 9600 : SCHEDULED_MINUTES, components: comps, gross: "0.00", deductions: "0.00", net: "0.00", exceptions: [],
    };
    return line;
  });
}

const csvCell = (v: unknown): string => {
  let s = v === undefined || v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function generatePayslips(db: MockDb, run: RunWithExtras, approvalId: string): void {
  const period = db.payrollPeriods.find((p) => p.id === run.periodId)!;
  db.payslips = db.payslips.filter((p) => p.runId !== run.id);
  for (const l of db.payrollLines.filter((x) => x.runId === run.id)) {
    db.payslips.push({
      id: `ps-${run.id}-${l.employeeId}`, runId: run.id, employeeId: l.employeeId, periodLabel: period.label, currency: run.totals.currency,
      lines: l.components.filter((c) => c.status === "APPROVED").map((c) => ({ category: c.category, description: c.description, amount: c.amount })),
      gross: l.gross, deductions: l.deductions, net: l.net, approvalId, publishedAt: nowIso(),
    });
  }
}

export const payrollRoutes = [
  route("GET", "/payroll/periods", (req): PeriodSummary[] => {
    requirePerm(req.me, "payroll.read");
    return [...req.db.payrollPeriods]
      .sort((a, b) => b.start.localeCompare(a.start))
      .map((p) => ({ ...p, runs: (req.db.payrollRuns as RunWithExtras[]).filter((r) => r.periodId === p.id).sort((a, b) => b.revision - a.revision) }));
  }),

  route("GET", "/payroll-runs", (req) => {
    requirePerm(req.me, "payroll.read");
    const runs = (req.db.payrollRuns as RunWithExtras[]).filter((r) => !req.query.periodId || r.periodId === req.query.periodId);
    return { items: [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
  }),

  route("POST", "/payroll-runs", (req) => {
    requirePerm(req.me, "payroll.prepare");
    const period = req.db.payrollPeriods.find((p) => p.id === req.body.periodId);
    if (!period) return validation({ periodId: "Choose a payroll period." });
    if (period.state !== "OPEN") fail(409, "INVALID_TRANSITION", "This period is closed. Use a next-period adjustment instead.");
    const active = (req.db.payrollRuns as RunWithExtras[]).find((r) => r.periodId === period.id && !r.supersededBy && ["DRAFT", "UNDER_REVIEW", "LOCKED", "EXPORTED", "PAID"].includes(r.state));
    if (active) fail(409, "INVALID_TRANSITION", `A ${active.state.toLowerCase().replace("_", " ")} run already exists for ${period.label}.`);
    const revision = req.db.payrollRuns.filter((r) => r.periodId === period.id).length + 1;
    const run: RunWithExtras = {
      id: uuid(), periodId: period.id, revision, state: "DRAFT", preparedBy: req.me.employee?.id ?? req.me.user.id, inputHash: "",
      totals: { gross: "0.00", deductions: "0.00", net: "0.00", currency: period.currency, employees: 0 }, version: 1, approvals: [], exports: [], createdAt: nowIso(),
    };
    req.db.payrollLines.push(...buildLines(req, run, period));
    req.db.payrollRuns.push(run);
    recomputeRun(req.db, run);
    audit(req, "payroll.run.create", "PayrollRun", run.id, { after: { period: period.label, revision } });
    return run;
  }),

  route("GET", "/payroll-runs/:id", (req) => runDetail(req, getRun(req, req.params.id))),

  route("GET", "/payroll-lines/:id", (req): LineDetail => {
    requirePerm(req.me, "payroll.read");
    const line = req.db.payrollLines.find((l) => l.id === req.params.id);
    if (!line) return fail(404, "NOT_FOUND", "Payroll line not found.");
    const e = req.db.employees.find((x) => x.id === line.employeeId);
    return {
      line,
      run: runOf(req.db, line.runId)!,
      profile: req.db.compensation.find((c) => c.id === line.compensationProfileId),
      employee: e && { id: e.id, displayName: e.displayName, employeeCode: e.employeeCode, title: e.title },
    };
  }),

  route("POST", "/payroll-lines/:id/components", (req) => {
    requirePerm(req.me, "payroll.prepare");
    const line = req.db.payrollLines.find((l) => l.id === req.params.id);
    if (!line) return fail(404, "NOT_FOUND", "Payroll line not found.");
    const run = runOf(req.db, line.runId)!;
    assertEditable(run);
    checkVersion(req, run);
    const b = req.body as Partial<T.PayComponent>;
    const errs: Record<string, string> = {};
    if (!["BONUS", "OVERTIME", "DEDUCTION", "ADJUSTMENT"].includes(String(b.category))) errs.category = "Choose bonus, overtime, deduction or adjustment.";
    const amount = String(b.amount ?? "").trim();
    if (!MONEY_RE.test(amount) || dec(amount) <= 0n) errs.amount = "Enter a positive amount with up to 4 decimals.";
    if (!String(b.description ?? "").trim()) errs.description = "Explain what this line is for.";
    if (b.category === "DEDUCTION" && String(b.evidence ?? "").trim().length < 5) errs.evidence = "Deductions need a documented authorization or basis (e.g. signed authorization reference).";
    if (b.category === "OVERTIME" && !["FULL_RATE", "PREMIUM_ONLY"].includes(String(b.otRateBasis))) errs.otRateBasis = "State whether this is full rate or premium only to prevent double counting.";
    if (["BONUS", "ADJUSTMENT", "OVERTIME"].includes(String(b.category)) && !String(b.evidence ?? "").trim()) errs.evidence = "Reference the evidence or approval for this line.";
    if (Object.keys(errs).length) validation(errs);
    const comp: T.PayComponent = {
      id: uuid(), lineId: line.id, category: b.category as T.PayComponentCategory, description: String(b.description).trim(), amount: toFixed(dec(amount), 2),
      status: "PROPOSED", proposedBy: req.me.employee?.id ?? req.me.user.id, evidence: String(b.evidence ?? "").trim() || undefined,
      otRateBasis: b.category === "OVERTIME" ? b.otRateBasis : undefined, correctionOf: b.correctionOf || undefined,
    };
    line.components.push(comp);
    invalidate(req, run);
    audit(req, "payroll.component.propose", "PayrollLine", line.id, { after: { category: comp.category, amount: comp.amount } });
    return line;
  }),

  route("POST", "/payroll-components/:id/decision", (req) => {
    const line = req.db.payrollLines.find((l) => l.components.some((c) => c.id === req.params.id));
    const comp = line?.components.find((c) => c.id === req.params.id);
    if (!line || !comp) return fail(404, "NOT_FOUND", "Component not found.");
    const allowed = can(req.me, "payroll.approve") || (comp.category === "OVERTIME" && can(req.me, "overtime.validate"));
    if (!allowed) fail(403, "FORBIDDEN", "You cannot approve this component.");
    const eid = req.me.employee?.id;
    if (comp.proposedBy === eid) fail(403, "FORBIDDEN", "You proposed this line, so someone else must approve it.");
    if (line.employeeId === eid) fail(403, "FORBIDDEN", "You cannot approve components of your own pay.");
    const run = runOf(req.db, line.runId)!;
    assertEditable(run);
    if (comp.status !== "PROPOSED") fail(409, "INVALID_TRANSITION", "This component was already decided.");
    const decision = req.body.decision;
    if (!["APPROVE", "REJECT"].includes(decision)) validation({ decision: "Approve or reject." });
    if (decision === "REJECT" && String(req.body.reason ?? "").trim().length < 3) validation({ reason: "Give a reason for rejecting." });
    comp.status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
    comp.approvedBy = eid ?? req.me.user.id;
    invalidate(req, run);
    audit(req, `payroll.component.${decision.toLowerCase()}`, "PayComponent", comp.id, { reason: req.body.reason, after: { amount: comp.amount, category: comp.category } });
    return line;
  }),

  route("POST", "/payroll-runs/:id/submit-review", (req) => {
    requirePerm(req.me, "payroll.prepare");
    const run = getRun(req, req.params.id);
    checkVersion(req, run);
    if (run.state !== "DRAFT") fail(409, "INVALID_TRANSITION", "Only a draft run can be submitted for review.");
    recomputeRun(req.db, run);
    run.state = "UNDER_REVIEW";
    bump(run);
    const ex = req.db.payrollLines.filter((l) => l.runId === run.id).reduce((a, l) => a + l.exceptions.length, 0);
    audit(req, "payroll.run.submit_review", "PayrollRun", run.id);
    notifyRole(req.db, "OWNER", { kind: "PAYROLL_PUBLISHED", title: "Payroll ready for owner review", body: `Revision ${run.revision} submitted with ${ex} open exception(s).`, href: `/payroll/runs/${run.id}` });
    notifyRole(req.db, "HR", { kind: "PAYROLL_PUBLISHED", title: "Validate payroll attendance exceptions", body: `A payroll run is under review.`, href: `/payroll/runs/${run.id}` });
    return runDetail(req, run);
  }),

  route("POST", "/payroll-runs/:id/owner-exception", (req) => {
    requirePerm(req.me, "payroll.approve");
    const run = getRun(req, req.params.id);
    assertEditable(run);
    const employeeId = String(req.body.employeeId ?? "");
    if (!isOwnerEmployee(req.db, employeeId)) validation({ employeeId: "Owner exceptions apply only to the owner's own line." });
    const reason = String(req.body.reason ?? "").trim();
    if (reason.length < 10) validation({ reason: "Record why the owner's own line is approved and what review evidence exists." });
    const rec: OwnerException = { employeeId, reason, by: req.me.employee?.id ?? req.me.user.id, at: nowIso() };
    run.ownerExceptions = [...(run.ownerExceptions ?? []).filter((o) => o.employeeId !== employeeId), rec];
    recomputeRun(req.db, run);
    bump(run);
    audit(req, "payroll.owner_exception.record", "PayrollRun", run.id, { reason });
    return runDetail(req, run);
  }),

  route("POST", "/payroll-runs/:id/approve", (req) => {
    requirePerm(req.me, "payroll.approve");
    const run = getRun(req, req.params.id);
    const hash = String(req.body.inputHash ?? "");
    const prior = run.approvals.find((a) => a.inputHash === hash);
    if (prior && run.state !== "UNDER_REVIEW") return { run, approval: prior };
    checkVersion(req, run);
    if (run.state !== "UNDER_REVIEW") fail(409, "INVALID_TRANSITION", "Only a run under review can be approved.");
    if (run.preparedBy === req.me.employee?.id) fail(403, "FORBIDDEN", "The preparer of a payroll batch cannot approve it.");
    if (!req.body.reauthenticationProof || !reauthFresh(req.me)) fail(401, "REAUTH_REQUIRED", "Re-authenticate within the last 10 minutes to approve payroll.");
    if (hash !== run.inputHash) fail(409, "VERSION_CONFLICT", "Payroll inputs changed since you reviewed them. Review the new totals and hash.", { latest: run });
    const reason = String(req.body.reason ?? "").trim();
    if (reason.length < 3) validation({ reason: "Record your approval note." });
    recomputeRun(req.db, run);
    if (run.inputHash !== hash) fail(409, "VERSION_CONFLICT", "Payroll inputs changed since you reviewed them.", { latest: run });
    const lines = req.db.payrollLines.filter((l) => l.runId === run.id);
    const ex = lines.flatMap((l) => l.exceptions.map((e) => `${employeeLabel(req.db, l.employeeId)}: ${e}`));
    if (ex.length) fail(422, "POLICY_BLOCKED", `Resolve ${ex.length} blocking exception(s) first: ${ex.slice(0, 3).join("; ")}${ex.length > 3 ? "…" : ""}`);
    const approval = { id: uuid(), ownerId: req.me.employee?.id ?? req.me.user.id, inputHash: run.inputHash, approvedAt: nowIso(), reason };
    run.approvals.push(approval);
    run.state = "LOCKED";
    run.lockedAt = approval.approvedAt;
    bump(run);
    const period = req.db.payrollPeriods.find((p) => p.id === run.periodId);
    if (period) period.state = "CLOSED";
    generatePayslips(req.db, run, approval.id);
    for (const l of lines) notifyEmployee(req.db, l.employeeId, { kind: "PAYROLL_PUBLISHED", title: `Payslip published: ${period?.label}`, body: "Your payslip is available in the portal.", href: `/payslips/ps-${run.id}-${l.employeeId}` });
    audit(req, "payroll.run.approve", "PayrollRun", run.id, { reason, after: { inputHash: run.inputHash, net: run.totals.net } });
    return { run, approval };
  }),

  route("POST", "/payroll-runs/:id/exports", (req) => {
    requirePerm(req.me, "payroll.export");
    const run = getRun(req, req.params.id);
    if (!["LOCKED", "EXPORTED", "PAID"].includes(run.state)) fail(409, "INVALID_TRANSITION", "Only owner-approved, locked runs can be exported.");
    const period = req.db.payrollPeriods.find((p) => p.id === run.periodId)!;
    const at = nowIso();
    const exp = { id: uuid(), at, by: req.me.employee?.id ?? req.me.user.id, format: "CSV" as const, expiresAt: new Date(Date.now() + 24 * 3600000).toISOString() };
    run.exports.push(exp);
    if (run.state === "LOCKED") run.state = "EXPORTED";
    run.exportedAt = run.exportedAt ?? at;
    bump(run);
    const who = req.me.employee?.displayName ?? req.me.user.email;
    const rows: unknown[][] = [
      [`# CONFIDENTIAL payroll register — ${period.label} rev ${run.revision} — exported by ${who} at ${fmtDateTime(at, period.timezone)} (${period.timezone}) — export ${exp.id}`],
      ["employee_code", "employee", "gross", "deductions", "net", "currency", "approval_id", "input_hash"],
      ...req.db.payrollLines
        .filter((l) => l.runId === run.id)
        .map((l) => {
          const e = req.db.employees.find((x) => x.id === l.employeeId);
          return [e?.employeeCode, e?.displayName, l.gross, l.deductions, l.net, run.totals.currency, run.approvals[run.approvals.length - 1]?.id, run.inputHash];
        }),
      ["TOTAL", "", run.totals.gross, run.totals.deductions, run.totals.net, run.totals.currency, "", ""],
    ];
    audit(req, "payroll.export", "PayrollRun", run.id, { after: { exportId: exp.id } });
    return { export: exp, filename: `payroll-${period.start.slice(0, 7)}-rev${run.revision}.csv`, csv: rows.map((r) => r.map(csvCell).join(",")).join("\r\n") };
  }),

  route("POST", "/payroll-runs/:id/mark-paid", (req) => {
    if (!can(req.me, "payroll.export") && !can(req.me, "payroll.approve")) fail(403, "FORBIDDEN", "You cannot mark payroll paid.");
    const run = getRun(req, req.params.id);
    checkVersion(req, run);
    if (run.state !== "EXPORTED") fail(409, "INVALID_TRANSITION", "Export the locked run before marking it paid.");
    const ref = String(req.body.paymentReference ?? "").trim();
    const date = String(req.body.paidDate ?? "");
    const errs: Record<string, string> = {};
    if (ref.length < 3) errs.paymentReference = "Enter the external payment reference.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errs.paidDate = "Enter the payment date.";
    if (Object.keys(errs).length) validation(errs);
    run.state = "PAID";
    run.paymentReference = ref;
    run.paidAt = new Date(`${date}T12:00:00Z`).toISOString();
    bump(run);
    audit(req, "payroll.mark_paid", "PayrollRun", run.id, { after: { paymentReference: ref, paidDate: date } });
    return runDetail(req, run);
  }),

  route("POST", "/payroll-runs/:id/reopen", (req) => {
    requirePerm(req.me, "payroll.reopen");
    const run = getRun(req, req.params.id);
    checkVersion(req, run);
    if (run.state === "PAID") fail(409, "INVALID_TRANSITION", "Paid snapshots never change. Create a linked adjustment in the next period instead.");
    if (!["LOCKED", "EXPORTED"].includes(run.state)) fail(409, "INVALID_TRANSITION", "Only locked or exported runs can be reopened.");
    if (run.supersededBy) fail(409, "INVALID_TRANSITION", "This revision was already reopened.");
    const reason = String(req.body.reason ?? "").trim();
    if (reason.length < 10) validation({ reason: "Explain why the approved run must be reopened." });
    const next: RunWithExtras = {
      ...structuredClone(run), id: uuid(), revision: req.db.payrollRuns.filter((r) => r.periodId === run.periodId).length + 1, state: "DRAFT",
      preparedBy: run.preparedBy, approvals: [], exports: [], lockedAt: undefined, exportedAt: undefined, version: 1, createdAt: nowIso(),
      reopenedFrom: run.id, reopenReason: reason, supersededBy: undefined, ownerExceptions: [],
    };
    const lines = req.db.payrollLines.filter((l) => l.runId === run.id).map((l) => {
      const id = uuid();
      return { ...structuredClone(l), id, runId: next.id, components: l.components.map((c) => ({ ...c, id: uuid(), lineId: id })) };
    });
    req.db.payrollLines.push(...lines);
    req.db.payrollRuns.push(next);
    run.supersededBy = next.id;
    bump(run);
    const period = req.db.payrollPeriods.find((p) => p.id === run.periodId);
    if (period) period.state = "OPEN";
    req.db.payslips = req.db.payslips.filter((p) => p.runId !== run.id);
    recomputeRun(req.db, next);
    audit(req, "payroll.run.reopen", "PayrollRun", run.id, { reason, after: { newRevision: next.revision, newRunId: next.id } });
    notifyRole(req.db, "PAYROLL", { kind: "PAYROLL_PUBLISHED", title: "Payroll reopened", body: `Revision ${next.revision} created: ${reason}`, href: `/payroll/runs/${next.id}` });
    return next;
  }),

  route("GET", "/compensation", (req): CompensationRow[] => {
    requirePerm(req.me, "compensation.read");
    const today = new Date().toISOString().slice(0, 10);
    audit(req, "compensation.read", "CompensationProfile", "list");
    return req.db.compensation
      .map((c) => {
        const e = req.db.employees.find((x) => x.id === c.employeeId);
        return { ...c, employeeName: e?.displayName ?? "Unknown", employeeCode: e?.employeeCode ?? "", current: c.effectiveFrom <= today && (!c.effectiveTo || c.effectiveTo >= today) };
      })
      .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode) || b.effectiveFrom.localeCompare(a.effectiveFrom));
  }),

  route("GET", "/me/payslips", (req) => {
    requirePerm(req.me, "payslip.read");
    const eid = req.me.employee?.id;
    return { items: req.db.payslips.filter((p) => p.employeeId === eid).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)) };
  }),

  route("GET", "/payslips/:id", (req) => {
    const p = req.db.payslips.find((x) => x.id === req.params.id);
    const own = p && p.employeeId === req.me.employee?.id;
    if (!p || (!own && !can(req.me, "payroll.read"))) return fail(404, "NOT_FOUND", "Payslip not found.");
    if (!own) audit(req, "payslip.read", "Payslip", p.id);
    const run = runOf(req.db, p.runId);
    const e = req.db.employees.find((x) => x.id === p.employeeId);
    return { payslip: p, approval: run?.approvals.find((a) => a.id === p.approvalId), employee: e && { displayName: e.displayName, employeeCode: e.employeeCode, title: e.title }, organization: req.db.organization.name };
  }),
];
