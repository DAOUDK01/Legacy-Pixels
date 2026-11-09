"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Banknote, Download, RotateCcw, Send } from "lucide-react";
import { useApiMutation, useApiQuery, useMe } from "@/lib/api/hooks";
import type { ExportResponse, RunDetail, RunWithExtras } from "@/lib/api/payroll";
import { errorMessage } from "@/lib/api/transport";
import { fmtDate, fmtDateTime, fmtMinutes } from "@/lib/time";
import {
  Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, Dialog, Field, InlineError, Input, Notice, PageHeader, QueryState, Table, TBody, TD, TH, THead, TR,
} from "@/components/ui";
import { MoneyText, Person, StateBadge, humanize } from "@/components/domain";
import { LineDialog, OwnerApprovalPanel, RunStepper } from "@/components/payroll/payroll-ui";
import { useToast } from "@/components/ui/toast";

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useApiQuery<RunDetail>(`/payroll-runs/${id}`);
  return (
    <QueryState query={q} rows={10}>
      {(d) => <RunView detail={d} />}
    </QueryState>
  );
}

function RunView({ detail }: { detail: RunDetail }) {
  const { run, period, lines, permissions } = detail;
  const me = useMe();
  const router = useRouter();
  const toast = useToast();
  const [lineId, setLineId] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [paidOpen, setPaidOpen] = useState(false);
  const [ownerExOpen, setOwnerExOpen] = useState<string | null>(null);
  const cur = run.totals.currency;
  const inv = { invalidate: ["/payroll"] };

  const submit = useApiMutation("POST", `/payroll-runs/${run.id}/submit-review`, { ...inv, onSuccess: () => setSubmitOpen(false) });
  const reopen = useApiMutation<RunWithExtras>("POST", `/payroll-runs/${run.id}/reopen`, { ...inv, onSuccess: (r) => { setReopenOpen(false); router.push(`/payroll/runs/${r.id}`); } });
  const exp = useApiMutation<ExportResponse>("POST", `/payroll-runs/${run.id}/exports`, {
    ...inv,
    onSuccess: (r) => {
      const blob = new Blob([r.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast({ tone: "success", title: "Export downloaded", body: `${r.filename} is watermarked and access-logged. The link expires in 24 hours.` });
    },
  });
  const ownerEx = useApiMutation("POST", `/payroll-runs/${run.id}/owner-exception`, { ...inv, onSuccess: () => setOwnerExOpen(null) });

  const exceptionLines = lines.filter((l) => l.exceptions.length > 0);
  const editable = ["DRAFT", "UNDER_REVIEW"].includes(run.state);
  const isOwnerEx = (e: string) => e.startsWith("Owner's own payroll line");

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Payroll", href: "/payroll" }, { label: period.label }, { label: `Revision ${run.revision}` }]}
        title={<span className="flex flex-wrap items-center gap-3">{period.label} · Rev {run.revision} <StateBadge state={run.state} /></span>}
        description={`${fmtDate(period.start)} – ${fmtDate(period.end)} · ${period.timezone} · ${period.currency} · hash ${run.inputHash}`}
        actions={
          <>
            {permissions.canPrepare && run.state === "DRAFT" && <Button icon={<Send className="h-4 w-4" />} onClick={() => setSubmitOpen(true)}>Submit for review</Button>}
            {permissions.canExport && ["LOCKED", "EXPORTED", "PAID"].includes(run.state) && <Button variant="outline" icon={<Download className="h-4 w-4" />} loading={exp.isPending} onClick={() => exp.mutate()}>Export CSV</Button>}
            {(permissions.canExport || permissions.canApprove) && run.state === "EXPORTED" && <Button variant="outline" icon={<Banknote className="h-4 w-4" />} onClick={() => setPaidOpen(true)}>Mark paid</Button>}
            {permissions.canReopen && ["LOCKED", "EXPORTED"].includes(run.state) && !run.supersededBy && <Button variant="outline" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setReopenOpen(true)}>Reopen</Button>}
          </>
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm text-slate-600">
        Prepared by <Person id={run.preparedBy} size={20} />
        <span className="mx-2 hidden h-4 w-px bg-slate-200 sm:block" />
        <RunStepper state={run.state} />
      </div>

      <div className="space-y-6">
        {run.supersededBy && <Notice tone="amber" title="Superseded revision">This revision was reopened. <Link className="underline" href={`/payroll/runs/${run.supersededBy}`}>Open the new revision</Link>. This snapshot is preserved unchanged.</Notice>}
        {run.reopenedFrom && <Notice tone="blue" title="Reopened revision">Created from <Link className="underline" href={`/payroll/runs/${run.reopenedFrom}`}>the previous revision</Link>: {run.reopenReason}</Notice>}
        {run.state === "PAID" && <Notice tone="green" title="Marked paid">External reference {run.paymentReference} on {fmtDate(run.paidAt?.slice(0, 10))}. Paid snapshots never change; corrections become next-period adjustments.</Notice>}
        {exp.error && <InlineError message={errorMessage(exp.error)} />}

        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card className="p-4"><p className="text-xs uppercase text-slate-500">Employees</p><p className="mt-1 text-2xl font-semibold">{run.totals.employees}</p></Card>
          <Card className="p-4"><p className="text-xs uppercase text-slate-500">Gross</p><p className="mt-1 text-xl font-semibold"><MoneyText amount={run.totals.gross} currency={cur} /></p></Card>
          <Card className="p-4"><p className="text-xs uppercase text-slate-500">Deductions</p><p className="mt-1 text-xl font-semibold"><MoneyText amount={run.totals.deductions} currency={cur} /></p></Card>
          <Card className="p-4"><p className="text-xs uppercase text-slate-500">Net payable</p><p className="mt-1 text-xl font-semibold"><MoneyText amount={run.totals.net} currency={cur} /></p></Card>
        </section>

        <div className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <Card>
              <CardHeader title="Payroll register" description="Select a line to see every component, propose adjustments, or approve proposed lines." />
              <Table>
                <THead><tr><TH>Employee</TH><TH>Basis</TH><TH className="text-right">Payable</TH><TH className="text-right">Gross</TH><TH className="text-right">Deductions</TH><TH className="text-right">Net</TH><TH>Exceptions</TH></tr></THead>
                <TBody>
                  {lines.map((l) => (
                    <TR key={l.id} onClick={() => setLineId(l.id)}>
                      <TD><span className="block font-medium text-slate-900 dark:text-slate-100">{l.employeeName}</span><span className="text-xs text-slate-500">{l.employeeCode}</span></TD>
                      <TD>{l.basis ? humanize(l.basis) : <Badge tone="red">Missing</Badge>}</TD>
                      <TD className="text-right tabular-nums">{fmtMinutes(l.payableMinutes)}</TD>
                      <TD className="text-right"><MoneyText amount={l.gross} currency={cur} /></TD>
                      <TD className="text-right"><MoneyText amount={l.deductions} currency={cur} /></TD>
                      <TD className="text-right font-semibold"><MoneyText amount={l.net} currency={cur} className={l.net.startsWith("-") ? "text-red-600" : ""} /></TD>
                      <TD>{l.exceptions.length ? <Badge tone="amber">{l.exceptions.length}</Badge> : <span className="text-slate-400">—</span>}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>

            <Card>
              <CardHeader title="Approvals & exports" description="Approval references and export history (exports are watermarked, access-logged and expire after 24 hours)." />
              <CardBody className="space-y-3 text-sm">
                {run.approvals.length === 0 && run.exports.length === 0 && <p className="text-slate-500">No approvals or exports yet.</p>}
                {run.approvals.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-center gap-2">
                    <Badge tone="green">Approved</Badge><Person id={a.ownerId} size={20} /><span className="text-slate-500">{fmtDateTime(a.approvedAt)}</span>
                    <code className="font-mono text-xs">{a.inputHash}</code><span className="text-slate-600">“{a.reason}”</span><span className="font-mono text-[11px] text-slate-400">{a.id}</span>
                  </div>
                ))}
                {run.exports.map((x) => (
                  <div key={x.id} className="flex flex-wrap items-center gap-2">
                    <Badge tone="cyan">{x.format} export</Badge><Person id={x.by} size={20} /><span className="text-slate-500">{fmtDateTime(x.at)}</span>
                    <span className="text-xs text-slate-500">{new Date(x.expiresAt).getTime() < Date.now() ? "expired" : `expires ${fmtDateTime(x.expiresAt)}`}</span>
                  </div>
                ))}
              </CardBody>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader title={<span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" />Exception queue</span>} description="Approval is blocked until this is empty." />
              {exceptionLines.length === 0 ? (
                <p className="px-5 py-4 text-sm text-emerald-700">No blocking exceptions.</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {exceptionLines.flatMap((l) =>
                    l.exceptions.map((e) => (
                      <li key={`${l.id}-${e}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                        <span className="min-w-0"><span className="block font-medium">{l.employeeName}</span><span className="text-slate-600 dark:text-slate-400">{e}</span></span>
                        {isOwnerEx(e) && permissions.canApprove && editable ? (
                          <Button size="sm" variant="outline" onClick={() => setOwnerExOpen(l.employeeId)}>Record exception</Button>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => setLineId(l.id)}>Review</Button>
                        )}
                      </li>
                    )),
                  )}
                </ul>
              )}
            </Card>
            {run.state === "UNDER_REVIEW" && permissions.canApprove && <OwnerApprovalPanel detail={detail} />}
            {run.state === "UNDER_REVIEW" && !permissions.canApprove && <Notice tone="blue">Waiting for owner approval. {me.data?.roles.includes("PAYROLL") ? "As preparer you cannot approve this batch." : ""}</Notice>}
            {run.state === "DRAFT" && <Notice tone="slate">Draft: the payroll officer resolves exceptions and submits for review. HR validates attendance and leave exceptions before submission.</Notice>}
          </div>
        </div>
      </div>

      <LineDialog lineId={lineId} runDetail={detail} onClose={() => setLineId(null)} />

      <ConfirmDialog
        open={submitOpen}
        onClose={() => { setSubmitOpen(false); submit.reset(); }}
        title="Submit for owner review"
        description={detail.exceptionCount ? `${detail.exceptionCount} exception(s) remain. The owner cannot approve until they're resolved.` : "Totals and the input hash will be presented to the owner for approval."}
        confirmLabel="Submit"
        loading={submit.isPending}
        error={submit.error ? errorMessage(submit.error) : null}
        onConfirm={() => submit.mutate({ ifMatch: run.version })}
      />
      <ConfirmDialog
        open={reopenOpen}
        onClose={() => { setReopenOpen(false); reopen.reset(); }}
        title="Reopen approved payroll"
        description="Creates a new draft revision. The approved snapshot is preserved; unpaid payslips for this revision are withdrawn. Prefer a next-period adjustment when possible."
        confirmLabel="Reopen"
        tone="danger"
        requireReason
        loading={reopen.isPending}
        error={reopen.error ? errorMessage(reopen.error) : null}
        onConfirm={(reason) => reopen.mutate({ ifMatch: run.version, body: { reason } })}
      />
      <ConfirmDialog
        open={!!ownerExOpen}
        onClose={() => { setOwnerExOpen(null); ownerEx.reset(); }}
        title="Record owner line exception"
        description="Single-owner organizations need an explicit, evidenced exception for the owner's own payroll line."
        confirmLabel="Record exception"
        requireReason
        reasonLabel="Exception reason and review evidence"
        loading={ownerEx.isPending}
        error={ownerEx.error ? errorMessage(ownerEx.error) : null}
        onConfirm={(reason) => ownerEx.mutate({ body: { employeeId: ownerExOpen, reason } })}
      />
      <MarkPaidDialog open={paidOpen} onClose={() => setPaidOpen(false)} runId={run.id} version={run.version} />
    </>
  );
}

function MarkPaidDialog({ open, onClose, runId, version }: { open: boolean; onClose: () => void; runId: string; version: number }) {
  const [ref, setRef] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const m = useApiMutation("POST", `/payroll-runs/${runId}/mark-paid`, { invalidate: ["/payroll"], onSuccess: onClose });
  const fe = m.error?.body.fieldErrors ?? {};
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Mark payroll paid"
      description="Records the external bank reference and date. The portal never initiates or sends payments."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate({ ifMatch: version, body: { paymentReference: ref, paidDate: date } })}>Mark paid</Button></>}
    >
      <div className="space-y-4">
        <Field label="External payment reference" htmlFor="mp-ref" required error={fe.paymentReference}><Input id="mp-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. BANK-BATCH-1126" /></Field>
        <Field label="Payment date" htmlFor="mp-date" required error={fe.paidDate}><Input id="mp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {m.error && !Object.keys(fe).length && <InlineError message={errorMessage(m.error)} />}
      </div>
    </Dialog>
  );
}
