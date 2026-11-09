"use client";

import { useState } from "react";
import { ClipboardCheck, FileText, Plus } from "lucide-react";
import { useApiMutation, useApiQuery, useLookups, useMe } from "@/lib/api/hooks";
import { fmtDays, type LeaveBalance, type LeaveLedgerResponse, type LeaveRequestRow } from "@/lib/api/workforce";
import { can } from "@/lib/rbac";
import { fmtDate, fmtDateTime, fmtMinutes } from "@/lib/time";
import {
  Badge, Button, ButtonLink, Card, CardHeader, Checkbox, ConfirmDialog, Dialog, Field, InlineError, Input, Notice, PageHeader,
  Progress, QueryState, Select, Table, TBody, TD, TH, THead, TR, Textarea,
} from "@/components/ui";
import { StateBadge, humanize } from "@/components/domain";
import { useToast } from "@/components/ui/toast";
import { LeaveCalendar } from "@/components/workforce/LeaveCalendar";
import { fieldError, formError } from "@/components/workforce/common";

export default function LeavePage() {
  const me = useMe();
  const isEmployee = !!me.data?.employee;
  const [requesting, setRequesting] = useState(false);
  const [ledgerType, setLedgerType] = useState<LeaveBalance | null>(null);
  const balances = useApiQuery<{ balances: LeaveBalance[] }>(isEmployee ? "/leave/balances" : null);
  const requests = useApiQuery<LeaveRequestRow[]>(isEmployee ? "/leave-requests" : null, { scope: "mine" });
  const [withdrawing, setWithdrawing] = useState<LeaveRequestRow | null>(null);
  const toast = useToast();
  const act = useApiMutation("POST", "/leave-requests/x/decision", {
    invalidate: ["/leave", "/leave-requests", "/dashboard"],
    onSuccess: () => {
      toast({ tone: "success", title: "Request updated" });
      setWithdrawing(null);
    },
  });

  return (
    <>
      <PageHeader
        title="Leave"
        description="Balances come from your leave ledger (entitlement, carryover, use and adjustments) — never a single editable number."
        actions={
          <>
            {me.data && (can(me.data, "leave.recommend") || can(me.data, "leave.approve")) && <ButtonLink href="/leave/approvals" icon={<ClipboardCheck className="h-4 w-4" />}>Approvals</ButtonLink>}
            {isEmployee && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setRequesting(true)}>Request leave</Button>}
          </>
        }
      />
      <div className="space-y-6">
        {isEmployee && (
          <QueryState query={balances} rows={3}>
            {(d) => (
              <section aria-label="Balances" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {d.balances.filter((b) => b.entitledMinutes || b.usedMinutes || b.pendingMinutes || b.reservedMinutes).map((b) => (
                  <Card key={b.type.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <p className="text-sm font-medium">{b.type.name}</p>
                      <button className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setLedgerType(b)}>Ledger</button>
                    </div>
                    <p className="mt-2 text-2xl font-semibold tabular-nums">{fmtDays(b.availableMinutes)}</p>
                    <p className="text-xs text-slate-500">available</p>
                    {b.entitledMinutes > 0 && <div className="mt-3"><Progress value={b.entitledMinutes - b.availableMinutes} max={b.entitledMinutes} label={`${b.type.name} used`} /></div>}
                    <dl className="mt-3 grid grid-cols-3 gap-1 text-[11px] text-slate-500">
                      <div><dt>Entitled</dt><dd className="font-medium text-slate-800 dark:text-slate-200">{fmtDays(b.entitledMinutes)}</dd></div>
                      <div><dt>Used</dt><dd className="font-medium text-slate-800 dark:text-slate-200">{fmtDays(b.usedMinutes)}</dd></div>
                      <div><dt>Reserved</dt><dd className="font-medium text-slate-800 dark:text-slate-200">{fmtDays(b.reservedMinutes)}</dd></div>
                    </dl>
                    {b.pendingMinutes > 0 && <p className="mt-2 text-xs text-amber-700">{fmtDays(b.pendingMinutes)} pending approval</p>}
                  </Card>
                ))}
              </section>
            )}
          </QueryState>
        )}

        {isEmployee && (
          <Card>
            <CardHeader title="My requests" description="Draft → Pending → Approved or Rejected. Pending requests can be withdrawn." />
            <QueryState query={requests} empty={(d) => d.length === 0} emptyTitle="No leave requests yet" emptyAction={<Button size="sm" onClick={() => setRequesting(true)}>Request leave</Button>}>
              {(rows) => (
                <Table>
                  <THead><tr><TH>Type</TH><TH>Dates</TH><TH className="text-right">Duration</TH><TH>Status</TH><TH>Manager</TH><TH>HR</TH><TH><span className="sr-only">Actions</span></TH></tr></THead>
                  <TBody>
                    {rows.map((r) => (
                      <TR key={r.id}>
                        <TD>
                          {r.typeName}
                          {r.hasDocument && <FileText className="ml-1 inline h-3.5 w-3.5 text-slate-400" aria-label="Supporting document attached" />}
                          {r.note && <span className="block max-w-xs truncate text-xs text-slate-500">{r.note}</span>}
                        </TD>
                        <TD className="whitespace-nowrap">{fmtDate(r.startDate)}{r.endDate !== r.startDate && <> – {fmtDate(r.endDate)}</>}</TD>
                        <TD className="text-right tabular-nums">{r.partialMinutes ? fmtMinutes(r.requestedMinutes) : fmtDays(r.requestedMinutes)}</TD>
                        <TD><StateBadge state={r.status} /></TD>
                        <TD className="text-xs">{r.managerDecision ? humanize(r.managerDecision.decision) : "—"}</TD>
                        <TD className="text-xs">{r.hrDecision ? <>{humanize(r.hrDecision.decision)}{r.hrDecision.reason && <span className="block text-slate-500">{r.hrDecision.reason}</span>}</> : "—"}</TD>
                        <TD>
                          <div className="flex justify-end gap-2">
                            {r.status === "DRAFT" && <Button size="sm" onClick={() => act.mutate({ path: `/leave-requests/${r.id}/decision`, body: { action: "SUBMIT" } })}>Submit</Button>}
                            {r.canWithdraw && <Button size="sm" variant="outline" onClick={() => setWithdrawing(r)}>Withdraw</Button>}
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </QueryState>
            {formError(act.error) && !withdrawing && <div className="px-5 pb-4"><InlineError message={formError(act.error)!} /></div>}
          </Card>
        )}

        <LeaveCalendar />
      </div>

      {requesting && <LeaveRequestDialog onClose={() => setRequesting(false)} balances={balances.data?.balances ?? []} />}
      {ledgerType && <LedgerDialog balance={ledgerType} onClose={() => setLedgerType(null)} />}
      <ConfirmDialog
        open={!!withdrawing}
        onClose={() => setWithdrawing(null)}
        title="Withdraw leave request?"
        description={withdrawing ? `${withdrawing.typeName}, ${fmtDate(withdrawing.startDate)}${withdrawing.endDate !== withdrawing.startDate ? ` – ${fmtDate(withdrawing.endDate)}` : ""}` : undefined}
        confirmLabel="Withdraw"
        tone="danger"
        loading={act.isPending}
        error={formError(act.error)}
        onConfirm={() => act.mutate({ path: `/leave-requests/${withdrawing!.id}/decision`, body: { action: "WITHDRAW" } })}
      />
    </>
  );
}

function LeaveRequestDialog({ onClose, balances }: { onClose: () => void; balances: LeaveBalance[] }) {
  const { data: lookups } = useLookups();
  const toast = useToast();
  const [form, setForm] = useState({ typeId: lookups?.leaveTypes[0]?.id ?? "lt-annual", startDate: "", endDate: "", partial: false, partialMinutes: 240, note: "", hasDocument: false });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const type = lookups?.leaveTypes.find((t) => t.id === form.typeId);
  const bal = balances.find((b) => b.type.id === form.typeId);
  const m = useApiMutation<LeaveRequestRow>("POST", "/leave-requests", {
    invalidate: ["/leave", "/leave-requests", "/dashboard"],
    onSuccess: (r) => {
      toast({ tone: "success", title: r.status === "DRAFT" ? "Draft saved" : "Leave requested", body: r.status === "PENDING" ? "Your manager reviews coverage, then HR confirms type and balance." : undefined });
      onClose();
    },
  });
  const submit = (submitNow: boolean) =>
    m.mutate({
      body: {
        typeId: form.typeId, startDate: form.startDate, endDate: form.partial ? form.startDate : form.endDate || form.startDate,
        partialMinutes: form.partial ? form.partialMinutes : undefined, note: form.note, hasDocument: form.hasDocument, submit: submitNow,
      },
    });
  const err = (k: string) => fieldError(m.error, k);
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Request leave"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="secondary" disabled={m.isPending} onClick={() => submit(false)}>Save draft</Button><Button loading={m.isPending} onClick={() => submit(true)}>Submit request</Button></>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Leave type" required htmlFor="lv-type" error={err("typeId")} className="sm:col-span-2">
          <Select id="lv-type" value={form.typeId} onChange={(e) => set("typeId", e.target.value)}>
            {lookups?.leaveTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        {bal && <div className="sm:col-span-2"><Notice tone="slate">Available: {fmtDays(bal.availableMinutes)}{bal.pendingMinutes ? ` · ${fmtDays(bal.pendingMinutes)} already pending` : ""}{type?.allowNegative ? " · this type may go negative" : ""}</Notice></div>}
        <div className="sm:col-span-2">
          <Checkbox label="Part of a single day" checked={form.partial} onChange={(v) => set("partial", v)} description="Minutes are resolved against your scheduled shift." />
        </div>
        <Field label={form.partial ? "Date" : "Start date"} required htmlFor="lv-start" error={err("startDate")}>
          <Input id="lv-start" type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
        </Field>
        {form.partial ? (
          <Field label="Minutes" required htmlFor="lv-min" error={err("partialMinutes")} hint={fmtMinutes(form.partialMinutes)}>
            <Input id="lv-min" type="number" min={30} max={480} step={15} value={form.partialMinutes} onChange={(e) => set("partialMinutes", Number(e.target.value))} />
          </Field>
        ) : (
          <Field label="End date" required htmlFor="lv-end" error={err("endDate")}>
            <Input id="lv-end" type="date" min={form.startDate} value={form.endDate} onChange={(e) => set("endDate", e.target.value)} />
          </Field>
        )}
        <Field label="Note (visible to HR only)" htmlFor="lv-note" className="sm:col-span-2" hint="Don't include medical details here — attach a restricted document instead.">
          <Textarea id="lv-note" value={form.note} onChange={(e) => set("note", e.target.value)} rows={2} />
        </Field>
        <div className="sm:col-span-2">
          <Checkbox label={`Supporting document attached${type?.requiresDocument ? " (required)" : ""}`} description="Restricted to HR. Upload happens through the secure document flow." checked={form.hasDocument} onChange={(v) => set("hasDocument", v)} />
          {err("hasDocument") && <p className="mt-1 text-xs text-red-600">{err("hasDocument")}</p>}
        </div>
        {formError(m.error) && <div className="sm:col-span-2"><InlineError message={formError(m.error)!} /></div>}
      </div>
    </Dialog>
  );
}

function LedgerDialog({ balance, onClose }: { balance: LeaveBalance; onClose: () => void }) {
  const q = useApiQuery<LeaveLedgerResponse>("/leave/ledger", { typeId: balance.type.id });
  return (
    <Dialog open onClose={onClose} size="lg" title={`${balance.type.name} ledger`} description="Every change to your balance is an entry. Reversals reference the original entry.">
      <QueryState query={q} empty={(d) => d.entries.length === 0} emptyTitle="No ledger entries">
        {(d) => {
          let running = d.entries.reduce((a, e) => a + e.deltaMinutes, 0);
          return (
            <Table>
              <THead><tr><TH>Effective</TH><TH>Entry</TH><TH>Note</TH><TH className="text-right">Change</TH><TH className="text-right">Balance</TH></tr></THead>
              <TBody>
                {d.entries.map((e) => {
                  const after = running;
                  running -= e.deltaMinutes;
                  return (
                    <TR key={e.id}>
                      <TD className="whitespace-nowrap">{fmtDate(e.effectiveDate)}</TD>
                      <TD><Badge tone={e.deltaMinutes >= 0 ? "green" : "slate"}>{humanize(e.entryType)}</Badge></TD>
                      <TD className="text-xs text-slate-500">{e.note ?? (e.requestId ? `Request ${e.requestId}` : "—")} · policy v{e.policyVersion}</TD>
                      <TD className={`text-right tabular-nums ${e.deltaMinutes < 0 ? "text-red-600" : "text-emerald-700"}`}>{e.deltaMinutes > 0 ? "+" : ""}{fmtDays(e.deltaMinutes)}</TD>
                      <TD className="text-right tabular-nums">{fmtDays(after)}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          );
        }}
      </QueryState>
      <p className="mt-3 text-xs text-slate-500">1 day = 480 minutes for display. Generated {fmtDateTime(new Date().toISOString())}.</p>
    </Dialog>
  );
}
