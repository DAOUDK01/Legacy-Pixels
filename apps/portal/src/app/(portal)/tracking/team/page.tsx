"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock, ShieldCheck } from "lucide-react";
import { useApiQuery, useMe } from "@/lib/api/hooks";
import type { SessionRow, TeamTrackingRow } from "@/lib/api/monitoring";
import { addDays, businessDate, fmtDate, fmtMinutes, fmtTime, relativeTime } from "@/lib/time";
import {
  Badge, Button, Card, CardHeader, Dialog, FilterBar, Notice, PageHeader, QueryState, Table, TBody, TD, TH, THead, TR,
} from "@/components/ui";
import { Person, StateBadge } from "@/components/domain";
import { SessionBar } from "@/components/tracking/parts";
import { DateRange } from "@/components/workforce/common";

export default function TeamTrackingPage() {
  const me = useMe();
  const tz = me.data?.organization.timezone ?? "Asia/Karachi";
  const today = businessDate(new Date(), tz);
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const q = useApiQuery<{ rows: TeamTrackingRow[]; timezone: string; evidenceAccess: boolean }>("/tracking/team", { from, to });
  const [selected, setSelected] = useState<TeamTrackingRow | null>(null);

  return (
    <>
      <PageHeader
        title="Team tracking"
        description="Summaries of authorized sessions in your scope. Unknown coverage is shown separately and never treated as idle or as work."
        breadcrumbs={[{ label: "Tracking", href: "/tracking" }, { label: "Team" }]}
      />
      <QueryState query={q} rows={8}>
        {(d) => (
          <div className="space-y-6">
            <Notice tone={d.evidenceAccess ? "amber" : "slate"} icon={d.evidenceAccess ? <ShieldCheck className="h-5 w-5" /> : <Lock className="h-5 w-5" />}>
              {d.evidenceAccess
                ? "You hold monitoring evidence access. Every screenshot you open requires a reason and is recorded in the audit log the owner reviews."
                : "You can see durations and coverage only. Screenshots require a separate evidence capability."}
            </Notice>
            <Card>
              <CardHeader title="Sessions by employee" description={`${fmtDate(from)} – ${fmtDate(to)} · ${d.timezone}`} />
              <FilterBar>
                <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
              </FilterBar>
              {d.rows.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-slate-500">No employees in scope.</p>
              ) : (
                <Table>
                  <THead><tr><TH>Employee</TH><TH>Now</TH><TH className="text-right">Sessions</TH><TH className="w-[26%]">Breakdown</TH><TH className="text-right">Active</TH><TH className="text-right">Idle</TH><TH className="text-right">Coverage</TH><TH>Agent</TH><TH><span className="sr-only">Open</span></TH></tr></THead>
                  <TBody>
                    {d.rows.map((r) => (
                      <TR key={r.employeeId}>
                        <TD><Person id={r.employeeId} showTitle /></TD>
                        <TD>{r.liveState === "NONE" ? <span className="text-xs text-slate-400">Not tracking</span> : <StateBadge state={r.liveState} />}</TD>
                        <TD className="text-right tabular-nums">{r.sessions}</TD>
                        <TD>{r.sessions ? <SessionBar s={r} /> : <span className="text-xs text-slate-400">—</span>}</TD>
                        <TD className="text-right tabular-nums">{fmtMinutes(r.activeMinutes)}</TD>
                        <TD className="text-right tabular-nums">{fmtMinutes(r.idleMinutes)}</TD>
                        <TD className="text-right">{r.coveragePct === null ? <span className="text-slate-400">N/A</span> : <span className="tabular-nums">{r.coveragePct}%</span>}{r.gaps > 0 && <Badge tone="amber" className="ml-1">{r.gaps} gap{r.gaps > 1 ? "s" : ""}</Badge>}</TD>
                        <TD className="text-xs">{r.device ? <><StateBadge state={r.device.status} /><span className="mt-0.5 block text-slate-500">{r.device.hostname} · {r.device.agentVersion}{r.device.lastSeen ? ` · ${relativeTime(r.device.lastSeen)}` : ""}</span></> : <span className="text-slate-400">No device</span>}</TD>
                        <TD>{r.sessions > 0 && <Button size="sm" variant="ghost" onClick={() => setSelected(r)}>Sessions</Button>}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </Card>
          </div>
        )}
      </QueryState>
      {selected && <SessionsDialog row={selected} from={from} to={to} tz={tz} onClose={() => setSelected(null)} />}
    </>
  );
}

function SessionsDialog({ row, from, to, tz, onClose }: { row: TeamTrackingRow; from: string; to: string; tz: string; onClose: () => void }) {
  const q = useApiQuery<SessionRow[]>("/tracking/sessions", { employeeId: row.employeeId, from, to });
  return (
    <Dialog open onClose={onClose} size="xl" title={`${row.employeeName} — sessions`} description="Open a session for activity, gaps and (with evidence access) captures.">
      <QueryState query={q} empty={(s) => s.length === 0} emptyTitle="No sessions in range">
        {(rows) => (
          <Table>
            <THead><tr><TH>Date</TH><TH>Time</TH><TH className="w-[35%]">Breakdown</TH><TH>Gaps</TH><TH /></tr></THead>
            <TBody>
              {rows.map((s) => (
                <TR key={s.id}>
                  <TD>{fmtDate(s.startedAt)}</TD>
                  <TD className="text-xs">{fmtTime(s.startedAt, tz)}–{s.endedAt ? fmtTime(s.endedAt, tz) : "now"}</TD>
                  <TD><SessionBar s={s} /></TD>
                  <TD>{s.gapCount ? <Badge tone="amber">{s.gapCount}</Badge> : "—"}</TD>
                  <TD><Link className="text-sm font-medium text-brand-600 hover:underline" href={`/tracking/sessions/${s.id}`}>Open</Link></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </QueryState>
    </Dialog>
  );
}
