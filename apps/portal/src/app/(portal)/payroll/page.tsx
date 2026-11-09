"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Users } from "lucide-react";
import { useApiMutation, useApiQuery, useMe } from "@/lib/api/hooks";
import type { PeriodSummary, RunWithExtras } from "@/lib/api/payroll";
import { can } from "@/lib/rbac";
import { errorMessage } from "@/lib/api/transport";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { Button, ButtonLink, Card, CardHeader, ConfirmDialog, Notice, PageHeader, QueryState, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { MoneyText, Person, StateBadge } from "@/components/domain";
import { RunStepper } from "@/components/payroll/payroll-ui";

export default function PayrollPage() {
  const me = useMe();
  const router = useRouter();
  const q = useApiQuery<PeriodSummary[]>("/payroll/periods");
  const [creating, setCreating] = useState<PeriodSummary | null>(null);
  const create = useApiMutation<RunWithExtras>("POST", "/payroll-runs", { invalidate: ["/payroll"], onSuccess: (r) => router.push(`/payroll/runs/${r.id}`) });
  const canPrepare = can(me.data, "payroll.prepare");

  return (
    <>
      <PageHeader
        title="Payroll"
        description="Payroll officer prepares, HR validates attendance and leave exceptions, and the owner approves the exact batch. Exports never initiate bank payments."
        actions={can(me.data, "compensation.read") && <ButtonLink href="/payroll/compensation" icon={<Users className="h-4 w-4" />}>Compensation profiles</ButtonLink>}
      />
      <div className="mb-6">
        <Notice tone="slate">Net payable = base wages + approved bonuses + approved overtime − approved deductions. Productivity scores never change wages, and missing monitoring never authorizes a deduction.</Notice>
      </div>
      <QueryState query={q} empty={(d) => d.length === 0} emptyTitle="No payroll periods">
        {(periods) => (
          <div className="space-y-6">
            {periods.map((p) => {
              const latest = p.runs.find((r) => !r.supersededBy) ?? p.runs[0];
              return (
                <Card key={p.id}>
                  <CardHeader
                    title={<span className="flex flex-wrap items-center gap-2">{p.label} <StateBadge state={p.state} /></span>}
                    description={`${fmtDate(p.start)} – ${fmtDate(p.end)} · ${p.timezone} · ${p.currency}`}
                    actions={canPrepare && p.state === "OPEN" && !p.runs.some((r) => !r.supersededBy) && (
                      <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(p)}>Create draft run</Button>
                    )}
                  />
                  <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-800"><RunStepper state={latest?.state ?? "OPEN"} /></div>
                  {p.runs.length === 0 ? (
                    <p className="px-5 py-4 text-sm text-slate-500">No run yet. {canPrepare ? "Create a draft run from current compensation profiles." : "The payroll officer prepares the draft."}</p>
                  ) : (
                    <Table>
                      <THead><tr><TH>Revision</TH><TH>State</TH><TH>Prepared by</TH><TH className="text-right">Employees</TH><TH className="text-right">Gross</TH><TH className="text-right">Deductions</TH><TH className="text-right">Net</TH><TH>Updated</TH><TH /></tr></THead>
                      <TBody>
                        {p.runs.map((r) => (
                          <TR key={r.id} onClick={() => router.push(`/payroll/runs/${r.id}`)}>
                            <TD className="font-medium">Rev {r.revision}{r.supersededBy && <span className="ml-2 text-xs text-slate-500">superseded</span>}</TD>
                            <TD><StateBadge state={r.state} /></TD>
                            <TD><Person id={r.preparedBy} size={20} /></TD>
                            <TD className="text-right tabular-nums">{r.totals.employees}</TD>
                            <TD className="text-right"><MoneyText amount={r.totals.gross} currency={r.totals.currency} /></TD>
                            <TD className="text-right"><MoneyText amount={r.totals.deductions} currency={r.totals.currency} /></TD>
                            <TD className="text-right font-semibold"><MoneyText amount={r.totals.net} currency={r.totals.currency} /></TD>
                            <TD className="whitespace-nowrap text-xs">{fmtDateTime(r.paidAt ?? r.exportedAt ?? r.lockedAt ?? r.createdAt)}</TD>
                            <TD><Link href={`/payroll/runs/${r.id}`} className="text-sm font-medium text-brand-600 hover:underline" onClick={(e) => e.stopPropagation()}>Open</Link></TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </QueryState>
      <ConfirmDialog
        open={!!creating}
        onClose={() => { setCreating(null); create.reset(); }}
        title={`Create draft run for ${creating?.label}`}
        description="Lines are built from effective compensation profiles for active employees. Validated overtime is added as proposed components that need approval."
        confirmLabel="Create draft"
        loading={create.isPending}
        error={create.error ? errorMessage(create.error) : null}
        onConfirm={() => create.mutate({ body: { periodId: creating!.id } })}
      />
    </>
  );
}
