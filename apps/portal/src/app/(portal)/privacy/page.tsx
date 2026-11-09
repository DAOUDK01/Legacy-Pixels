"use client";

import { CheckCircle2, CircleSlash, Eye, FileWarning, Hand, ShieldCheck, Trash2 } from "lucide-react";
import type { PolicyVersion } from "@/lib/types";
import { useApiMutation, useApiQuery } from "@/lib/api/hooks";
import { fmtDate } from "@/lib/time";
import { Badge, Button, ButtonLink, Card, CardBody, CardHeader, InlineError, Notice, PageHeader, QueryState } from "@/components/ui";
import { StateBadge } from "@/components/domain";
import { useToast } from "@/components/ui/toast";
import { formError } from "@/components/workforce/common";

interface NoticeData {
  monitoring?: PolicyVersion;
  pendingMonitoring?: PolicyVersion;
  retention?: PolicyVersion;
  acknowledged: boolean;
  acknowledgedAt?: string;
  isEmployee: boolean;
  organization: string;
}

export default function PrivacyPage() {
  const q = useApiQuery<NoticeData>("/privacy/notice");
  const toast = useToast();
  const ack = useApiMutation("POST", "/tracking/me/acknowledge", { invalidate: ["/privacy", "/tracking"], onSuccess: () => toast({ tone: "success", title: "Acknowledgement recorded" }) });
  return (
    <>
      <PageHeader title="Workforce privacy notice" description="What the portal and desktop agent collect, why, who can see it, how long it's kept and what you can do about it." />
      <QueryState query={q} rows={10}>
        {(d) => {
          const m = d.monitoring?.config ?? {};
          const r = d.retention?.config ?? {};
          return (
            <div className="grid gap-6 xl:grid-cols-3">
              <div className="space-y-6 xl:col-span-2">
                <Card>
                  <CardHeader title="Purpose" />
                  <CardBody className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
                    <p>{d.organization} uses authorized activity tracking to support review of assigned work, attendance reconciliation and coaching. Tracking runs only during sessions you start in the employee-visible desktop agent, inside an authorized attendance interval.</p>
                    <p>Productivity scores support coaching and review. They never calculate wages directly or trigger automatic penalties, and missing monitoring data never by itself authorizes a pay deduction.</p>
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="What is collected" description={d.monitoring ? `Monitoring policy v${d.monitoring.version}, effective ${fmtDate(d.monitoring.effectiveFrom)}` : "No approved monitoring policy — collection is disabled."} />
                  <CardBody className="grid gap-6 text-sm sm:grid-cols-2">
                    <ul className="space-y-2">
                      {[
                        "Session start, pause, resume and stop times",
                        "Foreground application executable name and signed publisher",
                        `Browser domain only, from managed browsers (${m.domainOnly ? "paths and queries stripped" : "per policy"})`,
                        `Idle timing after ${String(m.idleThresholdMinutes ?? 5)} minutes without input — not the input itself`,
                        m.screenshotsEnabled === false ? "Screenshots: disabled" : `Screenshots every ${String(m.screenshotCadenceMinutes ?? 10)} minutes while active, with a visible countdown`,
                        "Attendance check-in/out and breaks you record",
                      ].map((x) => <li key={x} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{x}</li>)}
                    </ul>
                    <ul className="space-y-2 text-slate-600 dark:text-slate-400">
                      {[
                        "Keystrokes, typed text, clipboard or passwords",
                        "Message or chat contents",
                        "Microphone, webcam or continuous screen video",
                        "Incognito/private browsing, browsing history or URL paths",
                        "Anything while paused, stopped, locked, asleep or logged out",
                        "Mobile devices (out of scope)",
                      ].map((x) => <li key={x} className="flex gap-2"><CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />{x}</li>)}
                    </ul>
                  </CardBody>
                  <CardBody className="border-t border-slate-100 text-xs text-slate-500 dark:border-slate-800">
                    Excluded applications (such as password managers) suppress capture entirely; only a marker that a capture was skipped is kept. Local masking is best effort and can't guarantee removal of every sensitive pixel — pause before sensitive activity. If the agent is offline it may continue for at most {String(m.offlineAllowanceMinutes ?? 15)} minutes from the last authorization, then stops visibly.
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="Who can see it" />
                  <CardBody className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
                    <p><strong>You</strong> can see all of your own sessions, activity summaries, idle intervals and screenshots.</p>
                    <p><strong>Your manager</strong> sees team summaries (durations and coverage). Opening a screenshot requires a separate evidence permission and a recorded reason.</p>
                    <p><strong>Administrators</strong> do not automatically see screenshots, salaries or HR documents. Every evidence read is audited.</p>
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="Retention" description={d.retention ? `${d.retention.title}` : undefined} actions={d.retention && <StateBadge state={d.retention.status} />} />
                  <CardBody className="space-y-3 text-sm">
                    {d.retention?.status !== "APPROVED" && <Notice tone="amber">These retention periods are proposed and not yet approved. Production release is blocked until the owner approves them.</Notice>}
                    <ul className="grid gap-3 sm:grid-cols-3">
                      <li className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"><p className="text-xs text-slate-500">Screenshots</p><p className="text-lg font-semibold">{String(r.screenshotsDays ?? 30)} days</p></li>
                      <li className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"><p className="text-xs text-slate-500">Raw app/domain/idle events</p><p className="text-lg font-semibold">{String(r.rawEventsDays ?? 90)} days</p></li>
                      <li className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"><p className="text-xs text-slate-500">Temporary exports</p><p className="text-lg font-semibold">{String(r.exportsHours ?? 24)} hours</p></li>
                    </ul>
                    <p className="text-xs text-slate-500">Approved attendance and payroll records follow the approved records schedule. Acknowledged local data on your device is deleted within 24 hours of upload.</p>
                  </CardBody>
                </Card>
              </div>
              <div className="space-y-6">
                {d.isEmployee && (
                  <Card>
                    <CardHeader title="Your acknowledgement" />
                    <CardBody className="space-y-3 text-sm">
                      {d.acknowledged ? (
                        <p className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-600" />Acknowledged v{d.monitoring?.version}{d.acknowledgedAt ? ` on ${fmtDate(d.acknowledgedAt)}` : ""}</p>
                      ) : d.monitoring ? (
                        <>
                          <p>You haven't acknowledged monitoring policy v{d.monitoring.version}. Sessions can't start until you do.</p>
                          <Button loading={ack.isPending} onClick={() => ack.mutate({ body: { version: d.monitoring!.version } })}>Acknowledge v{d.monitoring.version}</Button>
                          {formError(ack.error) && <InlineError message={formError(ack.error)!} />}
                        </>
                      ) : <p>No policy to acknowledge.</p>}
                      <p className="text-xs text-slate-500">Acknowledgement confirms you received this notice. It isn't asserted to satisfy any law on its own.</p>
                      {d.pendingMonitoring && <Badge tone="amber">v{d.pendingMonitoring.version} proposed — new acknowledgement will be required</Badge>}
                    </CardBody>
                  </Card>
                )}
                <Card>
                  <CardHeader title="Your rights and controls" />
                  <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                    <li className="flex gap-3 px-5 py-3"><Hand className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /><span><strong>Pause or stop</strong> any time from the agent tray. Collection stops immediately.</span></li>
                    <li className="flex gap-3 px-5 py-3"><Eye className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /><span><strong>See your evidence</strong> — sessions, activity and screenshots — on the Tracking page.</span></li>
                    <li className="flex gap-3 px-5 py-3"><FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /><span><strong>Dispute</strong> score inputs within the dispute window and label idle time as meetings or offline work.</span></li>
                    <li className="flex gap-3 px-5 py-3"><Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /><span><strong>Request restriction or deletion</strong> of a capture. Access is restricted immediately while the privacy reviewer decides.</span></li>
                  </ul>
                  {d.isEmployee && <CardBody className="border-t border-slate-100 dark:border-slate-800"><ButtonLink href="/tracking" className="w-full justify-center">Open my tracking</ButtonLink></CardBody>}
                </Card>
              </div>
            </div>
          );
        }}
      </QueryState>
    </>
  );
}
