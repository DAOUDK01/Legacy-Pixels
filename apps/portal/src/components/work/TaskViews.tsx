"use client";

import Link from "next/link";
import { AlertTriangle, Link2 } from "lucide-react";
import type { TaskState } from "@/lib/types";
import type { TaskRow } from "@/lib/api/work";
import { fmtDateTime, isOverdue } from "@/lib/time";
import { Badge, EmptyState, Table, TBody, TD, TH, THead, TR, cn } from "@/components/ui";
import { Person, PriorityBadge, StateBadge, humanize } from "@/components/domain";

const OPEN: TaskState[] = ["DRAFT", "ASSIGNED", "IN_PROGRESS", "BLOCKED", "REVISION_REQUESTED"];

export function DueText({ task }: { task: Pick<TaskRow, "dueAt" | "baselineDueAt" | "state"> }) {
  const overdue = OPEN.includes(task.state) && isOverdue(task.dueAt);
  const moved = task.baselineDueAt !== task.dueAt;
  return (
    <span className={cn("whitespace-nowrap", overdue && "font-medium text-red-600")}>
      {fmtDateTime(task.dueAt)}
      {overdue && <span className="ml-1 text-xs">(overdue)</span>}
      {moved && <span className="block text-[11px] text-slate-500" title="Agreed baseline due date">Baseline {fmtDateTime(task.baselineDueAt)}</span>}
    </span>
  );
}

export function TaskTable({ tasks, showProject = true }: { tasks: TaskRow[]; showProject?: boolean }) {
  if (!tasks.length) return <EmptyState title="No tasks match" description="Try clearing filters." />;
  return (
    <Table>
      <THead>
        <tr>
          <TH>Task</TH>
          {showProject && <TH>Project</TH>}
          <TH>Status</TH>
          <TH>Priority</TH>
          <TH>Assignee</TH>
          <TH>Reviewer</TH>
          <TH className="text-right">Points</TH>
          <TH>Due</TH>
        </tr>
      </THead>
      <TBody>
        {tasks.map((t) => (
          <TR key={t.id}>
            <TD className="min-w-[220px]">
              <Link href={`/tasks/${t.id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline dark:text-slate-100">{t.title}</Link>
              {t.dependencyBlocked && t.state === "ASSIGNED" && (
                <span className="mt-0.5 flex items-center gap-1 text-xs text-amber-700"><Link2 className="h-3 w-3" /> Waiting on predecessors</span>
              )}
            </TD>
            {showProject && <TD><span className="font-mono text-xs text-slate-500">{t.projectCode}</span></TD>}
            <TD><StateBadge state={t.state} /></TD>
            <TD><PriorityBadge priority={t.priority} /></TD>
            <TD><Person id={t.assigneeId} /></TD>
            <TD><Person id={t.reviewerId} /></TD>
            <TD className="text-right tabular-nums">{Number(t.baselinePoints)}</TD>
            <TD><DueText task={t} /></TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

const COLUMNS: { state: TaskState; label: string }[] = [
  { state: "DRAFT", label: "Draft" },
  { state: "ASSIGNED", label: "Assigned" },
  { state: "IN_PROGRESS", label: "In progress" },
  { state: "BLOCKED", label: "Blocked" },
  { state: "SUBMITTED", label: "Submitted" },
  { state: "REVISION_REQUESTED", label: "Revision" },
  { state: "APPROVED", label: "Approved" },
  { state: "COMPLETED", label: "Completed" },
];

/** Read-only kanban; state changes happen through explicit, validated transitions on the task page. */
export function TaskBoard({ tasks, showProject = true }: { tasks: TaskRow[]; showProject?: boolean }) {
  return (
    <div className="flex gap-3 overflow-x-auto p-4" role="list" aria-label="Task board">
      {COLUMNS.map((col) => {
        const items = tasks.filter((t) => t.state === col.state);
        return (
          <section key={col.state} aria-label={col.label} className="flex w-64 shrink-0 flex-col rounded-lg bg-slate-50 dark:bg-slate-950/60">
            <header className="flex items-center justify-between px-3 py-2">
              <StateBadge state={col.state} label={col.label} />
              <span className="text-xs text-slate-500">{items.length}</span>
            </header>
            <ul className="flex-1 space-y-2 px-2 pb-3">
              {items.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/tasks/${t.id}`}
                    className="block rounded-md border border-slate-200 bg-white p-3 shadow-sm transition hover:border-brand-300 hover:shadow dark:border-slate-800 dark:bg-slate-900"
                  >
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{t.title}</p>
                    {showProject && <p className="mt-0.5 font-mono text-[11px] text-slate-500">{t.projectCode}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <PriorityBadge priority={t.priority} />
                      <Badge tone="slate">{Number(t.baselinePoints)} pts</Badge>
                      {t.state === "BLOCKED" && <Badge tone="red"><AlertTriangle className="h-3 w-3" /> {t.blocker?.responsibleParty ?? "Blocked"}</Badge>}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
                      <Person id={t.assigneeId} size={20} />
                    </div>
                    <p className={cn("mt-1 text-[11px]", OPEN.includes(t.state) && isOverdue(t.dueAt) ? "font-medium text-red-600" : "text-slate-500")}>Due {fmtDateTime(t.dueAt)}</p>
                  </Link>
                </li>
              ))}
              {items.length === 0 && <li className="px-2 py-4 text-center text-xs text-slate-400">No tasks</li>}
            </ul>
          </section>
        );
      })}
      {tasks.some((t) => t.state === "CANCELLED") && (
        <p className="self-start whitespace-nowrap px-2 text-xs text-slate-500">{tasks.filter((t) => t.state === "CANCELLED").length} cancelled task(s) hidden from the board ({humanize("CANCELLED")}).</p>
      )}
    </div>
  );
}
