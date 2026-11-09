"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
import { useApiQuery, useMe } from "@/lib/api/hooks";
import { api, ApiError, errorMessage } from "@/lib/api/transport";
import type { WorkLogList, WorkLogRow } from "@/lib/api/work";
import { businessDate, fmtDate, fmtMinutes } from "@/lib/time";
import {
  Button, Card, CardBody, CardHeader, ConfirmDialog, Field, InlineError, Input, PageHeader, QueryState, Select, Table, TBody, TD, TH, THead, TR, Tabs,
} from "@/components/ui";
import { Person, StateBadge, humanize } from "@/components/domain";
import { useToast } from "@/components/ui/toast";

export default function WorkLogsPage() {
  const me = useMe();
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const [status, setStatus] = useState("");
  const q = useApiQuery<WorkLogList>("/worklogs", { scope, status: status || undefined });
  const canReview = q.data?.canReview ?? false;
  useEffect(() => {
    if (me.data && !me.data.employee) setScope("team");
  }, [me.data]);

  return (
    <>
      <PageHeader title="Work logs" description="Daily logs identify task, date, duration and description. They reconcile to attendance and feed work-log accuracy; missing required logs count as zero for that day." />
      <Card>
        <Tabs
          className="px-3"
          value={scope}
          onChange={setScope}
          tabs={[...(me.data?.employee ? [{ value: "mine" as const, label: "My logs" }] : []), ...(canReview || scope === "team" ? [{ value: "team" as const, label: "Team review" }] : [])]}
        />
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <Field label="Status" htmlFor="wl-status" className="w-40">
            <Select id="wl-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="SUBMITTED">Submitted</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </Select>
          </Field>
        </div>
        {scope === "mine" && q.data && <NewLog data={q.data} tz={me.data?.organization.timezone} />}
        <QueryState query={q} empty={(d) => d.items.length === 0} emptyTitle="No work logs" emptyDescription={scope === "mine" ? "Log time against your assigned tasks above." : "Nothing to review."}>
          {(d) => <LogTable rows={d.items} team={scope === "team"} />}
        </QueryState>
      </Card>
    </>
  );
}

function NewLog({ data, tz }: { data: WorkLogList; tz?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ taskId: "", date: businessDate(new Date(), tz), minutes: "", source: "MANUAL", description: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (!data.assignable.length) return null;
  const add = async () => {
    if (!f.taskId) return setErrors({ taskId: "Choose a task." });
    setBusy(true);
    setErrors({});
    try {
      await api.post(`/tasks/${f.taskId}/work-logs`, { businessDate: f.date, durationMinutes: Number(f.minutes), description: f.description, source: f.source });
      toast({ tone: "success", title: "Work logged" });
      setF({ ...f, minutes: "", description: "" });
      qc.invalidateQueries({ queryKey: ["/worklogs"] });
    } catch (e) {
      setErrors(e instanceof ApiError && e.body.fieldErrors ? e.body.fieldErrors : { form: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <CardBody className="grid gap-3 border-b border-slate-100 sm:grid-cols-6 dark:border-slate-800">
      <Field label="Task" htmlFor="nl-task" error={errors.taskId} className="sm:col-span-2">
        <Select id="nl-task" value={f.taskId} onChange={(e) => setF({ ...f, taskId: e.target.value })}>
          <option value="">Choose…</option>
          {data.assignable.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </Select>
      </Field>
      <Field label="Date" htmlFor="nl-date" error={errors.businessDate}><Input id="nl-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label="Minutes" htmlFor="nl-min" error={errors.durationMinutes}><Input id="nl-min" type="number" min={5} max={720} value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} /></Field>
      <Field label="Type" htmlFor="nl-src" className="sm:col-span-2">
        <Select id="nl-src" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
          <option value="MANUAL">Work</option>
          <option value="MEETING">Meeting</option>
          <option value="OFFLINE_WORK">Offline work (needs manager approval)</option>
        </Select>
      </Field>
      <Field label="Description" htmlFor="nl-desc" error={errors.description} className="sm:col-span-5"><Input id="nl-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="flex items-end"><Button className="w-full" icon={<Plus className="h-4 w-4" />} loading={busy} onClick={add}>Log work</Button></div>
      {errors.form && <div className="sm:col-span-6"><InlineError message={errors.form} /></div>}
    </CardBody>
  );
}

function LogTable({ rows, team }: { rows: WorkLogRow[]; team: boolean }) {
  const [decide, setDecide] = useState<{ log: WorkLogRow; decision: "APPROVE" | "REJECT" } | null>(null);
  const byDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.status !== "REJECTED") m.set(`${r.employeeId}|${r.businessDate}`, (m.get(`${r.employeeId}|${r.businessDate}`) ?? 0) + r.durationMinutes);
    return m;
  }, [rows]);
  return (
    <>
      <Table>
        <THead>
          <tr><TH>Date</TH>{team && <TH>Employee</TH>}<TH>Task</TH><TH>Type</TH><TH className="text-right">Logged</TH><TH className="text-right">Day total</TH><TH>Description</TH><TH>Status</TH>{team && <TH />}</tr>
        </THead>
        <TBody>
          {rows.map((w) => (
            <TR key={w.id}>
              <TD className="whitespace-nowrap">{fmtDate(w.businessDate)}</TD>
              {team && <TD><Person id={w.employeeId} size={20} /></TD>}
              <TD><Link href={`/tasks/${w.taskId}`} className="hover:underline">{w.taskTitle}</Link></TD>
              <TD>{humanize(w.source)}</TD>
              <TD className="text-right tabular-nums">
                {fmtMinutes(w.durationMinutes)}
                {w.approvedMinutes !== undefined && w.approvedMinutes !== w.durationMinutes && <span className="block text-xs text-slate-500">approved {fmtMinutes(w.approvedMinutes)}</span>}
              </TD>
              <TD className="text-right tabular-nums text-slate-500">{fmtMinutes(byDay.get(`${w.employeeId}|${w.businessDate}`) ?? 0)}</TD>
              <TD className="max-w-xs truncate" >{w.description}</TD>
              <TD><StateBadge state={w.status} /></TD>
              {team && (
                <TD className="text-right">
                  {w.status === "SUBMITTED" && (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" icon={<Check className="h-4 w-4" />} onClick={() => setDecide({ log: w, decision: "APPROVE" })}>Approve</Button>
                      <Button size="sm" variant="ghost" icon={<X className="h-4 w-4" />} onClick={() => setDecide({ log: w, decision: "REJECT" })}>Reject</Button>
                    </div>
                  )}
                </TD>
              )}
            </TR>
          ))}
        </TBody>
      </Table>
      {decide && <DecisionDialog {...decide} onClose={() => setDecide(null)} />}
    </>
  );
}

function DecisionDialog({ log, decision, onClose }: { log: WorkLogRow; decision: "APPROVE" | "REJECT"; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [minutes, setMinutes] = useState(String(log.durationMinutes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={decision === "APPROVE" ? "Approve work log" : "Reject work log"}
      description={`${log.taskTitle} · ${fmtDate(log.businessDate)} · ${fmtMinutes(log.durationMinutes)}`}
      confirmLabel={decision === "APPROVE" ? "Approve" : "Reject"}
      tone={decision === "APPROVE" ? "success" : "danger"}
      requireReason={decision === "REJECT"}
      loading={busy}
      error={error}
      onConfirm={async (reason) => {
        setBusy(true);
        setError(null);
        try {
          await api.post(`/worklogs/${log.id}/decision`, { decision, approvedMinutes: decision === "APPROVE" ? Number(minutes) : undefined, reason: reason || undefined });
          toast({ tone: "success", title: decision === "APPROVE" ? "Work log approved" : "Work log rejected" });
          qc.invalidateQueries({ queryKey: ["/worklogs"] });
          onClose();
        } catch (e) {
          setError(errorMessage(e));
          setBusy(false);
        }
      }}
    >
      {decision === "APPROVE" && (
        <Field label="Approved minutes" htmlFor="wd-min" hint="Approve less than logged when it doesn't reconcile with attendance.">
          <Input id="wd-min" type="number" min={0} max={log.durationMinutes} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </Field>
      )}
    </ConfirmDialog>
  );
}
