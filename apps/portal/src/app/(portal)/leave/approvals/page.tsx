"use client";

import { useState } from "react";
import { FileText, Lock } from "lucide-react";
import { useApiMutation, useApiQuery } from "@/lib/api/hooks";
import { fmtDays, type LeaveBalance, type LeaveRequestRow } from "@/lib/api/workforce";
import { fmtDate, fmtMinutes, relativeTime } from "@/lib/time";
import { Button, Card, CardHeader, ConfirmDialog, PageHeader, QueryState, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { Person, StateBadge, humanize } from "@/components/domain";
import { useToast } from "@/components/ui/toast";
import { formError } from "@/components/workforce/common";

type Action = "RECOMMEND" | "NOT_RECOMMENDED" | "APPROVE" | "REJECT";

export default function LeaveApprovalsPage() {
  const q = useApiQuery<LeaveRequestRow[]>("/leave-requests", { scope: "approvals" });
  const [pending, setPending] = useState<{ row: LeaveRequestRow; action: Action } | null>(null);
  const toast = useToast();
  const m = useApiMutation("POST", "/leave-requests/x/decision", {
    invalidate: ["/leave", "/leave-requests", "/dashboard", "/attendance"],
    onSuccess: () => {
      toast({ tone: "success", title: "Decision recorded" });
      setPending(null);
    },
  });
  const balances = useApiQuery<{ balances: LeaveBalance[] }>(pending ? "/leave/balances" : null, { employeeId: pending?.row.employeeId });
  const bal = balances.data?.balances.find((b) => b.type.id === pending?.row.typeId);

  return (
    <>
      <PageHeader
        title="Leave approvals"
        description="Managers review coverage; HR confirms type and balance. Approval reserves or consumes balance in one transaction, so competing requests can't overspend."
        breadcrumbs={[{ label: "Leave", href: "/leave" }, { label: "Approvals" }]}
      />
      <Card>
        <CardHeader title="Waiting for a decision" />
        <QueryState query={q} empty={(d) => d.length === 0} emptyTitle="No leave requests need your decision">
          {(rows) => (
            <Table>
              <THead><tr><TH>Employee</TH><TH>Type</TH><TH>Dates</TH><TH className="text-right">Duration</TH><TH>Manager</TH><TH>Note</TH><TH>Requested</TH><TH><span className="sr-only">Actions</span></TH></tr></THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD><Person id={r.employeeId} /></TD>
                    <TD>{r.typeName}{r.hasDocument && <FileText className="ml-1 inline h-3.5 w-3.5 text-slate-400" aria-label="Restricted document attached" />}</TD>
                    <TD className="whitespace-nowrap">{fmtDate(r.startDate)}{r.endDate !== r.startDate && <> – {fmtDate(r.endDate)}</>}</TD>
                    <TD className="text-right tabular-nums">{r.partialMinutes ? fmtMinutes(r.requestedMinutes) : fmtDays(r.requestedMinutes)}</TD>
                    <TD className="text-xs">{r.managerDecision ? <StateBadge state={r.managerDecision.decision === "RECOMMEND" ? "APPROVED" : "REJECTED"} label={humanize(r.managerDecision.decision)} /> : <span className="text-slate-400">Awaiting</span>}</TD>
                    <TD className="max-w-[200px] text-xs">{r.note ? <span className="line-clamp-2">{r.note}</span> : r.noteHidden ? <span className="flex items-center gap-1 text-slate-400"><Lock className="h-3 w-3" /> HR only</span> : "—"}</TD>
                    <TD className="text-xs text-slate-500">{relativeTime(r.createdAt)}</TD>
                    <TD>
                      <div className="flex justify-end gap-2">
                        {r.canRecommend && <>
                          <Button size="sm" onClick={() => setPending({ row: r, action: "RECOMMEND" })}>Recommend</Button>
                          <Button size="sm" variant="outline" onClick={() => setPending({ row: r, action: "NOT_RECOMMENDED" })}>Not recommended</Button>
                        </>}
                        {r.canDecide && <>
                          <Button size="sm" variant="success" onClick={() => setPending({ row: r, action: "APPROVE" })}>Approve</Button>
                          <Button size="sm" variant="outline" onClick={() => setPending({ row: r, action: "REJECT" })}>Reject</Button>
                        </>}
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
        title={pending ? `${humanize(pending.action)} — ${pending.row.employeeName}` : ""}
        description={pending ? `${pending.row.typeName}, ${fmtDate(pending.row.startDate)}${pending.row.endDate !== pending.row.startDate ? ` – ${fmtDate(pending.row.endDate)}` : ""}` : undefined}
        confirmLabel={pending ? humanize(pending.action) : "Confirm"}
        tone={pending?.action === "APPROVE" ? "success" : pending?.action === "REJECT" || pending?.action === "NOT_RECOMMENDED" ? "danger" : "primary"}
        requireReason={pending?.action === "REJECT" || pending?.action === "NOT_RECOMMENDED"}
        loading={m.isPending}
        error={formError(m.error)}
        onConfirm={(reason) => m.mutate({ path: `/leave-requests/${pending!.row.id}/decision`, body: { action: pending!.action, reason: reason || undefined } })}
      >
        {pending && bal && (pending.action === "APPROVE" || pending.action === "RECOMMEND") && (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Balance before: <strong>{fmtDays(bal.availableMinutes)}</strong> · after approval: <strong className={bal.availableMinutes - pending.row.requestedMinutes < 0 ? "text-red-600" : ""}>{fmtDays(bal.availableMinutes - pending.row.requestedMinutes)}</strong>
            {bal.availableMinutes - pending.row.requestedMinutes < 0 && !bal.type.allowNegative && " — approval will be blocked (negative balance not permitted)."}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}
