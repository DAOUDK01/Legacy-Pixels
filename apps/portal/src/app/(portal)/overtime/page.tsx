"use client";

import { useState } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { useApiMutation, useApiQuery, useMe } from "@/lib/api/hooks";
import type { OvertimeRow } from "@/lib/api/workforce";
import type { DashboardData } from "@/mock/handlers/identity";
import { can } from "@/lib/rbac";
import { businessDate, fmtDate, fmtMinutes, relativeTime } from "@/lib/time";
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, Dialog, Field, InlineError, Input, Notice, PageHeader, QueryState, Select, Table, Tabs, TBody, TD, TH, THead, TR, Textarea,
} from "@/components/ui";
import { Person, StateBadge, humanize } from "@/components/domain";
import { useToast } from "@/components/ui/toast";
import { fieldError, formError } from "@/components/workforce/common";

export default function OvertimePage() {
  const me = useMe();
  const isEmployee = !!me.data?.employee;
  const reviewer = !!me.data && (can(me.data, "overtime.recommend") || can(me.data, "overtime.validate") || can(me.data, "overtime.read"));
  const [tab, setTab] = useState<"mine" | "review">(isEmployee ? "mine" : "review");
  const effective = !isEmployee ? "review" : !reviewer ? "mine" : tab;
  const [requesting, setRequesting] = useState(false);

  return (
    <>
      <PageHeader
        title="Overtime"
        description="Approval to work and approval of actual payable minutes are separate. Actual minutes come from verified attendance, not screenshot counts. Unscheduled overtime is flagged for human review — never automatically declared unpaid."
        actions={isEmployee && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setRequesting(true)}>Request overtime</Button>}
      />
      {isEmployee && reviewer && (
        <Tabs className="mb-6" value={effective} onChange={setTab} tabs={[{ value: "mine", label: "My requests" }, { value: "review", label: "Team & review" }]} />
      )}
      {effective === "mine" ? <OvertimeList scope="mine" /> : <OvertimeList scope="team" />}
      {requesting && <RequestDialog onClose={() => setRequesting(false)} />}
    </>
  );
}

function OvertimeList({ scope }: { scope: "mine" | "team" }) {
  const q = useApiQuery<OvertimeRow[]>("/overtime-requests", { scope });
  const [acting, setActing] = useState<{ row: OvertimeRow; action: "RECOMMEND" | "VALIDATE" | "REJECT" } | null>(null);
  return (
    <Card>
      <CardHeader title={scope === "mine" ? "My overtime" : "Team overtime"} description={scope === "team" ? "Manager recommends → payroll validates payable minutes and rate basis → owner approves the payroll that contains the line." : undefined} />
      <QueryState query={q} empty={(d) => d.length === 0} emptyTitle="No overtime requests">
        {(rows) => (
          <Table>
            <THead>
              <tr>
                {scope === "team" && <TH>Employee</TH>}
                <TH>Date</TH><TH>Task</TH><TH className="text-right">Requested</TH><TH className="text-right">Actual</TH><TH className="text-right">Approved</TH><TH>Basis</TH><TH>Status</TH><TH>Reason</TH>
                {scope === "team" && <TH><span className="sr-only">Actions</span></TH>}
              </tr>
            </THead>
            <TBody>
              {rows.map((o) => (
                <TR key={o.id}>
                  {scope === "team" && <TD><Person id={o.employeeId} /></TD>}
                  <TD className="whitespace-nowrap">{fmtDate(o.date)}<span className="block text-[11px] text-slate-400">{relativeTime(o.createdAt)}</span></TD>
                  <TD className="max-w-[180px] truncate text-xs">{o.taskTitle ?? "—"}</TD>
                  <TD className="text-right tabular-nums">{o.requestedMinutes ? fmtMinutes(o.requestedMinutes) : <span className="text-slate-400">none</span>}</TD>
                  <TD className="text-right tabular-nums">{fmtMinutes(o.actualMinutes)}</TD>
                  <TD className="text-right tabular-nums">{fmtMinutes(o.approvedMinutes)}</TD>
                  <TD className="text-xs">{o.rateBasis ? `${humanize(o.rateBasis)}${o.multiplier ? ` ×${o.multiplier}` : ""}` : "—"}</TD>
                  <TD>
                    <StateBadge state={o.status} />
                    {o.unscheduled && <Badge tone="red" className="ml-1"><AlertTriangle className="h-3 w-3" />Unscheduled</Badge>}
                  </TD>
                  <TD className="max-w-xs text-xs text-slate-600 dark:text-slate-400">{o.reason}</TD>
                  {scope === "team" && (
                    <TD>
                      <div className="flex justify-end gap-2">
                        {o.canRecommend && <Button size="sm" onClick={() => setActing({ row: o, action: "RECOMMEND" })}>Recommend</Button>}
                        {o.canValidate && <Button size="sm" variant="success" onClick={() => setActing({ row: o, action: "VALIDATE" })}>Validate</Button>}
                        {(o.canRecommend || o.canValidate) && <Button size="sm" variant="outline" onClick={() => setActing({ row: o, action: "REJECT" })}>Reject</Button>}
                      </div>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </QueryState>
      {acting?.action === "VALIDATE" ? <ValidateDialog row={acting.row} onClose={() => setActing(null)} /> : <DecisionDialog acting={acting} onClose={() => setActing(null)} />}
    </Card>
  );
}

function DecisionDialog({ acting, onClose }: { acting: { row: OvertimeRow; action: "RECOMMEND" | "VALIDATE" | "REJECT" } | null; onClose: () => void }) {
  const toast = useToast();
  const m = useApiMutation("POST", "/overtime-requests/x/decision", {
    invalidate: ["/overtime-requests", "/dashboard"],
    onSuccess: () => { toast({ tone: "success", title: "Decision recorded" }); onClose(); },
  });
  return (
    <ConfirmDialog
      open={!!acting}
      onClose={() => { m.reset(); onClose(); }}
      title={acting?.action === "REJECT" ? "Reject overtime" : "Recommend overtime"}
      description={acting ? `${acting.row.employeeName} · ${fmtDate(acting.row.date)}` : undefined}
      confirmLabel={acting?.action === "REJECT" ? "Reject" : "Recommend"}
      tone={acting?.action === "REJECT" ? "danger" : "primary"}
      requireReason={acting?.action === "REJECT"}
      loading={m.isPending}
      error={formError(m.error)}
      onConfirm={(reason) => m.mutate({ path: `/overtime-requests/${acting!.row.id}/decision`, body: { action: acting!.action, reason: reason || undefined, approvalToWork: true } })}
    >
      {acting?.row.unscheduled && <Notice tone="amber">This overtime was worked without prior approval. Recommending sends it to payroll for validation; rejecting doesn't make the time unpaid by itself — payroll and policy still decide.</Notice>}
    </ConfirmDialog>
  );
}

function ValidateDialog({ row, onClose }: { row: OvertimeRow; onClose: () => void }) {
  const toast = useToast();
  const [approved, setApproved] = useState(row.actualMinutes ?? row.requestedMinutes);
  const [basis, setBasis] = useState<"FULL_RATE" | "PREMIUM_ONLY">("FULL_RATE");
  const [mult, setMult] = useState("1.5");
  const m = useApiMutation("POST", `/overtime-requests/${row.id}/decision`, {
    invalidate: ["/overtime-requests", "/dashboard"],
    onSuccess: () => { toast({ tone: "success", title: "Overtime validated" }); onClose(); },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Validate payable overtime"
      description={`${row.employeeName} · ${fmtDate(row.date)} · verified actual ${fmtMinutes(row.actualMinutes ?? row.requestedMinutes)}`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="success" loading={m.isPending} onClick={() => m.mutate({ body: { action: "VALIDATE", approvedMinutes: approved, rateBasis: basis, multiplier: mult } })}>Validate</Button></>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Approved payable minutes" required htmlFor="ot-min" error={fieldError(m.error, "approvedMinutes")}>
          <Input id="ot-min" type="number" min={0} value={approved} onChange={(e) => setApproved(Number(e.target.value))} />
        </Field>
        <Field label="Multiplier (policy-configured)" htmlFor="ot-mult" hint="Organization example value, not a statutory rate.">
          <Input id="ot-mult" value={mult} onChange={(e) => setMult(e.target.value)} />
        </Field>
        <Field label="Rate basis" required htmlFor="ot-basis" error={fieldError(m.error, "rateBasis")} className="sm:col-span-2" hint="Stored on the pay line so OT minutes aren't also charged as regular minutes.">
          <Select id="ot-basis" value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)}>
            <option value="FULL_RATE">Full rate (OT minutes excluded from regular pay)</option>
            <option value="PREMIUM_ONLY">Premium only (regular minutes already paid)</option>
          </Select>
        </Field>
        {formError(m.error) && <div className="sm:col-span-2"><InlineError message={formError(m.error)!} /></div>}
      </div>
    </Dialog>
  );
}

function RequestDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const dash = useApiQuery<DashboardData>("/dashboard");
  const [form, setForm] = useState({ date: businessDate(new Date()), taskId: "", requestedMinutes: 60, reason: "" });
  const m = useApiMutation("POST", "/overtime-requests", {
    invalidate: ["/overtime-requests", "/dashboard"],
    onSuccess: () => { toast({ tone: "success", title: "Overtime requested", body: "Your manager will review it." }); onClose(); },
  });
  const err = (k: string) => fieldError(m.error, k);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Request overtime"
      description="Ask before working extra time. Tracking can continue into approved overtime only with an explicit authorized interval."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate({ body: form })}>Submit</Button></>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date" required htmlFor="otr-date" error={err("date")}><Input id="otr-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
        <Field label="Estimated minutes" required htmlFor="otr-min" error={err("requestedMinutes")} hint={fmtMinutes(form.requestedMinutes)}><Input id="otr-min" type="number" min={15} step={15} value={form.requestedMinutes} onChange={(e) => setForm({ ...form, requestedMinutes: Number(e.target.value) })} /></Field>
        <Field label="Task" htmlFor="otr-task" error={err("taskId")} className="sm:col-span-2">
          <Select id="otr-task" value={form.taskId} onChange={(e) => setForm({ ...form, taskId: e.target.value })}>
            <option value="">No specific task</option>
            {dash.data?.myTasks.items.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </Select>
        </Field>
        <Field label="Reason" required htmlFor="otr-reason" error={err("reason")} className="sm:col-span-2"><Textarea id="otr-reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
        {formError(m.error) && <div className="sm:col-span-2"><InlineError message={formError(m.error)!} /></div>}
      </div>
    </Dialog>
  );
}
