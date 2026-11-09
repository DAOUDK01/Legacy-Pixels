"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Camera, CheckCircle2, CircleSlash, Clock, KeyRound, Laptop, Pause, Play, ShieldCheck, Square, Upload, Users, WifiOff, XCircle,
} from "lucide-react";
import { useApiMutation, useApiQuery, useMe } from "@/lib/api/hooks";
import type { SessionRow, TrackingMe } from "@/lib/api/monitoring";
import type { DashboardData } from "@/mock/handlers/identity";
import { can, scopeOf } from "@/lib/rbac";
import { fmtDate, fmtDateTime, fmtMinutes, fmtTime, relativeTime } from "@/lib/time";
import {
  Badge, Button, ButtonLink, Card, CardBody, CardHeader, Dialog, EmptyState, Field, InlineError, Notice, PageHeader, QueryState, Select,
  Table, TBody, TD, TH, THead, TR, cn,
} from "@/components/ui";
import { StateBadge } from "@/components/domain";
import { useToast } from "@/components/ui/toast";
import { SessionBar } from "@/components/tracking/parts";
import { formError } from "@/components/workforce/common";

export default function TrackingPage() {
  const me = useMe();
  const teamView = !!me.data && ["team", "organization"].includes(scopeOf(me.data, "monitoring.summary.read") ?? "");
  if (me.data && !me.data.employee) {
    return (
      <>
        <PageHeader title="Tracking" />
        {teamView ? <Card><EmptyState title="No personal tracking" description="You don't have an employee record. Use the team view for summaries." action={<ButtonLink href="/tracking/team">Team tracking</ButtonLink>} /></Card> : <Card><EmptyState title="Not available" /></Card>}
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Authorized tracking"
        description="Tracking only runs during sessions you start in the Legacy Pixels desktop agent. You can see everything it collects, pause at any time, label idle time and dispute what looks wrong."
        actions={
          <>
            <ButtonLink href="/privacy" icon={<ShieldCheck className="h-4 w-4" />}>Privacy notice</ButtonLink>
            {teamView && <ButtonLink href="/tracking/team" variant="primary" icon={<Users className="h-4 w-4" />}>Team tracking</ButtonLink>}
          </>
        }
      />
      <MyTracking />
    </>
  );
}

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

const TRAY: Record<string, { label: string; dot: string; text: string }> = {
  ACTIVE: { label: "Tracking active", dot: "bg-emerald-500 animate-pulse", text: "Collection is on: app and domain durations, idle timing and scheduled screenshots." },
  IDLE: { label: "Idle detected", dot: "bg-amber-500", text: "No input for the idle threshold. This is a candidate idle interval you can label — no input doesn't mean no work." },
  PAUSED: { label: "Paused", dot: "bg-slate-400", text: "Nothing new is collected while paused. Pending capture buffers were cleared." },
  STARTING: { label: "Starting", dot: "bg-blue-500", text: "Waiting for the server to authorize the session." },
  NONE: { label: "Not tracking", dot: "bg-slate-300", text: "No session is running, so nothing is being collected." },
};

function MyTracking() {
  const q = useApiQuery<TrackingMe>("/tracking/me", undefined, { refetchInterval: 30_000 });
  const sessions = useApiQuery<SessionRow[]>("/tracking/sessions");
  const me = useMe();
  const tz = me.data?.organization.timezone;
  return (
    <QueryState query={q} rows={8}>
      {(d) => (
        <div className="space-y-6">
          {!d.acknowledged && d.policy && <AckBanner policyVersion={d.policy.version} title={d.policy.title} summary={d.policy.summary} />}
          {d.pendingPolicy && (
            <Notice tone="blue" title={`Proposed: ${d.pendingPolicy.title}`}>
              {d.pendingPolicy.summary} If approved, you'll be asked to acknowledge it before your next session. Collection scope never changes without a new acknowledgement.
            </Notice>
          )}
          <div className="grid gap-6 xl:grid-cols-3">
            <div className="xl:col-span-2"><SessionPanel data={d} /></div>
            <WhatWeCollect data={d} />
          </div>
          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Session history" description="Last two weeks. Each bar is the full session: active, idle, paused and unknown never overlap." />
              <QueryState query={sessions} empty={(s) => s.length === 0} emptyTitle="No sessions yet">
                {(rows) => (
                  <Table>
                    <THead><tr><TH>Started</TH><TH>Device</TH><TH>Span</TH><TH className="w-[30%]">Breakdown</TH><TH>Gaps</TH><TH>State</TH></tr></THead>
                    <TBody>
                      {rows.map((s) => {
                        const span = s.activeMinutes + s.idleMinutes + s.pausedMinutes + s.unknownMinutes;
                        return (
                          <TR key={s.id}>
                            <TD className="whitespace-nowrap"><Link href={`/tracking/sessions/${s.id}`} className="font-medium hover:text-brand-700 hover:underline">{fmtDate(s.startedAt)}</Link><span className="block text-xs text-slate-500">{fmtTime(s.startedAt, tz)}–{s.endedAt ? fmtTime(s.endedAt, tz) : "now"}</span></TD>
                            <TD className="text-xs">{s.deviceHostname}</TD>
                            <TD className="tabular-nums">{fmtMinutes(span)}</TD>
                            <TD><SessionBar s={s} /><span className="mt-1 block text-[11px] text-slate-500">{fmtMinutes(s.activeMinutes)} active · {fmtMinutes(s.idleMinutes)} idle</span></TD>
                            <TD>{s.gapCount ? <Badge tone="amber">{s.gapCount} unknown</Badge> : <span className="text-xs text-slate-400">None</span>}</TD>
                            <TD><StateBadge state={s.state} /></TD>
                          </TR>
                        );
                      })}
                    </TBody>
                  </Table>
                )}
              </QueryState>
            </Card>
            <Devices data={d} />
          </div>
        </div>
      )}
    </QueryState>
  );
}

function AckBanner({ policyVersion, title, summary }: { policyVersion: number; title: string; summary: string }) {
  const toast = useToast();
  const m = useApiMutation("POST", "/tracking/me/acknowledge", { invalidate: ["/tracking"], onSuccess: () => toast({ tone: "success", title: "Policy acknowledged" }) });
  return (
    <Notice tone="amber" title={`Please review: ${title}`} icon={<ShieldCheck className="h-5 w-5" />}>
      <p>{summary}</p>
      <p className="mt-1">Sessions can't start until you acknowledge the current policy. Acknowledging confirms you've read the notice; it isn't a legal waiver.</p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" loading={m.isPending} onClick={() => m.mutate({ body: { version: policyVersion } })}>I've read and acknowledge v{policyVersion}</Button>
        <ButtonLink size="sm" href="/privacy">Read full notice</ButtonLink>
      </div>
      {formError(m.error) && <div className="mt-2"><InlineError message={formError(m.error)!} /></div>}
    </Notice>
  );
}

function SessionPanel({ data }: { data: TrackingMe }) {
  const now = useNow();
  const toast = useToast();
  const s = data.current;
  const state = s?.state ?? "NONE";
  const tray = TRAY[state];
  const cadence = Number(data.policy?.config.screenshotCadenceMinutes ?? 10);
  const screenshotsOn = data.policy?.config.screenshotsEnabled !== false;
  const offlineAllowance = Number(data.policy?.config.offlineAllowanceMinutes ?? 15);
  const lease = Number(data.policy?.config.leaseMinutes ?? 5);
  const [starting, setStarting] = useState(false);
  const control = useApiMutation<SessionRow>("POST", "/tracking/sessions/x/control", {
    invalidate: ["/tracking", "/dashboard"],
    onSuccess: (r) => toast({ tone: "success", title: r.state === "STOPPED" ? "Session stopped" : r.state === "PAUSED" ? "Tracking paused" : "Tracking active" }),
  });
  const act = (action: "pause" | "resume" | "stop") => control.mutate({ path: `/tracking/sessions/${s!.id}/control`, body: { action } });

  const elapsedSec = s ? Math.max(0, Math.floor((now - new Date(s.startedAt).getTime()) / 1000)) : 0;
  const activeSec = s ? s.activeMinutes * 60 + (state === "ACTIVE" ? elapsedSec % 60 : 0) : 0;
  const nextShotSec = cadence * 60 - (activeSec % (cadence * 60));
  const hms = (sec: number) => `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

  return (
    <Card>
      <CardHeader title="Desktop agent session" description="This mirrors the tray indicator and session panel in the Windows agent." />
      <CardBody className="space-y-5">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-2.5 rounded-full border border-slate-200 px-3 py-1.5 dark:border-slate-700">
            <span className={cn("h-3 w-3 rounded-full", tray.dot)} aria-hidden />
            <span className="text-sm font-semibold">{tray.label}</span>
            {s?.offline && <Badge tone="amber"><WifiOff className="h-3 w-3" />Offline</Badge>}
          </span>
          {s && <span className="font-mono text-2xl tabular-nums text-slate-900 dark:text-white" aria-label="Session duration">{hms(elapsedSec)}</span>}
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400">{tray.text}</p>

        {s ? (
          <>
            <dl className="grid gap-4 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-slate-500">Working on</dt><dd className="mt-0.5 font-medium">{s.taskTitle ? <Link className="hover:underline" href={`/tasks/${s.taskId}`}>{s.taskTitle}</Link> : "No task selected"}</dd></div>
              <div><dt className="text-xs text-slate-500">Next screenshot</dt><dd className="mt-0.5 flex items-center gap-1.5 font-medium tabular-nums">{!screenshotsOn ? "Disabled" : state === "ACTIVE" ? <><Camera className="h-3.5 w-3.5 text-slate-400" />in {Math.floor(nextShotSec / 60)}:{String(nextShotSec % 60).padStart(2, "0")}</> : "None while paused"}</dd></div>
              <div><dt className="text-xs text-slate-500">Upload queue</dt><dd className="mt-0.5 flex items-center gap-1.5 font-medium"><Upload className="h-3.5 w-3.5 text-slate-400" />{s.pendingUploads ? `${s.pendingUploads} pending` : "All uploaded"}</dd></div>
              <div><dt className="text-xs text-slate-500">Authorization lease</dt><dd className="mt-0.5 font-medium">{state === "PAUSED" ? "Held" : `renews ${relativeTime(s.authorizationExpiresAt)}`}</dd></div>
            </dl>
            <SessionBar s={s} showLegend />
            <div className="flex flex-wrap gap-2">
              {(state === "ACTIVE" || state === "IDLE") && <Button variant="outline" icon={<Pause className="h-4 w-4" />} loading={control.isPending} onClick={() => act("pause")}>Pause</Button>}
              {state === "PAUSED" && <Button icon={<Play className="h-4 w-4" />} loading={control.isPending} onClick={() => act("resume")}>Resume</Button>}
              <Button variant="danger" icon={<Square className="h-4 w-4" />} disabled={control.isPending} onClick={() => act("stop")}>Stop session</Button>
              <ButtonLink href={`/tracking/sessions/${s.id}`} variant="ghost">Open session</ButtonLink>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <ul className="space-y-1.5 text-sm">
              <Precondition ok={data.devices.some((d) => d.status === "ACTIVE")} label="An enrolled, active device" />
              <Precondition ok={data.acknowledged} label="Current monitoring policy acknowledged" />
              <Precondition ok={data.checkedIn} label="Checked in (tracking only runs inside an attendance interval)" />
            </ul>
            <Button icon={<Play className="h-4 w-4" />} onClick={() => setStarting(true)} disabled={!data.acknowledged || !data.checkedIn || !data.devices.some((d) => d.status === "ACTIVE")}>Start session (simulate agent)</Button>
            <p className="text-xs text-slate-500">In production you start sessions from the desktop agent. Nothing starts automatically at boot.</p>
          </div>
        )}
        {formError(control.error) && <InlineError message={formError(control.error)!} />}
        <Notice tone="slate" icon={<Clock className="h-4 w-4" />}>
          The agent renews its authorization every minute (lease {lease} min). If it loses connection, it may keep collecting for at most {offlineAllowance} minutes from the last successful authorization, then stops visibly. Locking, sleeping, switching users or logging out stops collection; resuming needs your confirmation.
        </Notice>
      </CardBody>
      {starting && <StartDialog onClose={() => setStarting(false)} />}
    </Card>
  );
}

function Precondition({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-500" />}
      <span className={ok ? "" : "text-slate-600"}>{label}</span>
    </li>
  );
}

function StartDialog({ onClose }: { onClose: () => void }) {
  const dash = useApiQuery<DashboardData>("/dashboard");
  const [taskId, setTaskId] = useState("");
  const toast = useToast();
  const m = useApiMutation("POST", "/tracking/sessions/new/control", {
    invalidate: ["/tracking", "/dashboard"],
    onSuccess: () => { toast({ tone: "success", title: "Session started" }); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} title="Start tracking session" description="Starting a session does not change your task states." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate({ body: { action: "start", taskId: taskId || undefined } })}>Start</Button></>}>
      <div className="space-y-4">
        <Field label="Task (optional)" htmlFor="st-task">
          <Select id="st-task" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">No specific task</option>
            {dash.data?.myTasks.items.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </Select>
        </Field>
        {formError(m.error) && <InlineError message={formError(m.error)!} />}
      </div>
    </Dialog>
  );
}

function WhatWeCollect({ data }: { data: TrackingMe }) {
  const cfg = data.policy?.config ?? {};
  return (
    <Card>
      <CardHeader title="What's collected" description={data.policy ? `Policy v${data.policy.version}${data.acknowledgedAt ? ` · acknowledged ${fmtDate(data.acknowledgedAt)}` : ""}` : "No approved policy"} />
      <CardBody className="space-y-4 text-sm">
        <ul className="space-y-1.5">
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />Foreground app name and duration</li>
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{cfg.domainOnly ? "Browser domain only (managed browsers)" : "Browser domain"}</li>
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />Idle timing after {String(cfg.idleThresholdMinutes ?? 5)} min without input</li>
          {cfg.screenshotsEnabled !== false && <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />Screenshot every {String(cfg.screenshotCadenceMinutes ?? 10)} min while active, with a visible countdown</li>}
        </ul>
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Never collected</p>
          <ul className="space-y-1.5 text-slate-600 dark:text-slate-400">
            {["Keystrokes or typed text", "Clipboard, passwords, message contents", "Microphone, webcam or continuous video", "Private/incognito browsing, URL paths or queries", "Anything while paused, stopped or locked"].map((x) => (
              <li key={x} className="flex gap-2"><CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />{x}</li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-slate-500">Excluded apps (e.g. password managers) suppress capture entirely; the system keeps only a marker that a capture was skipped. Masking is best effort — pause before sensitive activity.</p>
      </CardBody>
    </Card>
  );
}

function Devices({ data }: { data: TrackingMe }) {
  const toast = useToast();
  const m = useApiMutation<{ code: string; expiresAt: string }>("POST", "/agent/enroll-code", {
    invalidate: ["/tracking/me"],
    onSuccess: () => toast({ tone: "success", title: "Enrollment code ready", body: "Enter it in the desktop agent within 10 minutes." }),
  });
  const now = useNow();
  const code = data.enrollmentCode;
  const left = code ? Math.max(0, Math.floor((new Date(code.expiresAt).getTime() - now) / 1000)) : 0;
  return (
    <Card>
      <CardHeader title="My devices" description="Device access never replaces your own authorization." />
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {data.devices.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">No devices enrolled.</li>}
        {data.devices.map((d) => (
          <li key={d.id} className="flex items-start justify-between gap-3 px-5 py-3">
            <span className="flex items-start gap-2.5">
              <Laptop className="mt-0.5 h-4 w-4 text-slate-400" />
              <span>
                <span className="block text-sm font-medium">{d.hostname}</span>
                <span className="block text-xs text-slate-500">Agent {d.agentVersion} · policy v{d.policyVersion}{d.lastSeen ? ` · seen ${relativeTime(d.lastSeen)}` : ""}</span>
              </span>
            </span>
            <StateBadge state={d.status} />
          </li>
        ))}
      </ul>
      <CardBody className="border-t border-slate-100 dark:border-slate-800">
        {code && left > 0 ? (
          <div className="rounded-lg bg-slate-50 p-4 text-center dark:bg-slate-800">
            <p className="text-xs text-slate-500">Enrollment code (single use)</p>
            <p className="my-1 font-mono text-2xl font-semibold tracking-widest">{code.code}</p>
            <p className="text-xs text-slate-500">Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} · {fmtDateTime(code.expiresAt)}</p>
          </div>
        ) : (
          <Button variant="outline" className="w-full justify-center" icon={<KeyRound className="h-4 w-4" />} loading={m.isPending} onClick={() => m.mutate()}>Get enrollment code</Button>
        )}
        {formError(m.error) && <div className="mt-2"><InlineError message={formError(m.error)!} /></div>}
        <p className="mt-2 text-xs text-slate-500">The agent creates its own key pair; you'll confirm the policy version before the device is bound to you.</p>
      </CardBody>
    </Card>
  );
}
