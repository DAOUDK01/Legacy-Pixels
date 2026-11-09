"use client";

import { use, useState } from "react";
import { AlertTriangle, Lock, Tag } from "lucide-react";
import { useApiMutation, useApiQuery, useMe } from "@/lib/api/hooks";
import type { SessionDetail } from "@/lib/api/monitoring";
import type { IdleLabelRequest } from "@/lib/types";
import { fmtDate, fmtDateTime, fmtMinutes, fmtTime } from "@/lib/time";
import {
  Badge, Button, Card, CardBody, CardHeader, DL, Dialog, EmptyState, Field, InlineError, Notice, PageHeader, QueryState, Select, Textarea,
} from "@/components/ui";
import { Person, StateBadge, humanize } from "@/components/domain";
import { useToast } from "@/components/ui/toast";
import { ActivityBreakdown, EvidenceDialog, ScreenshotTile, SessionBar } from "@/components/tracking/parts";
import { fieldError, formError } from "@/components/workforce/common";

const GAP_TEXT: Record<string, string> = {
  HEARTBEAT_TIMEOUT: "The agent stopped reporting (heartbeat timeout).",
  SEQUENCE_GAP: "Events are missing from the device sequence.",
  CLOCK_SKEW: "The device clock disagreed with the server by more than 2 minutes.",
  SPOOL_FULL: "The local encrypted spool was full; screenshots stopped first.",
  LEASE_EXPIRED: "The offline authorization lease expired and collection stopped.",
};

export default function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useMe();
  const tz = me.data?.organization.timezone;
  const q = useApiQuery<SessionDetail>(`/tracking/sessions/${id}`);
  const [shot, setShot] = useState<string | null>(null);
  const [labeling, setLabeling] = useState<IdleLabelRequest | null>(null);

  return (
    <QueryState query={q} rows={8}>
      {(d) => {
        const s = d.session;
        const span = s.activeMinutes + s.idleMinutes + s.pausedMinutes + s.unknownMinutes;
        return (
          <>
            <PageHeader
              title={`Session · ${fmtDate(s.startedAt)}`}
              description={d.isOwn ? "Your session. You can label idle intervals and request restriction of any capture." : "Summary view. Images require the evidence capability and an audited access reason."}
              breadcrumbs={[{ label: "Tracking", href: d.isOwn ? "/tracking" : "/tracking/team" }, { label: "Session" }]}
              actions={<StateBadge state={s.state} />}
            />
            <div className="space-y-6">
              <Card>
                <CardBody className="space-y-5">
                  <DL cols={3} items={[
                    { label: "Employee", value: <Person id={s.employeeId} /> },
                    { label: "Device", value: s.deviceHostname ?? "—" },
                    { label: "Time", value: `${fmtTime(s.startedAt, tz)} – ${s.endedAt ? fmtTime(s.endedAt, tz) : "now"} (${fmtMinutes(span)})` },
                    { label: "Task", value: s.taskTitle ?? "None selected" },
                    { label: "Policy", value: `v${s.policyVersion}` },
                    { label: "Captures", value: `${s.screenshotCount} scheduled${s.pendingUploads ? ` · ${s.pendingUploads} pending upload` : ""}` },
                  ]} />
                  <SessionBar s={s} showLegend />
                </CardBody>
              </Card>
              <div className="grid gap-6 xl:grid-cols-3">
                <Card className="xl:col-span-2">
                  <CardHeader title="Activity" description={`Shares of ${fmtMinutes(s.activeMinutes)} active time. Overlapping intervals are never summed into more time than the session.`} />
                  <CardBody><ActivityBreakdown rows={d.activity} activeMinutes={s.activeMinutes} /></CardBody>
                </Card>
                <div className="space-y-6">
                  <Card>
                    <CardHeader title="Coverage gaps" description="Shown as unknown — never counted as working or idle." />
                    {d.gaps.length === 0 ? <CardBody><p className="text-sm text-slate-500">No gaps in this session.</p></CardBody> : (
                      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                        {d.gaps.map((g) => (
                          <li key={g.id} className="flex gap-2 px-5 py-3 text-sm">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                            <span><span className="font-medium">{fmtTime(g.start, tz)}–{fmtTime(g.end, tz)}</span><span className="block text-xs text-slate-500">{GAP_TEXT[g.reason] ?? humanize(g.reason)}</span></span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                  <Card>
                    <CardHeader title="Idle candidates" description="No input isn't the same as no work. Label meetings or offline work so reviewers see the context." />
                    {d.idle.length === 0 ? <CardBody><p className="text-sm text-slate-500">No idle intervals recorded.</p></CardBody> : (
                      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                        {d.idle.map((i) => (
                          <li key={i.id} className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
                            <span>
                              <span className="font-medium tabular-nums">{fmtTime(i.start, tz)}–{fmtTime(i.end, tz)}</span>
                              <span className="block text-xs text-slate-500">{i.label ? `${humanize(i.label)}${i.note ? ` — ${i.note}` : ""}` : "Unlabelled"}</span>
                            </span>
                            {d.isOwn && <Button size="sm" variant="ghost" icon={<Tag className="h-3.5 w-3.5" />} onClick={() => setLabeling(i)}>{i.label ? "Edit" : "Label"}</Button>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </div>
              </div>
              <Card>
                <CardHeader title="Screenshots" description={d.isOwn ? "Only you, and people granted evidence access with a recorded reason, can open these." : "Opening a capture requires an access reason and is audited."} />
                {!d.screenshotsVisible ? (
                  <EmptyState icon={<Lock className="h-6 w-6" />} title="Evidence access required" description="Your role can see session summaries but not screenshots. Evidence access is a separate, audited capability." />
                ) : d.screenshots.length === 0 ? (
                  <EmptyState title="No screenshots in this session" />
                ) : (
                  <CardBody>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                      {d.screenshots.map((x) => (
                        <ScreenshotTile key={x.id} id={x.id} captureAt={x.captureAt} suppressionReason={x.suppressionReason} restricted={x.restricted} timezone={tz} onOpen={() => setShot(x.id)} />
                      ))}
                    </div>
                    <p className="mt-3 text-xs text-slate-500">
                      {d.screenshots.filter((x) => x.suppressionReason).length} suppressed · {d.screenshots.filter((x) => x.restricted).length} restricted · retained per the approved retention policy (proposed 30 days).
                    </p>
                  </CardBody>
                )}
              </Card>
              {!d.isOwn && <Notice tone="slate">Scores and pay never use screenshot counts or mouse activity. Use this evidence for coaching conversations and disputes, not automatic decisions.</Notice>}
            </div>
            <EvidenceDialog screenshotId={shot} own={d.isOwn} onClose={() => setShot(null)} onRestrict={() => q.refetch()} />
            {labeling && <LabelDialog idle={labeling} onClose={() => setLabeling(null)} />}
          </>
        );
      }}
    </QueryState>
  );
}

function LabelDialog({ idle, onClose }: { idle: IdleLabelRequest; onClose: () => void }) {
  const toast = useToast();
  const [label, setLabel] = useState<string>(idle.label ?? "MEETING");
  const [note, setNote] = useState(idle.note ?? "");
  const m = useApiMutation("POST", `/tracking/idle/${idle.id}/label`, {
    invalidate: ["/tracking"],
    onSuccess: () => { toast({ tone: "success", title: "Idle interval labelled" }); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} title="Label idle interval" description={`${fmtDateTime(idle.start)} – ${fmtTime(idle.end)}`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate({ body: { label, note } })}>Save label</Button></>}>
      <div className="space-y-4">
        <Field label="What were you doing?" htmlFor="idle-label" error={fieldError(m.error, "label")}>
          <Select id="idle-label" value={label} onChange={(e) => setLabel(e.target.value)}>
            <option value="MEETING">Meeting or call</option>
            <option value="OFFLINE_WORK">Offline work (sketching, reading, planning)</option>
            <option value="BREAK">Break</option>
            <option value="OTHER">Other</option>
          </Select>
        </Field>
        <Field label="Note" htmlFor="idle-note" error={fieldError(m.error, "note")} hint="Optional unless you chose Other.">
          <Textarea id="idle-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </Field>
        <Badge tone="slate">Labels are reviewed by your manager; they don't change attendance automatically.</Badge>
        {formError(m.error) && <InlineError message={formError(m.error)!} />}
      </div>
    </Dialog>
  );
}
