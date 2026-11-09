"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { useApiQuery } from "@/lib/api/hooks";
import type { Payslip } from "@/lib/types";
import { fmtDate } from "@/lib/time";
import { Card, CardHeader, Notice, PageHeader, QueryState, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { MoneyText } from "@/components/domain";

export default function PayslipsPage() {
  const router = useRouter();
  const q = useApiQuery<{ items: Payslip[] }>("/me/payslips");
  return (
    <>
      <PageHeader title="My payslips" description="Payslips appear after the owner approves and locks a payroll run. Each line shows its approval reference." />
      <div className="mb-4"><Notice tone="slate" icon={<Lock className="h-4 w-4" />}>Only you can see your payslips. Payroll staff access is logged.</Notice></div>
      <Card>
        <CardHeader title="Published payslips" />
        <QueryState query={q} empty={(d) => d.items.length === 0} emptyTitle="No payslips yet" emptyDescription="Your first payslip will appear here once a payroll run including you is approved.">
          {(d) => (
            <Table>
              <THead><tr><TH>Period</TH><TH>Published</TH><TH className="text-right">Gross</TH><TH className="text-right">Deductions</TH><TH className="text-right">Net</TH><TH /></tr></THead>
              <TBody>
                {d.items.map((p) => (
                  <TR key={p.id} onClick={() => router.push(`/payslips/${p.id}`)}>
                    <TD className="font-medium">{p.periodLabel}</TD>
                    <TD>{fmtDate(p.publishedAt)}</TD>
                    <TD className="text-right"><MoneyText amount={p.gross} currency={p.currency} /></TD>
                    <TD className="text-right"><MoneyText amount={p.deductions} currency={p.currency} /></TD>
                    <TD className="text-right font-semibold"><MoneyText amount={p.net} currency={p.currency} /></TD>
                    <TD><Link href={`/payslips/${p.id}`} className="text-sm font-medium text-brand-600 hover:underline">View</Link></TD>
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
