/**
 * Authorized tracking routes (spec sections 10-12). The real Windows agent owns collection; these routes
 * expose employee-visible status and scoped summaries. Portal "control" simulates the agent for demo use.
 */
import type * as T from "@/lib/types";
import { can } from "@/lib/rbac";
import { addDays, businessDate } from "@/lib/time";
import type { ScreenshotView, SessionDetail, SessionRow, TeamTrackingRow, TrackingMe } from "@/lib/api/monitoring";
import type { MockDb } from "../db";
import {
  audit, canSeeEmployee, employeeLabel, fail, notifyRole, nowIso, requirePerm, uuid, validation, visibleEmployees, type MockReq,
} from "../helpers";
import { route } from "../routes";

const MIN = 60000;
const LEASE_MINUTES = 5;

function monitoringPolicy(db: MockDb) {
  const approved = db.policies.filter((p) => p.type === "MONITORING" && p.status === "APPROVED").sort((a, b) => b.version - a.version)[0];
  const pending = db.policies.find((p) => p.type === "MONITORING" && p.status === "PENDING_APPROVAL");
  return { approved, pending };
}

/** Recompute live session minutes so active/idle/paused/unknown stay mutually exclusive and bounded by the session. */
function tick(db: MockDb, s: T.TrackingSession): void {
  if (s.state === "STOPPED") return;
  const total = Math.max(0, Math.round((Date.now() - new Date(s.startedAt).getTime()) / MIN));
  const cadence = Number(monitoringPolicy(db).approved?.config.screenshotCadenceMinutes ?? 10);
  if (s.state === "ACTIVE" || s.state === "IDLE") {
    s.activeMinutes = Math.max(0, total - s.idleMinutes - s.pausedMinutes - s.unknownMinutes);
    s.authorizationExpiresAt = new Date(Date.now() + LEASE_MINUTES * MIN).toISOString();
    s.screenshotCount = Math.floor(s.activeMinutes / cadence);
  } else if (s.state === "PAUSED") {
    s.pausedMinutes = Math.max(0, total - s.activeMinutes - s.idleMinutes - s.unknownMinutes);
  }
}

function sessionRow(db: MockDb, s: T.TrackingSession): SessionRow {
  tick(db, s);
  return {
    ...s,
    employeeName: employeeLabel(db, s.employeeId),
    deviceHostname: db.devices.find((d) => d.id === s.deviceId)?.hostname,
    gapCount: db.gaps.filter((g) => g.sessionId === s.id).length,
    taskTitle: db.tasks.find((t) => t.id === s.taskId)?.title,
  };
}

function isCheckedIn(db: MockDb, employeeId: string): boolean {
  const since = Date.now() - 20 * 3600000;
  const evs = db.attendanceEvents
    .filter((e) => e.employeeId === employeeId && new Date(e.occurredAt).getTime() >= since)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const last = evs[evs.length - 1];
  return !!last && (last.kind === "CHECK_IN" || last.kind === "BREAK_END");
}

function ackFor(db: MockDb, employeeId: string, version?: number) {
  const prof = db.privateProfiles.find((p) => p.employeeId === employeeId);
  const ack = prof?.acknowledgements.filter((a) => a.policyType === "MONITORING").sort((a, b) => b.version - a.version)[0];
  return { acknowledged: !!ack && version !== undefined && ack.version >= version, at: ack?.acknowledgedAt };
}

function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return h;
}

function canSeeSession(req: MockReq, s: T.TrackingSession): boolean {
  if (s.employeeId === req.me.employee?.id) return true;
  return canSeeEmployee(req.db, req.me, "monitoring.summary.read", s.employeeId) && can(req.me, "monitoring.summary.read");
}

function canSeeEvidence(req: MockReq, employeeId: string): boolean {
  if (employeeId === req.me.employee?.id) return true;
  return can(req.me, "monitoring.evidence.read") && canSeeEmployee(req.db, req.me, "monitoring.evidence.read", employeeId);
}

export const monitoringRoutes = [
  route("GET", "/tracking/me", (req) => {
    const { db, me } = req;
    const eid = me.employee?.id;
    if (!eid) fail(404, "NOT_FOUND", "No employee record is linked to this account.");
    const { approved, pending } = monitoringPolicy(db);
    const cur = db.sessions.find((s) => s.employeeId === eid && s.state !== "STOPPED");
    if (cur) tick(db, cur);
    const ack = ackFor(db, eid!, approved?.version);
    const code = db.enrollmentCodes.find((c) => c.employeeId === eid && !c.used && new Date(c.expiresAt).getTime() > Date.now());
    const result: TrackingMe = {
      employeeId: eid!,
      devices: db.devices.filter((d) => d.employeeId === eid),
      current: cur ? { ...cur, taskTitle: db.tasks.find((t) => t.id === cur.taskId)?.title } : undefined,
      currentActivity: cur ? db.activity[cur.id] ?? [] : [],
      policy: approved,
      pendingPolicy: pending,
      acknowledged: ack.acknowledged,
      acknowledgedAt: ack.at,
      checkedIn: isCheckedIn(db, eid!),
      enrollmentCode: code ? { code: code.code, expiresAt: code.expiresAt } : undefined,
    };
    return result;
  }),

  route("POST", "/tracking/me/acknowledge", (req) => {
    const eid = req.me.employee?.id;
    if (!eid) fail(403, "FORBIDDEN", "Only employees acknowledge monitoring policies.");
    const { approved } = monitoringPolicy(req.db);
    if (!approved) fail(422, "POLICY_BLOCKED", "No approved monitoring policy exists.");
    if (req.body.version !== approved!.version) fail(409, "VERSION_CONFLICT", "The policy changed. Review the latest version before acknowledging.", { latest: approved });
    const prof = req.db.privateProfiles.find((p) => p.employeeId === eid);
    prof?.acknowledgements.push({ policyType: "MONITORING", version: approved!.version, acknowledgedAt: nowIso() });
    audit(req, "policy.acknowledge", "PolicyVersion", approved!.id);
    return { ok: true };
  }),

  /** Short-lived single-use code the employee types into the agent (proposed 10 minutes). */
  route("POST", "/agent/enroll-code", (req) => {
    const eid = req.me.employee?.id;
    if (!eid) fail(403, "FORBIDDEN", "Only employees can enroll a device.");
    const emp = req.db.employees.find((e) => e.id === eid);
    if (emp?.employmentStatus !== "ACTIVE") fail(403, "FORBIDDEN", "Inactive employees can't enroll devices.");
    for (const c of req.db.enrollmentCodes) if (c.employeeId === eid && !c.used) c.used = true; // supersede older codes
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const code = Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
    const entry = { code: `${code.slice(0, 4)}-${code.slice(4)}`, employeeId: eid!, expiresAt: new Date(Date.now() + 10 * MIN).toISOString(), used: false };
    req.db.enrollmentCodes.push(entry);
    audit(req, "agent.enroll_code.issue", "Employee", eid!);
    return { code: entry.code, expiresAt: entry.expiresAt };
  }),

  route("GET", "/tracking/sessions", (req) => {
    const { db, me } = req;
    const eid = req.query.employeeId ?? me.employee?.id;
    if (!eid) fail(404, "NOT_FOUND", "No employee selected.");
    if (eid !== me.employee?.id && !(can(me, "monitoring.summary.read") && canSeeEmployee(db, me, "monitoring.summary.read", eid!))) fail(404, "NOT_FOUND", "Employee not found.");
    const tz = db.organization.timezone;
    const today = businessDate(new Date(), tz);
    const to = req.query.to ?? today;
    const from = req.query.from ?? addDays(to, -13);
    return db.sessions
      .filter((s) => s.employeeId === eid)
      .filter((s) => {
        const d = businessDate(s.startedAt, tz);
        return d >= from && d <= to;
      })
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map((s) => sessionRow(db, s));
  }),

  route("GET", "/tracking/sessions/:id", (req) => {
    const { db } = req;
    const s = db.sessions.find((x) => x.id === req.params.id);
    if (!s || !canSeeSession(req, s)) fail(404, "NOT_FOUND", "Session not found.");
    const evidence = canSeeEvidence(req, s!.employeeId);
    const detail: SessionDetail = {
      session: sessionRow(db, s!),
      activity: db.activity[s!.id] ?? [],
      gaps: db.gaps.filter((g) => g.sessionId === s!.id),
      // Metadata only; images are fetched one at a time through an audited, reason-bound read.
      screenshots: evidence ? db.screenshots.filter((x) => x.sessionId === s!.id) : [],
      screenshotsVisible: evidence,
      idle: s!.employeeId === req.me.employee?.id || can(req.me, "monitoring.summary.read") ? db.idleLabels.filter((i) => i.sessionId === s!.id) : [],
      isOwn: s!.employeeId === req.me.employee?.id,
    };
    return detail;
  }),

  /** Simulates the employee-visible agent controls: start, pause, resume, stop. */
  route("POST", "/tracking/sessions/:id/control", (req) => {
    const { db, me } = req;
    const eid = me.employee?.id;
    const action = req.body.action as "start" | "pause" | "resume" | "stop";
    if (action === "start") {
      if (!eid) fail(403, "FORBIDDEN", "Only employees can start tracking.");
      const { approved } = monitoringPolicy(db);
      const dev = db.devices.find((d) => d.employeeId === eid && d.status === "ACTIVE");
      if (!dev) fail(422, "POLICY_BLOCKED", "Enroll an active device in the desktop agent first.");
      if (!ackFor(db, eid!, approved?.version).acknowledged) fail(422, "POLICY_BLOCKED", "Acknowledge the current monitoring policy before starting a session.");
      if (!isCheckedIn(db, eid!)) fail(422, "POLICY_BLOCKED", "Check in first. Tracking only runs inside an authorized attendance interval.");
      // Prevent simultaneous accepted sessions: a takeover explicitly closes the prior one.
      for (const s of db.sessions.filter((x) => x.employeeId === eid && x.state !== "STOPPED")) {
        tick(db, s);
        s.state = "STOPPED";
        s.endedAt = nowIso();
      }
      const now = nowIso();
      const s: T.TrackingSession = {
        id: `ses-${uuid()}`, employeeId: eid!, deviceId: dev!.id, taskId: req.body.taskId || undefined, state: "ACTIVE", offline: false,
        startedAt: now, authorizationExpiresAt: new Date(Date.now() + LEASE_MINUTES * MIN).toISOString(), policyVersion: approved?.version ?? 0,
        activeMinutes: 0, idleMinutes: 0, pausedMinutes: 0, unknownMinutes: 0, screenshotCount: 0, pendingUploads: 0,
      };
      db.sessions.push(s);
      db.activity[s.id] = [];
      audit(req, "tracking.session.start", "TrackingSession", s.id);
      return sessionRow(db, s);
    }
    const s = db.sessions.find((x) => x.id === req.params.id);
    if (!s) fail(404, "NOT_FOUND", "Session not found.");
    if (s!.employeeId !== eid) fail(403, "FORBIDDEN", "Only the employee can control their own session.");
    tick(db, s!);
    const transitions: Record<string, T.SessionState[]> = { pause: ["ACTIVE", "IDLE"], resume: ["PAUSED"], stop: ["ACTIVE", "IDLE", "PAUSED", "STARTING"] };
    if (!transitions[action]) validation({ action: "Unknown action." });
    if (!transitions[action].includes(s!.state)) fail(409, "INVALID_TRANSITION", `Can't ${action} a session that is ${s!.state.toLowerCase()}.`);
    if (action === "pause") {
      s!.state = "PAUSED";
      s!.pendingUploads = Math.max(0, s!.pendingUploads); // pending captures already queued may still upload; new capture buffers are cleared
    } else if (action === "resume") {
      s!.state = "ACTIVE";
    } else {
      s!.state = "STOPPED";
      s!.endedAt = nowIso();
    }
    audit(req, `tracking.session.${action}`, "TrackingSession", s!.id);
    return sessionRow(db, s!);
  }),

  route("POST", "/tracking/idle/:id/label", (req) => {
    const i = req.db.idleLabels.find((x) => x.id === req.params.id);
    if (!i) fail(404, "NOT_FOUND", "Idle interval not found.");
    const s = req.db.sessions.find((x) => x.id === i!.sessionId);
    if (s?.employeeId !== req.me.employee?.id) fail(403, "FORBIDDEN", "Only the employee can label their idle time.");
    const label = req.body.label as T.IdleLabelRequest["label"];
    if (!label || !["MEETING", "OFFLINE_WORK", "BREAK", "OTHER"].includes(label)) validation({ label: "Choose a label." });
    if (label === "OTHER" && !req.body.note?.trim()) validation({ note: "Describe the activity." });
    i!.label = label;
    i!.note = req.body.note?.trim() || undefined;
    audit(req, "tracking.idle.label", "IdleInterval", i!.id);
    return i;
  }),

  route("GET", "/tracking/team", (req) => {
    const { db, me } = req;
    requirePerm(me, "monitoring.summary.read");
    const vis = visibleEmployees(db, me, "monitoring.summary.read");
    if (vis !== "all" && vis.size <= 1 && !can(me, "monitoring.summary.read:team") && !can(me, "monitoring.summary.read:organization")) fail(403, "FORBIDDEN", "Team tracking summaries aren't available for your role.");
    const tz = db.organization.timezone;
    const today = businessDate(new Date(), tz);
    const to = req.query.to ?? today;
    const from = req.query.from ?? addDays(to, -6);
    const rows: TeamTrackingRow[] = db.employees
      .filter((e) => e.employmentStatus === "ACTIVE" && (vis === "all" || vis.has(e.id)) && e.id !== me.employee?.id)
      .filter((e) => !req.query.teamId || e.teamId === req.query.teamId)
      .map((e) => {
        const ss = db.sessions.filter((s) => s.employeeId === e.id && businessDate(s.startedAt, tz) >= from && businessDate(s.startedAt, tz) <= to);
        ss.forEach((s) => tick(db, s));
        const sum = (k: "activeMinutes" | "idleMinutes" | "pausedMinutes" | "unknownMinutes") => ss.reduce((a, s) => a + s[k], 0);
        const total = sum("activeMinutes") + sum("idleMinutes") + sum("pausedMinutes") + sum("unknownMinutes");
        const dev = db.devices.filter((d) => d.employeeId === e.id).sort((a, b) => (a.status === "ACTIVE" ? -1 : 1) - (b.status === "ACTIVE" ? -1 : 1))[0];
        return {
          employeeId: e.id, employeeName: e.displayName,
          liveState: db.sessions.find((s) => s.employeeId === e.id && s.state !== "STOPPED")?.state ?? "NONE",
          sessions: ss.length, activeMinutes: sum("activeMinutes"), idleMinutes: sum("idleMinutes"), pausedMinutes: sum("pausedMinutes"), unknownMinutes: sum("unknownMinutes"),
          gaps: db.gaps.filter((g) => ss.some((s) => s.id === g.sessionId)).length,
          coveragePct: total ? Math.round(((total - sum("unknownMinutes")) / total) * 1000) / 10 : null,
          device: dev ? { hostname: dev.hostname, status: dev.status, agentVersion: dev.agentVersion, lastSeen: dev.lastSeen } : undefined,
        };
      });
    return { from, to, timezone: tz, rows, evidenceAccess: can(me, "monitoring.evidence.read") };
  }),

  /** Single screenshot read: re-checks RBAC, requires an access reason for non-self, audited (section 11). */
  route("GET", "/tracking/screenshots/:id", (req) => {
    const { db, me } = req;
    const shot = db.screenshots.find((x) => x.id === req.params.id);
    if (!shot) fail(404, "NOT_FOUND", "Screenshot not found.");
    const own = shot!.employeeId === me.employee?.id;
    if (!own) {
      if (!canSeeEvidence(req, shot!.employeeId)) {
        audit(req, "monitoring.evidence.read", "Screenshot", shot!.id, { result: "DENIED" });
        fail(403, "FORBIDDEN", "Viewing screenshots requires the monitoring evidence capability.");
      }
      const reason = (req.query.reason ?? "").trim();
      if (reason.length < 5) validation({ reason: "Give an access reason (at least 5 characters). It is recorded in the audit log." });
      if (shot!.restricted && !can(me, "monitoring.restrict")) fail(403, "FORBIDDEN", "This capture is restricted pending a privacy review.");
      audit(req, "monitoring.evidence.read", "Screenshot", shot!.id, { reason });
    }
    const view: ScreenshotView = { screenshot: shot!, employeeName: employeeLabel(db, shot!.employeeId), seed: seedOf(shot!.id) };
    return view;
  }),

  route("POST", "/tracking/screenshots/:id/restrict-request", (req) => {
    const shot = req.db.screenshots.find((x) => x.id === req.params.id);
    if (!shot) fail(404, "NOT_FOUND", "Screenshot not found.");
    if (shot!.employeeId !== req.me.employee?.id) fail(403, "FORBIDDEN", "Only the employee can request restriction of their own capture.");
    const reason = (req.body.reason ?? "").trim();
    if (reason.length < 5) validation({ reason: "Tell the privacy reviewer why (at least 5 characters)." });
    shot!.restricted = true; // access is restricted immediately while the request is reviewed
    notifyRole(req.db, "OWNER", { kind: "SECURITY", title: "Screenshot restriction requested", body: `${employeeLabel(req.db, shot!.employeeId)} asked to restrict a capture. Access is restricted pending review.`, href: "/tracking/team", mandatory: true });
    audit(req, "monitoring.evidence.restrict_request", "Screenshot", shot!.id, { reason });
    return shot;
  }),

  /** Privacy notice data for every signed-in user (section 25 privacy configuration). */
  route("GET", "/privacy/notice", (req) => {
    const { db, me } = req;
    const { approved, pending } = monitoringPolicy(db);
    const retention = db.policies.filter((p) => p.type === "RETENTION").sort((a, b) => b.version - a.version)[0];
    const eid = me.employee?.id;
    const ack = eid ? ackFor(db, eid, approved?.version) : undefined;
    return {
      monitoring: approved, pendingMonitoring: pending, retention,
      acknowledged: ack?.acknowledged ?? false, acknowledgedAt: ack?.at, isEmployee: !!eid,
      organization: db.organization.name,
    };
  }),

  route("GET", "/devices", (req) => {
    const { db, me } = req;
    if (can(me, "device.read")) {
      return db.devices.map((d) => ({ ...d, employeeName: employeeLabel(db, d.employeeId) }));
    }
    return db.devices.filter((d) => d.employeeId === me.employee?.id).map((d) => ({ ...d, employeeName: employeeLabel(db, d.employeeId) }));
  }),

  route("POST", "/devices/:id/revoke", (req) => {
    requirePerm(req.me, "device.revoke");
    const d = req.db.devices.find((x) => x.id === req.params.id);
    if (!d) fail(404, "NOT_FOUND", "Device not found.");
    if (d!.status === "REVOKED") fail(409, "INVALID_TRANSITION", "Device is already revoked.");
    const reason = (req.body.reason ?? "").trim();
    if (reason.length < 3) validation({ reason: "A reason is required." });
    d!.status = "REVOKED";
    d!.revokedAt = nowIso();
    for (const s of req.db.sessions.filter((x) => x.deviceId === d!.id && x.state !== "STOPPED")) {
      tick(req.db, s);
      s.state = "STOPPED";
      s.endedAt = nowIso();
    }
    audit(req, "device.revoke", "Device", d!.id, { reason });
    return d;
  }),
];
