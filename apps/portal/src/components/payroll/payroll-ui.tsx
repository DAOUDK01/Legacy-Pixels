"use client";

import { useEffect, useState } from "react";
import { Check, Fingerprint, ShieldCheck } from "lucide-react";
import type { PayComponent, PayComponentCategory } from "@/lib/types";
import { RUN_STEPS, type LineDetail, type RunDetail } from "@/lib/api/payroll";
import { useApiMutation, useApiQuery } from "@/lib/api/hooks";
import { api, ApiError, errorMessage } from "@/lib/api/transport";
import { formatMoney } from "@/lib/calc/money";
import { fmtDateTime, fmtMinutes } from "@/lib/time";
import {
  Badge, Button, Card, CardBody, CardHeader, Dialog, DL, Field, InlineError, Input, LoadingState, Notice, Select, Table, TBody, TD, TH, THead, TR, Textarea, cn,
} from "@/components/ui";
import { MoneyText, Person, StateBadge, humanize } from "@/components/domain";

/** Open period -> Draft -> Under review -> Owner approved & locked -> Exported -> Marked paid. */
export function RunStepper({ state }: { state?: string }) {
  const idx = state ? RUN_STEPS.findIndex((s) => s.state === state) : 0;
  return (
    <ol className="flex flex-wrap items-center gap-y-2 text-xs" aria-label="Payroll workflow">
      {RUN_STEPS.map((s, i) => {
        const done = i < idx;
        const current = i === idx;
        return (
          <li key={s.state} className="flex items-center" aria-current={current ? "step" : undefined}>
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium",
                done && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
                current && "bg-brand-600 text-white",
                !done && !current && "bg-slate-100 text-slate-500 dark:bg-slate-800",
              )}
            >
              {done ? <Check className="h-3 w-3" /> : <span className="tabular-nums">{i + 1}</span>}
              {s.label}
            </span>
            {i < RUN_STEPS.length - 1 && <span className="mx-1 h-px w-3 bg-slate-300 dark:bg-slate-700" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

const CATEGORY_TONE: Record<PayComponentCategory, "slate" | "green" | "blue" | "red" | "purple"> = { BASE: "slate", BONUS: "green", OVERTIME: "blue", DEDUCTION: "red", ADJUSTMENT: "purple" };

export function signedAmount(c: Pick<PayComponent, "category" | "amount">): string {
  return c.category === "DEDUCTION" ? `-${c.amount}` : c.amount;
}

export function LineDialog({ lineId, runDetail, onClose }: { lineId: string | null; runDetail: RunDetail; onClose: () => void }) {
  const q = useApiQuery<LineDetail>(lineId ? `/payroll-lines/${lineId}` : null);
  const [adding, setAdding] = useState(false);
  const [rejecting, setRejecting] = useState<PayComponent | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const decide = useApiMutation("POST", "/payroll-components/x/decision", { invalidate: ["/payroll"], onSuccess: () => setRejecting(null) });
  const editable = ["DRAFT", "UNDER_REVIEW"].includes(runDetail.run.state);
  const cur = runDetail.run.totals.currency;
  useEffect(() => {
    setAdding(false);
    decide.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineId]);

  return (
    <Dialog open={!!lineId} onClose={onClose} size="xl" title={q.data?.employee ? `${q.data.employee.displayName} · ${q.data.employee.employeeCode}` : "Payroll line"} description="Each line exposes every component, its proposer, approver and evidence.">
      {!q.data ? (
        <LoadingState />
      ) : (
        <div className="space-y-5">
          <DL
            cols={3}
            items={[
              { label: "Basis", value: q.data.profile ? `${humanize(q.data.profile.basis)} · ${formatMoney(q.data.profile.baseRate, q.data.profile.currency)}${q.data.profile.basis === "HOURLY" ? "/h" : ""}` : <Badge tone="red">Missing profile</Badge> },
              { label: "Proration", value: q.data.profile ? humanize(q.data.profile.proration) : "—" },
              { label: "Scheduled / payable", value: `${fmtMinutes(q.data.line.scheduledMinutes)} / ${fmtMinutes(q.data.line.payableMinutes)}` },
              { label: "Gross", value: <MoneyText amount={q.data.line.gross} currency={cur} /> },
              { label: "Deductions", value: <MoneyText amount={q.data.line.deductions} currency={cur} /> },
              { label: "Net payable", value: <MoneyText amount={q.data.line.net} currency={cur} className={cn("font-semibold", q.data.line.net.startsWith("-") && "text-red-600")} /> },
            ]}
          />
          {q.data.line.exceptions.length > 0 && (
            <Notice tone="amber" title="Blocking exceptions">
              <ul className="list-disc pl-4">{q.data.line.exceptions.map((e) => <li key={e}>{e}</li>)}</ul>
            </Notice>
          )}
          <Table className="rounded-lg border border-slate-200 dark:border-slate-800">
            <THead><tr><TH>Category</TH><TH>Description</TH><TH className="text-right">Amount</TH><TH>Status</TH><TH>Proposed / approved</TH><TH>Evidence</TH><TH /></tr></THead>
            <TBody>
              {q.data.line.components.map((c) => (
                <TR key={c.id}>
                  <TD><Badge tone={CATEGORY_TONE[c.category]}>{humanize(c.category)}</Badge>{c.otRateBasis && <span className="mt-1 block text-[11px] text-slate-500">{c.otRateBasis === "FULL_RATE" ? "Full rate" : "Premium only"}</span>}</TD>
                  <TD className="max-w-xs">{c.description}{c.quantity && <span className="block text-xs text-slate-500">{c.quantity} × {c.unitRate}</span>}{c.correctionOf && <span className="block text-xs text-slate-500">Corrects {c.correctionOf}</span>}</TD>
                  <TD className={cn("text-right tabular-nums", c.category === "DEDUCTION" && "text-red-600")}>{formatMoney(signedAmount(c), cur)}</TD>
                  <TD><StateBadge state={c.status} /></TD>
                  <TD className="text-xs">
                    {c.proposedBy === "system" ? "System (profile)" : <Person id={c.proposedBy} size={18} />}
                    <span className="mt-1 block">{c.approvedBy === "policy" ? "Policy" : c.approvedBy ? <Person id={c.approvedBy} size={18} /> : <span className="text-slate-400">Awaiting</span>}</span>
                  </TD>
                  <TD className="max-w-[10rem] text-xs"><span className="block truncate" title={c.evidence}>{c.evidence ?? "—"}</span></TD>
                  <TD>
                    {c.status === "PROPOSED" && editable && runDetail.permissions.canDecideComponents && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="success" loading={decide.isPending && !!(decide.variables as { path?: string } | undefined)?.path?.includes(c.id)} onClick={() => decide.mutate({ path: `/payroll-components/${c.id}/decision`, body: { decision: "APPROVE" } })}>Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => { setRejecting(c); setRejectReason(""); }}>Reject</Button>
                      </div>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {decide.error && <InlineError message={errorMessage(decide.error)} />}
          {rejecting && (
            <Card>
              <CardBody className="space-y-3">
                <Field label={`Reason for rejecting "${rejecting.description}"`} htmlFor="rej-reason" required>
                  <Textarea id="rej-reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button>
                  <Button variant="danger" loading={decide.isPending} onClick={() => decide.mutate({ path: `/payroll-components/${rejecting.id}/decision`, body: { decision: "REJECT", reason: rejectReason } })}>Reject component</Button>
                </div>
              </CardBody>
            </Card>
          )}
          {editable && runDetail.permissions.canPrepare && (adding ? <ComponentForm lineId={q.data.line.id} runVersion={runDetail.run.version} onDone={() => setAdding(false)} /> : <Button variant="outline" onClick={() => setAdding(true)}>Propose adjustment</Button>)}
          {!editable && <Notice tone="slate">This run is {humanize(runDetail.run.state).toLowerCase()}. Its lines can't change; corrections go to a next-period adjustment or an owner-approved reopen.</Notice>}
          {runDetail.run.state === "UNDER_REVIEW" && editable && <p className="text-xs text-slate-500">Changing any line returns the run to Draft and invalidates the pending owner approval.</p>}
        </div>
      )}
    </Dialog>
  );
}

function ComponentForm({ lineId, runVersion, onDone }: { lineId: string; runVersion: number; onDone: () => void }) {
  const [category, setCategory] = useState<PayComponentCategory>("BONUS");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [evidence, setEvidence] = useState("");
  const [otRateBasis, setOt] = useState<"FULL_RATE" | "PREMIUM_ONLY">("FULL_RATE");
  const m = useApiMutation("POST", `/payroll-lines/${lineId}/components`, { invalidate: ["/payroll"], onSuccess: onDone });
  const fe = m.error?.body.fieldErrors ?? {};
  return (
    <Card>
      <CardHeader title="Propose adjustment" description="Proposed lines don't count until someone other than you approves them. Deductions need a documented authorization; never assume fines or lateness deductions are permitted." />
      <CardBody className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" htmlFor="pc-cat" error={fe.category}>
          <Select id="pc-cat" value={category} onChange={(e) => setCategory(e.target.value as PayComponentCategory)}>
            <option value="BONUS">Bonus</option>
            <option value="OVERTIME">Overtime</option>
            <option value="DEDUCTION">Deduction</option>
            <option value="ADJUSTMENT">Adjustment (linked correction)</option>
          </Select>
        </Field>
        <Field label="Amount" htmlFor="pc-amt" required error={fe.amount} hint="Decimal, e.g. 2500.00">
          <Input id="pc-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} invalid={!!fe.amount} />
        </Field>
        <Field label="Description" htmlFor="pc-desc" required error={fe.description} className="sm:col-span-2">
          <Input id="pc-desc" value={description} onChange={(e) => setDescription(e.target.value)} invalid={!!fe.description} />
        </Field>
        <Field label={category === "DEDUCTION" ? "Authorization / basis" : "Evidence"} htmlFor="pc-ev" required error={fe.evidence} className={category === "OVERTIME" ? "" : "sm:col-span-2"}>
          <Input id="pc-ev" value={evidence} onChange={(e) => setEvidence(e.target.value)} invalid={!!fe.evidence} placeholder={category === "DEDUCTION" ? "e.g. Signed authorization ADV-23" : "e.g. OT-4, memo BON-15"} />
        </Field>
        {category === "OVERTIME" && (
          <Field label="Rate basis" htmlFor="pc-ot" error={fe.otRateBasis} hint="Prevents counting OT minutes twice.">
            <Select id="pc-ot" value={otRateBasis} onChange={(e) => setOt(e.target.value as typeof otRateBasis)}>
              <option value="FULL_RATE">Full rate (minutes not in base)</option>
              <option value="PREMIUM_ONLY">Premium only (minutes already in base)</option>
            </Select>
          </Field>
        )}
        {m.error && !Object.keys(fe).length && <div className="sm:col-span-2"><InlineError message={errorMessage(m.error)} /></div>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="outline" onClick={onDone}>Cancel</Button>
          <Button loading={m.isPending} onClick={() => m.mutate({ ifMatch: runVersion, body: { category, amount, description, evidence, otRateBasis: category === "OVERTIME" ? otRateBasis : undefined } })}>Propose</Button>
        </div>
      </CardBody>
    </Card>
  );
}

/** Owner approval of the exact batch hash and totals, with fresh re-authentication (section 14, 24). */
export function OwnerApprovalPanel({ detail }: { detail: RunDetail }) {
  const { run } = detail;
  const [proof, setProof] = useState<{ proof: string; authTime: string } | null>(null);
  const [reauthBusy, setReauthBusy] = useState(false);
  const [reauthErr, setReauthErr] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const approve = useApiMutation("POST", `/payroll-runs/${run.id}/approve`, { invalidate: ["/payroll", "/me"] });
  const blocked = detail.exceptionCount > 0;
  const fresh = proof && Date.now() - new Date(proof.authTime).getTime() < 10 * 60000;

  const reauth = async () => {
    setReauthBusy(true);
    setReauthErr(null);
    try {
      setProof(await api.post<{ proof: string; authTime: string }>("/auth/reauth", { confirm: true }));
    } catch (e) {
      setReauthErr(errorMessage(e));
    } finally {
      setReauthBusy(false);
    }
  };
  const err = approve.error as ApiError | null;

  return (
    <Card className="border-brand-200 dark:border-brand-900">
      <CardHeader title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-brand-600" />Owner approval</span>} description="You approve this exact batch. Any later change to a line produces a new hash and requires a new approval." />
      <CardBody className="space-y-4">
        <DL
          cols={3}
          items={[
            { label: "Input hash", value: <code className="break-all font-mono text-xs">{run.inputHash}</code> },
            { label: "Employees", value: run.totals.employees },
            { label: "Revision", value: `${run.revision} · v${run.version}` },
            { label: "Gross", value: <MoneyText amount={run.totals.gross} currency={run.totals.currency} /> },
            { label: "Deductions", value: <MoneyText amount={run.totals.deductions} currency={run.totals.currency} /> },
            { label: "Net payable", value: <MoneyText amount={run.totals.net} currency={run.totals.currency} className="font-semibold" /> },
          ]}
        />
        {blocked && <Notice tone="amber" title={`${detail.exceptionCount} blocking exception(s)`}>Resolve every exception in the queue before approving.</Notice>}
        {detail.permissions.isPreparer && <Notice tone="red">You prepared this run, so you cannot approve it.</Notice>}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant={fresh ? "success" : "outline"} icon={<Fingerprint className="h-4 w-4" />} loading={reauthBusy} onClick={reauth} disabled={blocked}>
            {fresh ? "Re-authenticated" : "Re-authenticate"}
          </Button>
          {fresh && <span className="text-xs text-slate-500">Valid until {fmtDateTime(new Date(new Date(proof!.authTime).getTime() + 10 * 60000).toISOString())}</span>}
          {reauthErr && <InlineError message={reauthErr} />}
        </div>
        <Field label="Approval note" htmlFor="appr-note" required error={err?.body.fieldErrors?.reason}>
          <Textarea id="appr-note" value={reason} onChange={(e) => setReason(e.target.value)} disabled={!fresh || blocked} placeholder="e.g. Reviewed register, exceptions and owner line exception." />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} disabled={!fresh || blocked} />
          <span>I approve net payable <strong>{formatMoney(run.totals.net, run.totals.currency)}</strong> for hash <code className="font-mono text-xs">{run.inputHash}</code>. Approval locks inputs and publishes payslips; it does not send any payment.</span>
        </label>
        {err && !err.body.fieldErrors && <InlineError message={err.code === "VERSION_CONFLICT" ? "Inputs changed since you loaded them. The page has the latest totals — review and approve again." : errorMessage(err)} />}
        <div className="flex justify-end">
          <Button
            variant="success"
            disabled={!fresh || blocked || !confirm || detail.permissions.isPreparer}
            loading={approve.isPending}
            onClick={() => approve.mutate({ ifMatch: run.version, body: { inputHash: run.inputHash, reauthenticationProof: proof?.proof, reason } })}
          >
            Approve & lock payroll
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
