"use client";

import { use } from "react";
import { Printer } from "lucide-react";
import { useApiQuery } from "@/lib/api/hooks";
import type { Payslip, PayrollRun } from "@/lib/types";
import { formatMoney } from "@/lib/calc/money";
import { fmtDateTime } from "@/lib/time";
import { Badge, Button, Card, CardBody, PageHeader, QueryState, cn } from "@/components/ui";
import { humanize } from "@/components/domain";

interface PayslipResponse {
  payslip: Payslip;
  approval?: PayrollRun["approvals"][number];
  employee?: { displayName: string; employeeCode: string; title: string };
  organization: string;
}

export default function PayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useApiQuery<PayslipResponse>(`/payslips/${id}`);
  return (
    <QueryState query={q}>
      {({ payslip: p, approval, employee, organization }) => (
        <>
          <div className="print:hidden">
            <PageHeader
              breadcrumbs={[{ label: "My payslips", href: "/payslips" }, { label: p.periodLabel }]}
              title={`Payslip · ${p.periodLabel}`}
              actions={<Button variant="outline" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print / save PDF</Button>}
            />
          </div>
          <Card className="mx-auto max-w-3xl print:border-0 print:shadow-none">
            <CardBody className="space-y-6 p-6 sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
                <div>
                  <p className="text-lg font-semibold">{organization}</p>
                  <p className="text-sm text-slate-500">Payslip for {p.periodLabel}</p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-medium">{employee?.displayName}</p>
                  <p className="text-slate-500">{employee?.employeeCode} · {employee?.title}</p>
                </div>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500 dark:border-slate-800">
                    <th className="py-2">Category</th><th className="py-2">Description</th><th className="py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {p.lines.map((l, i) => (
                    <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-2 pr-3"><Badge tone={l.category === "DEDUCTION" ? "red" : "slate"}>{humanize(l.category)}</Badge></td>
                      <td className="py-2 pr-3">{l.description}</td>
                      <td className={cn("py-2 text-right tabular-nums", l.category === "DEDUCTION" && "text-red-600")}>{formatMoney(l.category === "DEDUCTION" ? `-${l.amount}` : l.amount, p.currency)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="text-sm">
                  <tr><td colSpan={2} className="pt-3 text-right text-slate-500">Gross</td><td className="pt-3 text-right tabular-nums">{formatMoney(p.gross, p.currency)}</td></tr>
                  <tr><td colSpan={2} className="text-right text-slate-500">Deductions</td><td className="text-right tabular-nums">-{formatMoney(p.deductions, p.currency)}</td></tr>
                  <tr><td colSpan={2} className="pt-2 text-right font-semibold">Net payable</td><td className="pt-2 text-right text-base font-semibold tabular-nums">{formatMoney(p.net, p.currency)}</td></tr>
                </tfoot>
              </table>
              <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <p>Approval reference: <span className="font-mono">{p.approvalId}</span>{approval && <> · approved {fmtDateTime(approval.approvedAt)} · hash <span className="font-mono">{approval.inputHash}</span></>}</p>
                <p className="mt-1">Published {fmtDateTime(p.publishedAt)}. This payslip is an immutable snapshot; corrections appear as linked adjustments in a later period. Downloads are identified and access-logged.</p>
              </div>
            </CardBody>
          </Card>
        </>
      )}
    </QueryState>
  );
}
