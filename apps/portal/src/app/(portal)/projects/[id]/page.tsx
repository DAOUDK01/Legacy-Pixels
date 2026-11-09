"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Ban, CheckCircle2, Columns3, List, Pause, Pencil, Play, Plus, RotateCcw } from "lucide-react";
import { useApiQuery } from "@/lib/api/hooks";
import { api, ApiError, errorMessage } from "@/lib/api/transport";
import { TRANSITION_LABELS, type ProjectDetail } from "@/lib/api/work";
import { fmtDate, fmtDateTime, relativeTime } from "@/lib/time";
import {
  Badge, Button, ButtonLink, Card, CardBody, CardHeader, ConfirmDialog, DL, EmptyState, Notice, PageHeader, Progress, QueryState, Stat, Tabs, Timeline, cn,
} from "@/components/ui";
import { Person, StateBadge, VersionConflictDialog } from "@/components/domain";
import { useToast } from "@/components/ui/toast";
import { TaskBoard, TaskTable } from "@/components/work/TaskViews";
import { MediaList } from "@/components/work/MediaList";
import { ProjectFormDialog } from "@/components/work/ProjectForm";

type Tab = "overview" | "tasks" | "deliverables" | "members" | "activity" | "settings";

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const q = useApiQuery<ProjectDetail>(`/projects/${id}`);
  return <QueryState query={q} rows={10}>{(d) => <Workspace d={d} />}</QueryState>;
}

function Workspace({ d }: { d: ProjectDetail }) {
  const { project: p } = d;
  const [tab, setTab] = useState<Tab>("overview");
  const [view, setView] = useState<"list" | "board">("board");
  const now = Date.now();
  const open = d.tasks.filter((t) => !["APPROVED", "COMPLETED", "CANCELLED"].includes(t.state));
  const overdue = open.filter((t) => t.state !== "SUBMITTED" && Date.parse(t.dueAt) < now);
  const points = (ts: typeof d.tasks) => ts.reduce((a, t) => a + Number(t.baselinePoints), 0);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Projects", href: "/projects" }, { label: p.code }]}
        title={<span className="flex flex-wrap items-center gap-3">{p.name} <StateBadge state={p.state} /></span>}
        description={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{p.code}</span>{p.externalReference && <><span>·</span><span>{p.externalReference}</span></>}<span>·</span>{fmtDate(p.plannedStart)} – {fmtDate(p.plannedEnd)}</span>}
        actions={d.permissions.canCreateTask && <ButtonLink href={`/tasks/new?projectId=${p.id}`} variant="primary" icon={<Plus className="h-4 w-4" />}>New task</ButtonLink>}
      />
      {p.state === "ARCHIVED" && <div className="mb-4"><Notice tone="slate">Archived {p.archivedAt ? fmtDate(p.archivedAt) : ""}. Read access is preserved; unarchive before making changes.</Notice></div>}
      {p.state === "ON_HOLD" && <div className="mb-4"><Notice tone="amber">This project is on hold.</Notice></div>}
      <Card>
        <Tabs
          className="px-3"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "overview", label: "Overview" },
            { value: "tasks", label: "Tasks", count: d.tasks.length },
            { value: "deliverables", label: "Deliverables", count: d.deliverables.length },
            { value: "members", label: "Members", count: p.memberIds.length },
            { value: "activity", label: "Activity" },
            ...(d.permissions.transitions.length || d.permissions.canManage ? [{ value: "settings" as const, label: "Settings" }] : []),
          ]}
        />
        {tab === "overview" && (
          <CardBody className="space-y-6">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat label="Completion" value={`${p.taskCounts.completed}/${p.taskCounts.total}`} hint={<Progress value={p.taskCounts.completed} max={p.taskCounts.total || 1} tone="green" />} />
              <Stat label="Open tasks" value={open.length} hint={`${points(open)} planned points`} />
              <Stat label="Overdue" value={<span className={overdue.length ? "text-red-600" : ""}>{overdue.length}</span>} />
              <Stat label="Awaiting review" value={d.tasks.filter((t) => t.state === "SUBMITTED").length} />
            </div>
            <DL
              items={[
                { label: "Manager", value: <Person id={p.managerId} showTitle /> },
                { label: "Target dates", value: `${fmtDate(p.plannedStart)} – ${fmtDate(p.plannedEnd)}` },
                { label: "Description", value: p.brief || "—" },
                { label: "Accepted output", value: `${points(d.tasks.filter((t) => ["APPROVED", "COMPLETED"].includes(t.state)))} of ${points(d.tasks.filter((t) => t.state !== "CANCELLED"))} points` },
              ]}
            />
            {d.tasks.some((t) => t.state === "BLOCKED") && (
              <div>
                <p className="mb-2 text-sm font-semibold">Blocked work</p>
                <ul className="space-y-1 text-sm">
                  {d.tasks.filter((t) => t.state === "BLOCKED").map((t) => (
                    <li key={t.id}><Link href={`/tasks/${t.id}`} className="font-medium hover:underline">{t.title}</Link> <span className="text-slate-500">— {t.blocker?.reason} ({t.blocker?.responsibleParty})</span></li>
                  ))}
                </ul>
              </div>
            )}
          </CardBody>
        )}
        {tab === "tasks" && (
          <>
            <div className="flex justify-end px-5 pt-3">
              <div className="flex rounded-md border border-slate-200 p-0.5 dark:border-slate-700" role="group" aria-label="View">
                <button aria-pressed={view === "board"} onClick={() => setView("board")} className={cn("flex items-center gap-1.5 rounded px-2.5 py-1 text-sm", view === "board" ? "bg-slate-100 font-medium dark:bg-slate-800" : "text-slate-500")}><Columns3 className="h-4 w-4" /> Board</button>
                <button aria-pressed={view === "list"} onClick={() => setView("list")} className={cn("flex items-center gap-1.5 rounded px-2.5 py-1 text-sm", view === "list" ? "bg-slate-100 font-medium dark:bg-slate-800" : "text-slate-500")}><List className="h-4 w-4" /> List</button>
              </div>
            </div>
            {d.tasks.length === 0 ? <EmptyState title="No tasks yet" action={d.permissions.canCreateTask && <ButtonLink href={`/tasks/new?projectId=${p.id}`} variant="primary">Create the first task</ButtonLink>} /> : view === "board" ? <TaskBoard tasks={d.tasks} showProject={false} /> : <TaskTable tasks={d.tasks} showProject={false} />}
          </>
        )}
        {tab === "deliverables" && (
          <CardBody>
            {d.deliverables.length === 0 ? <EmptyState title="No approved deliverables yet" description="Approved submission versions appear here." /> : (
              <ul className="space-y-4">
                {d.deliverables.map(({ review, submission, task }) => (
                  <li key={review.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <Link href={`/tasks/${task.id}`} className="font-medium hover:underline">{task.title} <span className="text-slate-500">v{submission.sequence}</span></Link>
                      <span className="flex items-center gap-2 text-xs text-slate-500">{review.weightedQuality && <Badge tone="green">Q {review.weightedQuality}</Badge>} approved {fmtDateTime(review.decidedAt)} by <Person id={review.reviewerId} size={16} /></span>
                    </div>
                    <MediaList media={submission.media} compact />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        )}
        {tab === "members" && (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {[p.managerId, ...p.memberIds.filter((m) => m !== p.managerId)].map((m) => {
              const ts = d.tasks.filter((t) => t.assigneeId === m && !["COMPLETED", "CANCELLED"].includes(t.state));
              return (
                <li key={m} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <Person id={m} showTitle size={32} />
                  <span className="flex items-center gap-2 text-xs text-slate-500">
                    {m === p.managerId && <Badge tone="blue">Manager</Badge>}
                    {ts.length} open task(s) · {ts.reduce((a, t) => a + Number(t.baselinePoints), 0)} pts
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {tab === "activity" && (
          <CardBody>
            <Timeline
              items={d.activity.map((a) => ({
                id: a.id,
                title: a.taskId ? <Link href={`/tasks/${a.taskId}`} className="hover:underline">{a.title}</Link> : a.title,
                meta: <span className="inline-flex items-center gap-2">{a.actorId ? <Person id={a.actorId} size={16} /> : a.actorLabel} · {relativeTime(a.at)}</span>,
                body: a.reason,
                tone: a.kind === "project" ? "purple" : "blue",
              }))}
            />
          </CardBody>
        )}
        {tab === "settings" && <Settings d={d} />}
      </Card>
    </>
  );
}

const T_ICONS: Record<string, React.ReactNode> = {
  activate: <Play className="h-4 w-4" />,
  hold: <Pause className="h-4 w-4" />,
  complete: <CheckCircle2 className="h-4 w-4" />,
  reopen: <RotateCcw className="h-4 w-4" />,
  archive: <Archive className="h-4 w-4" />,
  unarchive: <ArchiveRestore className="h-4 w-4" />,
  cancel: <Ban className="h-4 w-4" />,
};
const T_REASON = new Set(["hold", "reopen", "unarchive", "cancel"]);
const T_DESC: Record<string, string> = {
  activate: "Opens the project for assigned work.",
  hold: "Pauses the project. Tasks keep their state.",
  complete: "Requires every task to be completed or explicitly cancelled, with no pending reviews or transfers.",
  reopen: "Returns a completed project to active.",
  archive: "Disables new work. Read access is preserved under existing policy.",
  unarchive: "Allows modification again.",
  cancel: "Cancels the project. History is preserved.",
};

function Settings({ d }: { d: ProjectDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [action, setAction] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ApiError | null>(null);
  const p = d.project;
  const run = async (reason: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/projects/${p.id}/transitions`, { action, reason: reason || undefined }, { ifMatch: p.version });
      toast({ tone: "success", title: `${TRANSITION_LABELS[action!] ?? action}: done` });
      setAction(null);
      qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && /^\/(projects|lookups|dashboard)/.test(q.queryKey[0] as string) });
    } catch (e) {
      if (e instanceof ApiError && e.code === "VERSION_CONFLICT") {
        setAction(null);
        setConflict(e);
      } else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <CardBody className="space-y-6">
      {d.permissions.canManage && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
          <div>
            <p className="text-sm font-medium">Project details</p>
            <p className="text-xs text-slate-500">Title, description, manager, members and target dates.</p>
          </div>
          <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit details</Button>
        </div>
      )}
      <div>
        <CardHeader className="px-0" title="Lifecycle" description="Draft → Active ⇄ On hold → Completed → Archived. Cancellation and reopening require a reason." />
        <div className="mt-3 flex flex-wrap gap-2">
          {d.permissions.transitions.length === 0 && <p className="text-sm text-slate-500">No lifecycle actions available to you.</p>}
          {d.permissions.transitions.map((t) => (
            <Button key={t} variant={t === "cancel" ? "outline" : "secondary"} className={t === "cancel" ? "text-red-700" : undefined} icon={T_ICONS[t]} onClick={() => { setError(null); setAction(t); }}>
              {TRANSITION_LABELS[t] ?? t}
            </Button>
          ))}
        </div>
      </div>
      <ConfirmDialog
        open={!!action}
        onClose={() => setAction(null)}
        onConfirm={run}
        title={`${TRANSITION_LABELS[action ?? ""] ?? ""} ${p.code}`}
        description={action ? T_DESC[action] : undefined}
        confirmLabel={TRANSITION_LABELS[action ?? ""] ?? "Confirm"}
        tone={action === "cancel" ? "danger" : "primary"}
        requireReason={!!action && T_REASON.has(action) && !(action === "cancel" && p.state === "DRAFT")}
        loading={busy}
        error={error}
      />
      {editing && <ProjectFormDialog project={p} onClose={() => setEditing(false)} />}
      <VersionConflictDialog
        error={conflict}
        mine={p as unknown as Record<string, unknown>}
        fields={["state", "name", "managerId", "version"]}
        onClose={() => setConflict(null)}
        onReload={() => {
          setConflict(null);
          qc.invalidateQueries({ queryKey: [`/projects/${p.id}`] });
        }}
      />
    </CardBody>
  );
}
