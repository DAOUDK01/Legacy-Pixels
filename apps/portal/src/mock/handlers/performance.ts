/** Performance routes: score snapshots, disputes and owner overrides (spec section 13). */
import type * as T from "@/lib/types";
import { can, scopeOf } from "@/lib/rbac";
import { businessDate } from "@/lib/time";
import { DISPUTE_WINDOW_DAYS, type ScoreDetail } from "@/lib/api/performance";
import {
  audit, canSeeEmployee, fail, filterByEmployee, notifyEmployee, notifyRole, nowIso, requirePerm, uuid, validation, type MockReq,
} from "../helpers";
import { route } from "../routes";

function currentPeriodStart(req: MockReq): string {
  return businessDate(new Date(), req.db.organization.timezone).slice(0, 7) + "-01";
}

function getSnapshot(req: MockReq, id: string): T.ScoreSnapshot {
  requirePerm(req.me, "score.read");
  const s = req.db.scores.find((x) => x.id === id);
  if (!s || !canSeeEmployee(req.db, req.me, "score.read", s.employeeId)) return fail(404, "NOT_FOUND", "Score snapshot not found.");
  return s;
}

function disputeWindow(s: T.ScoreSnapshot, today: string): { deadline?: string; open: boolean } {
  if (s.status === "PROVISIONAL" || s.status === "DISPUTED") return { open: true };
  const deadline = new Date(new Date(s.computedAt).getTime() + DISPUTE_WINDOW_DAYS * 86400000).toISOString();
  return { deadline, open: Date.now() <= new Date(deadline).getTime() || s.periodEnd >= today };
}

function baseStatus(s: T.ScoreSnapshot, today: string): T.ScoreStatus {
  if (s.override) return "OVERRIDDEN";
  return s.periodEnd >= today ? "PROVISIONAL" : "FINAL";
}

function detail(req: MockReq, s: T.ScoreSnapshot): ScoreDetail {
  const today = businessDate(new Date(), req.db.organization.timezone);
  const isOwn = req.me.employee?.id === s.employeeId;
  const win = disputeWindow(s, today);
  const openDispute = req.db.disputes.some((d) => d.snapshotId === s.id && (d.status === "OPEN" || d.status === "UNDER_REVIEW"));
  let blocked: string | undefined;
  if (!isOwn) blocked = "Only the employee can dispute their own score.";
  else if (!can(req.me, "score.dispute")) blocked = "Your role cannot raise disputes.";
  else if (!win.open) blocked = `The ${DISPUTE_WINDOW_DAYS}-day dispute window for this finalized period has closed.`;
  else if (openDispute) blocked = "You already have an open dispute on this snapshot.";
  return {
    snapshot: s,
    disputes: req.db.disputes.filter((d) => d.snapshotId === s.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    isOwn,
    canDispute: !blocked,
    disputeBlockedReason: blocked,
    disputeDeadline: win.deadline,
    canOverride: can(req.me, "score.override") && !isOwn,
    canResolve: can(req.me, "score.dispute.resolve") && !isOwn,
  };
}

export const performanceRoutes = [
  route("GET", "/scores", (req) => {
    requirePerm(req.me, "score.read");
    const cps = currentPeriodStart(req);
    let rows = filterByEmployee(req.db, req.me, "score.read", req.db.scores);
    if (req.query.period === "current") rows = rows.filter((s) => s.periodStart >= cps);
    if (req.query.period === "previous") rows = rows.filter((s) => s.periodStart < cps);
    if (req.query.employeeId) rows = rows.filter((s) => s.employeeId === req.query.employeeId);
    rows = [...rows].sort((a, b) => b.periodStart.localeCompare(a.periodStart) || (b.weightedScore ?? -1) - (a.weightedScore ?? -1));
    const scope = scopeOf(req.me, "score.read");
    return { items: rows, currentPeriodStart: cps, scope: scope === "organization" ? "organization" : scope === "team" ? "team" : "self" };
  }),

  route("GET", "/scores/:id", (req) => detail(req, getSnapshot(req, req.params.id))),

  route("POST", "/scores/:id/disputes", (req) => {
    const s = getSnapshot(req, req.params.id);
    const d = detail(req, s);
    if (!d.canDispute) fail(422, "POLICY_BLOCKED", d.disputeBlockedReason ?? "Dispute not allowed.");
    const reason = String(req.body.reason ?? "").trim();
    if (reason.length < 10) validation({ reason: "Describe what looks wrong (at least 10 characters)." });
    const component = req.body.component as T.ScoreComponentKey | undefined;
    if (component && !["A", "O", "Q", "D", "L"].includes(component)) validation({ component: "Unknown component." });
    const dispute: T.ScoreDispute = { id: uuid(), snapshotId: s.id, employeeId: s.employeeId, component: component || undefined, reason, status: "OPEN", createdAt: nowIso() };
    req.db.disputes.unshift(dispute);
    if (!s.override) s.status = "DISPUTED";
    audit(req, "score.dispute.create", "ScoreSnapshot", s.id, { reason });
    notifyRole(req.db, "OWNER", { kind: "CORRECTION", title: "New score dispute", body: `${req.me.employee?.displayName} disputed ${component ? `component ${component}` : "their score"}.`, href: `/scores/${s.id}` });
    return dispute;
  }),

  route("GET", "/disputes", (req) => {
    requirePerm(req.me, "score.read");
    const rows = filterByEmployee(req.db, req.me, "score.read", req.db.disputes).map((d) => {
      const s = req.db.scores.find((x) => x.id === d.snapshotId);
      return { ...d, periodStart: s?.periodStart, periodEnd: s?.periodEnd };
    });
    const status = req.query.status;
    return { items: rows.filter((d) => !status || (status === "open" ? ["OPEN", "UNDER_REVIEW"].includes(d.status) : d.status === status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
  }),

  route("POST", "/disputes/:id/decision", (req) => {
    requirePerm(req.me, "score.dispute.resolve");
    const d = req.db.disputes.find((x) => x.id === req.params.id);
    if (!d) return fail(404, "NOT_FOUND", "Dispute not found.");
    if (d.employeeId === req.me.employee?.id) fail(403, "FORBIDDEN", "You cannot resolve your own dispute.");
    if (d.status === "UPHELD" || d.status === "REJECTED") fail(409, "INVALID_TRANSITION", "This dispute is already resolved.");
    const status = req.body.status as T.ScoreDispute["status"];
    if (!["UNDER_REVIEW", "UPHELD", "REJECTED"].includes(status)) validation({ status: "Choose under review, upheld or rejected." });
    const resolution = String(req.body.resolution ?? "").trim();
    if (status !== "UNDER_REVIEW" && resolution.length < 5) validation({ resolution: "Record the outcome and evidence considered." });
    d.status = status;
    if (resolution) d.resolution = resolution;
    const s = req.db.scores.find((x) => x.id === d.snapshotId);
    if (s && status !== "UNDER_REVIEW") {
      const stillOpen = req.db.disputes.some((x) => x.snapshotId === s.id && x.id !== d.id && ["OPEN", "UNDER_REVIEW"].includes(x.status));
      if (!stillOpen) s.status = baseStatus(s, businessDate(new Date(), req.db.organization.timezone));
    }
    audit(req, `score.dispute.${status.toLowerCase()}`, "ScoreDispute", d.id, { reason: resolution || undefined });
    notifyEmployee(req.db, d.employeeId, { kind: "CORRECTION", title: `Score dispute ${status === "UNDER_REVIEW" ? "under review" : status.toLowerCase()}`, body: resolution || "Your dispute is being reviewed.", href: `/scores/${d.snapshotId}` });
    return d;
  }),

  route("POST", "/scores/:id/override", (req) => {
    requirePerm(req.me, "score.override");
    const s = getSnapshot(req, req.params.id);
    if (s.employeeId === req.me.employee?.id) fail(403, "FORBIDDEN", "You cannot override your own score.");
    const score = Number(req.body.score);
    const reason = String(req.body.reason ?? "").trim();
    const evidence = String(req.body.evidence ?? "").trim();
    const errs: Record<string, string> = {};
    if (!Number.isFinite(score) || score < 0 || score > 100) errs.score = "Enter a score between 0 and 100.";
    if (reason.length < 5) errs.reason = "A reason is required.";
    if (evidence.length < 3) errs.evidence = "Reference the evidence for this override.";
    if (Object.keys(errs).length) validation(errs);
    const before = { score: s.override?.score ?? s.weightedScore, status: s.status };
    s.override = { score: Math.round(score * 10) / 10, reason: `${reason} (evidence: ${evidence})`, by: req.me.employee?.id ?? req.me.user.id, at: nowIso() };
    s.status = "OVERRIDDEN";
    audit(req, "score.override", "ScoreSnapshot", s.id, { reason, before, after: { score: s.override.score, original: s.weightedScore } });
    notifyEmployee(req.db, s.employeeId, { kind: "CORRECTION", title: "Score override recorded", body: "The owner recorded an override with evidence. Your original computed score is preserved.", href: `/scores/${s.id}` });
    return detail(req, s);
  }),
];
