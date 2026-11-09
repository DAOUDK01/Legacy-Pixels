"use client";

import { useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { useApiQuery } from "@/lib/api/hooks";
import type { CompensationRow } from "@/lib/api/payroll";
import { formatMoney } from "@/lib/calc/money";
import { fmtDate } from "@/lib/time";
import { Badge, Card, CardHeader, Checkbox, FilterBar, Input, Notice, PageHeader, QueryState, Table, TBody, TD, TH, THead, TR, Field } from "@/components/ui";
import { humanize } from "@/components/domain";

export default function CompensationPage() {
  const q = useApiQuery<CompensationRow[]>("/compensation");
  const [search, setSearch] = useState("");
  const [currentOnly, setCurrentOnly] = useState(false);
  const rows = useMemo(
    () => (q.data ?? []).filter((r) => (!currentOnly || r.current) && `${r.employeeName} ${r.employeeCode}`.toLowerCase().includes(search.toLowerCase())),
    [q.data, search, currentOnly],
  );
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Payroll", href: "/payroll" }, { label: "Compensation" }]}
        title="Compensation profiles"
        description="Effective-dated and restricted. Every view of this page is audited."
      />
      <div className="mb-4"><Notice tone="amber" icon={<Lock className="h-4 w-4" />}>Restricted compensation data. Don't copy it into email or chat; changes to personal compensation require separate approval and can't be approved by the payroll officer.</Notice></div>
      <Card>
        <CardHeader title="Profiles" description="Overlapping effective rate periods block payroll period closure." />
        <FilterBar>
          <Field label="Search" htmlFor="cp-search"><Input id="cp-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or code" className="w-56" /></Field>
          <div className="pb-2"><Checkbox label="Current profiles only" checked={currentOnly} onChange={setCurrentOnly} /></div>
        </FilterBar>
        <QueryState query={{ ...q, data: q.data ? rows : undefined }} empty={(d) => d.length === 0} emptyTitle="No matching profiles">
          {(d) => (
            <Table>
              <THead><tr><TH>Employee</TH><TH>Basis</TH><TH className="text-right">Base rate</TH><TH>Proration</TH><TH>Effective</TH><TH>Policy</TH><TH /></tr></THead>
              <TBody>
                {d.map((r) => (
                  <TR key={r.id} className={r.current ? "" : "opacity-70"}>
                    <TD><span className="block font-medium text-slate-900 dark:text-slate-100">{r.employeeName}</span><span className="text-xs text-slate-500">{r.employeeCode}</span></TD>
                    <TD>{humanize(r.basis)}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(r.baseRate, r.currency)}{r.basis === "HOURLY" ? "/h" : "/mo"}</TD>
                    <TD>{humanize(r.proration)}</TD>
                    <TD className="whitespace-nowrap text-xs">{fmtDate(r.effectiveFrom)} – {r.effectiveTo ? fmtDate(r.effectiveTo) : "open"}</TD>
                    <TD>v{r.policyVersion}</TD>
                    <TD>{r.current ? <Badge tone="green">Current</Badge> : <Badge tone="slate">Historical</Badge>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </QueryState>
      </Card>
    </>
  );
}
