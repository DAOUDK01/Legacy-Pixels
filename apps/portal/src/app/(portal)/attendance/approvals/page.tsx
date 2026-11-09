"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { useApiMutation, useApiQuery, useMe } from "@/lib/api/hooks";
import type { CorrectionRow } from "@/lib/api/workforce";
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/time";
import { Badge, Button, Card, CardHeader, ConfirmDialog, PageHeader, QueryState, Table, Tabs, TBody, TD, TH, THead, TR } from "@/components/ui";
import { Person, StateBadge } from "@/components/domain";
import { useToast } from "@/components/ui/toast";
import { formError } from "@/components/workforce/common";

type Decision = { row: CorrectionRow; decision: "VALIDATE" | "APPROVE" | "REJECT" };

export default function CorrectionApprovalsPage() {
  const me = useMe();
  const tz = me.data?.organization.timezone ?? "Asia/Karachi";
  const [tab, setTab] = useState<"open" | "all">("open");
  const q = useApiQuery<CorrectionRow[]>("/attendance/corrections", { scope: "team" });
  const [pending, setPending] = useState<Decision | null>(null);
  const toast = useToast();
  const m = useApiMutation("POST", "/attendance/corrections/x/decision", {
    invalidate: ["/attendance", "/me/attendance", "/dashboard"],
    onSuccess: () => {
      toast({ tone: "success", title: "Decision recorded" });
      setPending(null);
    },
  });

  return (
    <>
      <PageHeader
        title="Attendance corrections"
        description="Managers validate the facts; HR approves or rejects. Approval creates a new revision and recomputes affected days — original events are never changed."
        breadcrumbs={[{ label: "Attendance", href: "/attendance" }, { label: "Corrections" }]}
      />
      <Card>
        <Tabs className="px-3" value={tab} onChange={setTab} tabs={[{ value: "open", label: "Needs action", count: q.data?.filter((c) => c.canValidate || c.canApprove).length }, { value: "all", label: "All" }]} />
        <QueryState
          query={q}
          empty={(d) => (tab === "open" ? d.filter((c) => c.canValidate || c.canApprove) : d).length === 0}
          emptyTitle={tab === "open" ? "Nothing waiting for you" : "No corrections in your scope"}
        >
          {(d) => (
            <Table>
              <THead><tr><TH>Employee</TH><TH>Day</TH><TH>Proposed</TH><TH>Reason</TH><TH>Status</TH><TH>Submitted</TH><TH><span className="sr-only">Actions</span></TH></tr></THead>
              <TBody>
                {(tab === "open" ? d.filter((c) => c.canValidate || c.canApprove) : d).map((c) => (
                  <TR key={c.id}>
                    <TD><Person id={c.employeeId} /></TD>
                    <TD className="whitespace-nowrap">{fmtDate(c.businessDate)}</TD>
                    <TD className="whitespace-nowrap text-xs">
                      {c.proposedCheckIn && <span className="block">In {fmtTime(c.proposedCheckIn, tz)}</span>}
                      {c.proposedCheckOut && <span className="block">Out {fmtTime(c.proposedCheckOut, tz)}</span>}
                    </TD>
                    <TD className="max-w-sm text-xs">{c.reason}</TD>
                    <TD>
                      <StateBadge state={c.status} />
                      {c.affectsLockedPayroll && <Badge tone="purple" className="ml-1">Locked period</Badge>}
                    </TD>
                    <TD className="text-xs text-slate-500">{fmtDateTime(c.createdAt, tz)}</TD>
                    <TD>
                      <div className="flex justify-end gap-2">
                        {c.canValidate && <Button size="sm" icon={<Check className="h-3.5 w-3.5" />} onClick={() => setPending({ row: c, decision: "VALIDATE" })}>Validate</Button>}
                        {c.canApprove && <Button size="sm" variant="success" icon={<Check className="h-3.5 w-3.5" />} onClick={() => setPending({ row: c, decision: "APPROVE" })}>Approve</Button>}
                        {(c.canValidate || c.canApprove) && <Button size="sm" variant="outline" icon={<X className="h-3.5 w-3.5" />} onClick={() => setPending({ row: c, decision: "REJECT" })}>Reject</Button>}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </QueryState>
      </Card>
      <ConfirmDialog
        open={!!pending}
        onClose={() => { setPending(null); m.reset(); }}
        title={pending?.decision === "VALIDATE" ? "Validate correction" : pending?.decision === "APPROVE" ? "Approve correction" : "Reject correction"}
        description={pending ? `${pending.row.employeeName} · ${fmtDate(pending.row.businessDate)}` : undefined}
        confirmLabel={pending?.decision === "REJECT" ? "Reject" : pending?.decision === "APPROVE" ? "Approve" : "Validate"}
        tone={pending?.decision === "REJECT" ? "danger" : pending?.decision === "APPROVE" ? "success" : "primary"}
        requireReason={pending?.decision === "REJECT"}
        reasonLabel="Reason shown to the employee"
        loading={m.isPending}
        error={formError(m.error)}
        onConfirm={(reason) => m.mutate({ path: `/attendance/corrections/${pending!.row.id}/decision`, body: { decision: pending!.decision, reason: reason || undefined } })}
      >
        {pending?.row.affectsLockedPayroll && pending.decision === "APPROVE" && (
          <p className="text-sm text-slate-600">This day is in a locked payroll period. Approval will create a proposed adjustment for the next period rather than changing a paid payslip.</p>
        )}
        {pending && <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">{pending.row.reason}</p>}
      </ConfirmDialog>
    </>
  );
}
