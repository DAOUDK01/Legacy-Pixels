"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ClipboardCheck, UserCog } from "lucide-react";
import { useApiQuery, useLookups } from "@/lib/api/hooks";
import { api, errorMessage } from "@/lib/api/transport";
import type { ReviewQueue, TaskRow } from "@/lib/api/work";
import { fmtDateTime, relativeTime } from "@/lib/time";
import {
  Badge, Button, ButtonLink, Card, CardHeader, ConfirmDialog, EmptyState, Field, PageHeader, QueryState, Select, Table, TBody, TD, TH, THead, TR, Tabs,
} from "@/components/ui";
import { Person, PriorityBadge, StateBadge } from "@/components/domain";
import { useToast } from "@/components/ui/toast";
import { DueText } from "@/components/work/TaskViews";

export default function ReviewsPage() {
  const [scope, setScope] = useState<"mine" | "team">("mine");
  const q = useApiQuery<ReviewQueue>("/reviews", { scope });
  const [reassign, setReassign] = useState<TaskRow | null>(null);

  return (
    <>
      <PageHeader title="Review queue" description="Submitted versions waiting for a decision. Oldest submissions first; reviewer delay never counts against the employee's deadline." />
      <Card>
        <Tabs
          className="px-3"
          value={scope}
          onChange={setScope}
          tabs={[{ value: "mine", label: "Assigned to me" }, ...(q.data?.canSeeTeam || scope === "team" ? [{ value: "team" as const, label: "Team queue" }] : [])]}
        />
        <QueryState query={q} empty={(d) => d.items.length === 0} emptyTitle="Nothing waiting for review" emptyDescription={scope === "mine" ? "Submissions assigned to you will appear here." : "No submitted work in your projects."}>
          {(d) => (
            <Table>
              <THead>
                <tr><TH>Task</TH><TH>Version</TH><TH>Assignee</TH>{scope === "team" && <TH>Reviewer</TH>}<TH>Submitted</TH><TH>Due</TH><TH /></tr>
              </THead>
              <TBody>
                {d.items.map(({ task, submission, selfReview, priorDecisions }) => (
                  <TR key={task.id}>
                    <TD className="min-w-[220px]">
                      <Link href={`/tasks/${task.id}`} className="font-medium hover:underline">{task.title}</Link>
                      <span className="mt-0.5 flex items-center gap-2 text-xs text-slate-500"><span className="font-mono">{task.projectCode}</span><PriorityBadge priority={task.priority} /></span>
                    </TD>
                    <TD>
                      <span className="font-medium">v{submission?.sequence}</span>
                      {priorDecisions > 0 && <span className="block text-xs text-slate-500">{priorDecisions} earlier decision(s)</span>}
                    </TD>
                    <TD><Person id={task.assigneeId} /></TD>
                    {scope === "team" && (
                      <TD>
                        <Person id={task.reviewerId} />
                        {selfReview && <Badge tone="red" className="mt-1"><AlertTriangle className="h-3 w-3" /> Self-review</Badge>}
                      </TD>
                    )}
                    <TD><span title={submission?.submittedAt ? fmtDateTime(submission.submittedAt) : undefined}>{submission?.submittedAt ? relativeTime(submission.submittedAt) : "—"}</span></TD>
                    <TD><DueText task={task} /></TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        {scope === "team" && <Button size="sm" variant="outline" icon={<UserCog className="h-4 w-4" />} onClick={() => setReassign(task)}>Reassign</Button>}
                        {scope === "mine" && !selfReview && <ButtonLink size="sm" variant="primary" href={`/tasks/${task.id}/review`} icon={<ClipboardCheck className="h-4 w-4" />}>Review</ButtonLink>}
                        {scope === "mine" && selfReview && <Badge tone="red">Blocked: own work</Badge>}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </QueryState>
      </Card>

      {q.data && q.data.recent.length > 0 && scope === "mine" && (
        <Card className="mt-6">
          <CardHeader title="Your recent decisions" />
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {q.data.recent.map(({ review, taskTitle, sequence }) => (
              <li key={review.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <Link href={`/tasks/${review.taskId}`} className="hover:underline">{taskTitle} <span className="text-slate-500">v{sequence}</span></Link>
                <span className="flex items-center gap-2">
                  {review.weightedQuality && <Badge tone="green">Q {review.weightedQuality}</Badge>}
                  <StateBadge state={review.decision === "APPROVE" ? "APPROVED" : "REVISION_REQUESTED"} />
                  <span className="text-xs text-slate-500">{relativeTime(review.decidedAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {reassign && <ReassignDialog task={reassign} onClose={() => setReassign(null)} />}
    </>
  );
}

function ReassignDialog({ task, onClose }: { task: TaskRow; onClose: () => void }) {
  const lookups = useLookups();
  const qc = useQueryClient();
  const toast = useToast();
  const [reviewer, setReviewer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = lookups.data?.employees.filter((e) => e.employmentStatus === "ACTIVE" && e.id !== task.assigneeId && e.id !== task.reviewerId) ?? [];
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={`Reassign review: ${task.title}`}
      description="The change is audited and the new reviewer is notified. The reviewer cannot be the assignee."
      confirmLabel="Reassign reviewer"
      requireReason
      loading={busy}
      error={error}
      onConfirm={async (reason) => {
        if (!reviewer) return setError("Choose a reviewer.");
        setBusy(true);
        setError(null);
        try {
          await api.patch(`/tasks/${task.id}`, { reviewerId: reviewer, reason }, { ifMatch: task.version });
          toast({ tone: "success", title: "Reviewer reassigned" });
          qc.invalidateQueries();
          onClose();
        } catch (e) {
          setError(errorMessage(e));
          setBusy(false);
        }
      }}
    >
      <Field label="New reviewer" htmlFor="ra-rev" required>
        <Select id="ra-rev" value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
          <option value="">Choose…</option>
          {options.map((e) => <option key={e.id} value={e.id}>{e.displayName} — {e.title}</option>)}
        </Select>
      </Field>
      {options.length === 0 && <EmptyState title="No eligible reviewers" />}
    </ConfirmDialog>
  );
}
