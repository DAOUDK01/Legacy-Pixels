"use client";

import { useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { useApiQuery, useMe } from "@/lib/api/hooks";
import type { AttendanceResponse, CorrectionRow, TeamAttendanceRow } from "@/lib/api/workforce";
import type { DailyAttendance } from "@/lib/types";
import { can, scopeOf } from "@/lib/rbac";
import { addDays, businessDate, fmtDate, fmtDateTime, fmtMinutes, fmtTime } from "@/lib/time";
import {
  Badge, ButtonLink, Card, CardHeader, FilterBar, PageHeader, QueryState, Stat, Table, Tabs, TBody, TD, TH, THead, TR,
} from "@/components/ui";
import { Person, StateBadge } from "@/components/domain";
import { AttendanceToday } from "@/components/workforce/AttendanceToday";
import { DailyTable } from "@/components/workforce/DailyTable";
import { CorrectionDialog } from "@/components/workforce/CorrectionDialog";
import { DateRange, EmployeePicker } from "@/components/workforce/common";

export default function AttendancePage() {
  const me = useMe();
  const tz = me.data?.organization.timezone ?? "Asia/Karachi";
  const today = businessDate(new Date(), tz);
  const [from, setFrom] = useState(addDays(today, -13));
  const [to, setTo] = useState(today);
  const teamScope = me.data ? scopeOf(me.data, "attendance.read") : null;
  const hasTeam = teamScope === "team" || teamScope === "organization";
  const isEmployee = !!me.data?.employee;
  const [tab, setTab] = useState<"mine" | "team" | "person">(isEmployee ? "mine" : "team");
  const effectiveTab = !isEmployee && tab === "mine" ? "team" : tab;

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Scheduled shifts, check-ins, breaks and credited time. Missing records show as incomplete or unknown — never as an assumed full shift."
        actions={me.data && (can(me.data, "attendance.recommend") || can(me.data, "attendance.approve")) && <ButtonLink href="/attendance/approvals" icon={<ClipboardCheck className="h-4 w-4" />}>Correction approvals</ButtonLink>}
      />
      {hasTeam && (
        <Tabs
          className="mb-6"
          value={effectiveTab}
          onChange={setTab}
          tabs={[
            ...(isEmployee ? [{ value: "mine" as const, label: "My attendance" }] : []),
            { value: "team" as const, label: teamScope === "organization" ? "Organization" : "My team" },
            { value: "person" as const, label: "Employee detail" },
          ]}
        />
      )}
      {effectiveTab === "mine" && <MyAttendance from={from} to={to} setRange={(f, t) => { setFrom(f); setTo(t); }} />}
      {effectiveTab === "team" && <TeamAttendance from={from} to={to} setRange={(f, t) => { setFrom(f); setTo(t); }} tz={tz} />}
      {effectiveTab === "person" && <PersonAttendance from={from} to={to} setRange={(f, t) => { setFrom(f); setTo(t); }} selfId={me.data?.employee?.id} />}
    </>
  );
}

function MyAttendance({ from, to, setRange }: { from: string; to: string; setRange: (f: string, t: string) => void }) {
  const q = useApiQuery<AttendanceResponse>("/me/attendance", { from, to });
  const corrections = useApiQuery<CorrectionRow[]>("/attendance/corrections", { scope: "mine" });
  const [correcting, setCorrecting] = useState<DailyAttendance | null>(null);
  return (
    <QueryState query={q} rows={8}>
      {(d) => (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <AttendanceToday data={d.today} timezone={d.timezone} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Credited" value={fmtMinutes(d.totals.creditedMinutes)} hint={`of ${fmtMinutes(d.totals.scheduledMinutes)} eligible`} />
              <Stat label="Late days" value={d.totals.late} tone="amber" />
              <Stat label="Incomplete" value={d.totals.incomplete} hint="Needs correction" tone="amber" />
              <Stat label="Approved OT" value={fmtMinutes(d.totals.overtimeMinutes)} hint="Kept separate" />
            </div>
          </div>
          <Card>
            <CardHeader title="Daily summary" description={`All times ${d.timezone}. Tracked time comes from authorized agent sessions and is shown separately from attendance.`} />
            <FilterBar>
              <DateRange from={from} to={to} onChange={setRange} />
            </FilterBar>
            <DailyTable days={d.days} timezone={d.timezone} onCorrect={setCorrecting} />
          </Card>
          <Card>
            <CardHeader title="My correction requests" description="Proposed → manager validated → HR approved or rejected." />
            <QueryState query={corrections} empty={(c) => c.length === 0} emptyTitle="No correction requests">
              {(rows) => (
                <Table>
                  <THead><tr><TH>Day</TH><TH>Proposed</TH><TH>Reason</TH><TH>Status</TH><TH>Submitted</TH></tr></THead>
                  <TBody>
                    {rows.map((c) => (
                      <TR key={c.id}>
                        <TD>{fmtDate(c.businessDate)}</TD>
                        <TD className="text-xs">{c.proposedCheckIn && <>In {fmtTime(c.proposedCheckIn, d.timezone)} </>}{c.proposedCheckOut && <>Out {fmtTime(c.proposedCheckOut, d.timezone)}</>}</TD>
                        <TD className="max-w-xs text-xs">{c.reason}{c.decisionReason && <span className="block text-red-600">Decision: {c.decisionReason}</span>}</TD>
                        <TD><StateBadge state={c.status} />{c.affectsLockedPayroll && <Badge tone="purple" className="ml-1">Next-period adjustment</Badge>}</TD>
                        <TD className="text-xs text-slate-500">{fmtDateTime(c.createdAt, d.timezone)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </QueryState>
          </Card>
          <CorrectionDialog day={correcting} timezone={d.timezone} onClose={() => setCorrecting(null)} />
        </div>
      )}
    </QueryState>
  );
}

function TeamAttendance({ from, to, setRange, tz }: { from: string; to: string; setRange: (f: string, t: string) => void; tz: string }) {
  const q = useApiQuery<{ rows: TeamAttendanceRow[]; timezone: string }>("/attendance", { from, to });
  const today = businessDate(new Date(), tz);
  return (
    <Card>
      <CardHeader title="Team attendance" description="Totals for the selected range and each person's status today." />
      <FilterBar>
        <DateRange from={from} to={to} onChange={setRange} />
      </FilterBar>
      <QueryState query={q} empty={(d) => d.rows.length === 0} emptyTitle="No employees in scope">
        {(d) => (
          <Table>
            <THead>
              <tr>
                <TH>Employee</TH><TH>Today</TH><TH className="text-right">Eligible</TH><TH className="text-right">Credited</TH><TH className="text-right">Presence</TH>
                <TH className="text-right">Late</TH><TH className="text-right">Absent</TH><TH className="text-right">Incomplete</TH><TH className="text-right">OT</TH>
              </tr>
            </THead>
            <TBody>
              {d.rows.map((r) => {
                const t = r.days.find((x) => x.businessDate === today);
                const pct = r.totals.scheduledMinutes ? Math.round((r.totals.creditedMinutes / r.totals.scheduledMinutes) * 100) : null;
                return (
                  <TR key={r.employeeId}>
                    <TD><Person id={r.employeeId} showTitle /></TD>
                    <TD>{t ? <StateBadge state={t.status} /> : "—"}{t?.checkIn && <span className="ml-1.5 text-xs text-slate-500">in {fmtTime(t.checkIn, d.timezone)}</span>}</TD>
                    <TD className="text-right tabular-nums">{fmtMinutes(r.totals.scheduledMinutes)}</TD>
                    <TD className="text-right tabular-nums">{fmtMinutes(r.totals.creditedMinutes)}</TD>
                    <TD className="text-right tabular-nums">{pct === null ? "N/A" : `${pct}%`}</TD>
                    <TD className="text-right">{r.totals.late ? <Badge tone="amber">{r.totals.late}</Badge> : <span className="text-slate-400">0</span>}</TD>
                    <TD className="text-right">{r.totals.absent ? <Badge tone="red">{r.totals.absent}</Badge> : <span className="text-slate-400">0</span>}</TD>
                    <TD className="text-right">{r.totals.incomplete ? <Badge tone="amber">{r.totals.incomplete}</Badge> : <span className="text-slate-400">0</span>}</TD>
                    <TD className="text-right tabular-nums">{r.totals.overtimeMinutes ? fmtMinutes(r.totals.overtimeMinutes) : "—"}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </QueryState>
    </Card>
  );
}

function PersonAttendance({ from, to, setRange, selfId }: { from: string; to: string; setRange: (f: string, t: string) => void; selfId?: string }) {
  const [emp, setEmp] = useState("");
  const q = useApiQuery<AttendanceResponse>(emp ? "/attendance" : null, { employeeId: emp, from, to });
  return (
    <Card>
      <CardHeader title="Employee attendance detail" description="Read-only view. Corrections are proposed by the employee and decided in the approvals queue." />
      <FilterBar>
        <EmployeePicker value={emp} onChange={setEmp} allowAll="Select an employee…" includeSelf={false} selfId={selfId} />
        <DateRange from={from} to={to} onChange={setRange} />
      </FilterBar>
      {!emp ? (
        <p className="px-5 py-10 text-center text-sm text-slate-500">Choose an employee to see their daily attendance.</p>
      ) : (
        <QueryState query={q} rows={8}>
          {(d) => <DailyTable days={d.days} timezone={d.timezone} />}
        </QueryState>
      )}
    </Card>
  );
}
