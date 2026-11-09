"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ClipboardCheck, Link2, MessageSquare, Pencil, Plus, X } from "lucide-react";
import { useApiQuery, useLookups, useMe } from "@/lib/api/hooks";
import { api, ApiError, errorMessage } from "@/lib/api/transport";
import { PRIORITIES, type TaskDetail, type TaskList } from "@/lib/api/work";
import type { TaskEvent } from "@/lib/types";
import { businessDate, fmtDate, fmtDateTime, fmtMinutes, relativeTime, zonedToUtc } from "@/lib/time";
import { RUBRIC_V1 } from "@/lib/calc/rubric";
import {
  Badge, Button, ButtonLink, Card, CardBody, CardHeader, Checkbox, DL, Dialog, Field, InlineError, Input, Notice, PageHeader,
  QueryState, Select, Table, TBody, TD, TH, THead, TR, Tabs, Textarea, Timeline,
} from "@/components/ui";
import { Person, PriorityBadge, StateBadge, VersionConflictDialog, humanize } from "@/components/domain";
import { useToast } from "@/components/ui/toast";
import { TaskTransitions } from "@/components/work/TaskTransitions";
import { SubmissionComposer } from "@/components/work/SubmissionComposer";
import { MediaList } from "@/components/work/MediaList";
import { DueText } from "@/components/work/TaskViews";

const PENDING = ["INITIATED", "RECEIVING", "SCANNING", "TRANSFERRING"];

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const q = useApiQuery<TaskDetail>(`/tasks/${id}`, undefined, {
    refetchInterval: (query) => (query.state.data?.submissions.some((s) => s.state === "DRAFT" && s.media.some((m) => PENDING.includes(m.state))) ? 1500 : false),
  });
  return (
    <QueryState query={q} rows={10}>
      {(d) => <TaskView d={d} />}
    </QueryState>
  );
}

function eventTone(e: TaskEvent) {
  if (["approve", "complete"].includes(e.transition)) return "green" as const;
  if (["request_revision", "reopen", "block"].includes(e.transition)) return "amber" as const;
  if (e.transition === "cancel") return "red" as const;
  if (e.transition === "submit") return "purple" as const;
  return "blue" as const;
}

function TaskView({ d }: { d: TaskDetail }) {
  const { task, permissions: perm } = d;
  const me = useMe();
  const [tab, setTab] = useState<"submissions" | "comments" | "worklogs" | "history">("submissions");
  const [editing, setEditing] = useState(false);
  const latestRevision = d.reviews.find((r) => r.decision === "REQUEST_REVISION");
  const latestReview = d.reviews[0];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Projects", href: "/projects" }, { label: d.project.code, href: `/projects/${d.project.id}` }, { label: task.title }]}
        title={<span className="flex flex-wrap items-center gap-3">{task.title} <StateBadge state={task.state} /></span>}
        description={<span className="flex flex-wrap items-center gap-2">{d.project.name} <span className="text-slate-400">·</span> <PriorityBadge priority={task.priority} /> <span className="text-xs text-slate-500">v{task.version}</span></span>}
        actions={
          <>
            {perm.canReview && <ButtonLink href={`/tasks/${task.id}/review`} variant="primary" icon={<ClipboardCheck className="h-4 w-4" />}>Review submission</ButtonLink>}
            {perm.canEdit && <Button variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit</Button>}
          </>
        }
      />
      <div className="mb-6"><TaskTransitions detail={d} /></div>

      {d.project.state === "ARCHIVED" && <div className="mb-4"><Notice tone="slate">This project is archived. The task is read-only until the project is unarchived.</Notice></div>}
      {task.state === "BLOCKED" && task.blocker && (
        <div className="mb-4"><Notice tone="red" icon={<AlertTriangle className="h-4 w-4" />} title="Blocked">{task.blocker.reason} — responsible: {task.blocker.responsibleParty}. Resumes to {humanize(task.resumeState ?? "IN_PROGRESS").toLowerCase()}.</Notice></div>
      )}
      {perm.dependencyBlocked && task.state === "ASSIGNED" && (
        <div className="mb-4"><Notice tone="amber" icon={<Link2 className="h-4 w-4" />} title="Waiting on predecessors">Work can start once blocking tasks are complete, unless your manager records an override.</Notice></div>
      )}
      {perm.selfReviewBlocked && <div className="mb-4"><Notice tone="amber">Assignee and reviewer are the same person. Approval is blocked until the manager reassigns the review.</Notice></div>}
      {task.state === "REVISION_REQUESTED" && latestRevision && (perm.isAssignee || perm.isManager) && (
        <div className="mb-4">
          <Notice tone="amber" title={`Revision requested on v${d.submissions.find((s) => s.id === latestRevision.submissionId)?.sequence ?? "?"}`}>
            <p className="whitespace-pre-wrap">{latestRevision.feedback}</p>
            <ul className="mt-2 space-y-0.5 text-xs">
              {task.acceptanceChecklist.map((c) => <li key={c.id}>{latestRevision.checklist[c.id] ? "✓" : "✗"} {c.label}</li>)}
            </ul>
          </Notice>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Brief & acceptance criteria" description={`Rubric v${task.rubricVersion} is fixed for this task.`} />
            <CardBody className="space-y-4">
              <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{task.brief || <span className="text-slate-400">No brief yet.</span>}</p>
              <ul className="space-y-1.5">
                {task.acceptanceChecklist.map((c) => (
                  <li key={c.id} className="flex items-start gap-2 text-sm">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                    {c.label}
                    {latestReview?.decision === "APPROVE" && latestReview.checklist[c.id] && <Badge tone="green">met</Badge>}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          {perm.canSubmit && <SubmissionComposer detail={d} />}

          <Card>
            <Tabs
              className="px-3"
              value={tab}
              onChange={setTab}
              tabs={[
                { value: "submissions", label: "Submissions", count: d.submissions.filter((s) => s.state !== "DRAFT").length },
                { value: "comments", label: "Comments", count: d.comments.length },
                { value: "worklogs", label: "Work logs", count: d.workLogs.length },
                { value: "history", label: "History" },
              ]}
            />
            <CardBody>
              {tab === "submissions" && <SubmissionTimeline d={d} />}
              {tab === "comments" && <Comments d={d} />}
              {tab === "worklogs" && <WorkLogs d={d} tz={me.data?.organization.timezone} />}
              {tab === "history" && (
                <div className="space-y-6">
                  <Timeline
                    items={d.events.map((e) => ({
                      id: e.id,
                      tone: eventTone(e),
                      title: <span>{humanize(e.transition)} {e.fromState !== e.toState && <span className="text-slate-500">· {e.fromState ? `${humanize(e.fromState)} → ` : ""}{humanize(e.toState)}</span>}</span>,
                      meta: <span className="inline-flex items-center gap-2"><Person id={e.actorId} size={16} /> {fmtDateTime(e.occurredAt)} · v{e.resultingVersion}</span>,
                      body: e.reason,
                    }))}
                  />
                  {d.audit.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Audit</p>
                      <ul className="space-y-1 text-xs text-slate-600">
                        {d.audit.map((a) => <li key={a.id}><span className="font-mono">{a.action}</span> by {a.actorLabel} · {fmtDateTime(a.occurredAt)}{a.reason ? ` — ${a.reason}` : ""}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DL
                cols={1}
                items={[
                  { label: "Assignee", value: <Person id={task.assigneeId} showTitle /> },
                  { label: "Reviewer", value: <Person id={task.reviewerId} showTitle /> },
                  { label: "Due", value: <DueText task={task} /> },
                  { label: "Output points", value: <span>{Number(task.baselinePoints)} <span className="text-xs text-slate-500">(baseline v{task.baselineVersion})</span></span> },
                  { label: "Estimate", value: task.estimateMinutes ? fmtMinutes(task.estimateMinutes) : <span className="text-slate-500">No estimate — {task.noEstimateReason ?? "—"}</span> },
                  { label: "Logged", value: fmtMinutes(d.workLogs.reduce((a, w) => a + w.durationMinutes, 0)) },
                  { label: "Started", value: task.actualStartAt ? fmtDateTime(task.actualStartAt) : "—" },
                  { label: "Project", value: <Link className="text-brand-700 hover:underline" href={`/projects/${d.project.id}`}>{d.project.code} · {d.project.name}</Link> },
                ]}
              />
            </CardBody>
          </Card>
          <Dependencies d={d} />
        </div>
      </div>
      {editing && <EditTaskDialog d={d} onClose={() => setEditing(false)} />}
    </>
  );
}

function SubmissionTimeline({ d }: { d: TaskDetail }) {
  const subs = d.submissions.filter((s) => s.state !== "DRAFT");
  if (!subs.length) return <p className="text-sm text-slate-500">No versions submitted yet.</p>;
  return (
    <ol className="space-y-5">
      {subs.map((s) => {
        const review = d.reviews.find((r) => r.submissionId === s.id);
        return (
          <li key={s.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold">Version {s.sequence} <StateBadge state={s.state} /></p>
              <p className="text-xs text-slate-500">Submitted {s.submittedAt ? fmtDateTime(s.submittedAt) : "—"} by <Person id={s.authorId} size={16} /></p>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{s.summary}</p>
            <div className="mt-3"><MediaList media={s.media} compact /></div>
            {review ? (
              <div className={`mt-3 rounded-md p-3 text-sm ${review.decision === "APPROVE" ? "bg-emerald-50 dark:bg-emerald-950/40" : "bg-amber-50 dark:bg-amber-950/40"}`}>
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {review.decision === "APPROVE" ? "Approved" : review.rejected ? "Rejected — revision requested" : "Revision requested"}
                  {review.weightedQuality && <Badge tone="green">Quality {review.weightedQuality}</Badge>}
                  <span className="text-xs font-normal text-slate-500">by <Person id={review.reviewerId} size={16} /> · {fmtDateTime(review.decidedAt)}</span>
                </p>
                {review.rubricScores && (
                  <p className="mt-1 text-xs text-slate-600">
                    {RUBRIC_V1.items.map((i) => `${i.label} ${review.rubricScores![i.key]}`).join(" · ")}
                  </p>
                )}
                <p className="mt-1 whitespace-pre-wrap">{review.feedback}</p>
              </div>
            ) : s.state === "SUBMITTED" ? (
              <p className="mt-3 text-xs text-slate-500">Awaiting review.</p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function Comments({ d }: { d: TaskDetail }) {
  const [body, setBody] = useState("");
  const [anchor, setAnchor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const post = async () => {
    if (!body.trim()) return setError("Write a comment.");
    setBusy(true);
    setError(null);
    try {
      await api.post(`/tasks/${d.task.id}/comments`, { body, anchor: anchor ? { submissionId: anchor } : undefined });
      setBody("");
      qc.invalidateQueries({ queryKey: [`/tasks/${d.task.id}`] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      {d.comments.length === 0 && <p className="text-sm text-slate-500">No comments yet.</p>}
      <ul className="space-y-4">
        {d.comments.map((c) => (
          <li key={c.id} className="flex gap-3">
            <MessageSquare className="mt-1 h-4 w-4 shrink-0 text-slate-300" />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <Person id={c.authorId} size={18} /> {relativeTime(c.createdAt)}
                {c.anchor && <Badge tone="purple">on v{d.submissions.find((s) => s.id === c.anchor?.submissionId)?.sequence ?? "?"}</Badge>}
                {c.editedAt && <span>(edited)</span>}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>
            </div>
          </li>
        ))}
      </ul>
      {d.permissions.canComment && (
        <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <Field label="Add a comment" htmlFor="cm-body" error={error ?? undefined}>
            <Textarea id="cm-body" value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Select aria-label="Attach comment to version" className="w-48" value={anchor} onChange={(e) => setAnchor(e.target.value)}>
              <option value="">General comment</option>
              {d.submissions.filter((s) => s.state !== "DRAFT").map((s) => <option key={s.id} value={s.id}>About version {s.sequence}</option>)}
            </Select>
            <Button size="sm" loading={busy} onClick={post}>Post comment</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkLogs({ d, tz }: { d: TaskDetail; tz?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [date, setDate] = useState(businessDate(new Date(), tz));
  const [minutes, setMinutes] = useState("");
  const [desc, setDesc] = useState("");
  const [source, setSource] = useState("MANUAL");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    setErrors({});
    try {
      await api.post(`/tasks/${d.task.id}/work-logs`, { businessDate: date, durationMinutes: Number(minutes), description: desc, source });
      toast({ tone: "success", title: "Work logged" });
      setMinutes("");
      setDesc("");
      qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && /^\/(tasks|worklogs)/.test(q.queryKey[0] as string) });
    } catch (e) {
      setErrors(e instanceof ApiError && e.body.fieldErrors ? e.body.fieldErrors : { form: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      {d.workLogs.length === 0 ? (
        <p className="text-sm text-slate-500">No work logged{d.permissions.isManager ? "" : " by you"} yet.</p>
      ) : (
        <Table>
          <THead><tr><TH>Date</TH><TH>Who</TH><TH className="text-right">Minutes</TH><TH>Description</TH><TH>Status</TH></tr></THead>
          <TBody>
            {d.workLogs.map((w) => (
              <TR key={w.id}>
                <TD>{fmtDate(w.businessDate)}</TD>
                <TD><Person id={w.employeeId} size={18} /></TD>
                <TD className="text-right tabular-nums">{fmtMinutes(w.durationMinutes)}{w.approvedMinutes !== undefined && w.approvedMinutes !== w.durationMinutes && <span className="block text-xs text-slate-500">approved {fmtMinutes(w.approvedMinutes)}</span>}</TD>
                <TD>{w.description} <span className="text-xs text-slate-400">({humanize(w.source)})</span></TD>
                <TD><StateBadge state={w.status} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {d.permissions.canLogWork && (
        <div className="grid gap-3 rounded-lg border border-slate-200 p-4 sm:grid-cols-4 dark:border-slate-800">
          <Field label="Date" htmlFor="wl-date" error={errors.businessDate}><Input id="wl-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Minutes" htmlFor="wl-min" error={errors.durationMinutes}><Input id="wl-min" type="number" min={5} max={720} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></Field>
          <Field label="Type" htmlFor="wl-src">
            <Select id="wl-src" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="MANUAL">Work</option>
              <option value="MEETING">Meeting</option>
              <option value="OFFLINE_WORK">Offline work</option>
            </Select>
          </Field>
          <Field label="Description" htmlFor="wl-desc" error={errors.description} className="sm:col-span-4"><Input id="wl-desc" value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
          {errors.form && <div className="sm:col-span-4"><InlineError message={errors.form} /></div>}
          <div className="flex items-center justify-between gap-2 sm:col-span-4">
            <p className="text-xs text-slate-500">Logs reconcile against attendance; overlapping or excess time is rejected.</p>
            <Button size="sm" icon={<Plus className="h-4 w-4" />} loading={busy} onClick={add}>Log work</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Dependencies({ d }: { d: TaskDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState("");
  const candidates = useApiQuery<TaskList>(d.permissions.canEdit ? "/tasks" : null, { projectId: d.project.id, includeClosed: "1" });
  const refresh = () => qc.invalidateQueries({ queryKey: [`/tasks/${d.task.id}`] });
  const add = async () => {
    if (!adding) return;
    try {
      await api.post(`/tasks/${d.task.id}/dependencies`, { predecessorId: adding }, { ifMatch: d.task.version });
      setAdding("");
      refresh();
    } catch (e) {
      toast({ tone: "error", title: "Can't add dependency", body: e instanceof ApiError ? e.body.fieldErrors?.predecessorId ?? e.body.message : errorMessage(e) });
    }
  };
  const remove = async (pred: string) => {
    try {
      await api.del(`/tasks/${d.task.id}/dependencies/${pred}`, { ifMatch: d.task.version });
      refresh();
    } catch (e) {
      toast({ tone: "error", title: "Can't remove dependency", body: errorMessage(e) });
    }
  };
  return (
    <Card>
      <CardHeader title="Dependencies" description="Acyclic; predecessors must complete before work starts." />
      <CardBody className="space-y-4 text-sm">
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase text-slate-500">Depends on</p>
          {d.predecessors.length === 0 ? <p className="text-slate-500">None</p> : (
            <ul className="space-y-1.5">
              {d.predecessors.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  {p.visible ? <Link href={`/tasks/${p.id}`} className="truncate hover:underline">{p.title}</Link> : <span className="text-slate-500">Restricted task</span>}
                  <span className="flex items-center gap-1"><StateBadge state={p.state} />{d.permissions.canEdit && <button aria-label={`Remove dependency on ${p.title}`} onClick={() => remove(p.id)} className="rounded p-0.5 text-slate-400 hover:text-red-600"><X className="h-3.5 w-3.5" /></button>}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase text-slate-500">Blocks</p>
          {d.successors.length === 0 ? <p className="text-slate-500">None</p> : (
            <ul className="space-y-1.5">
              {d.successors.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  {p.visible ? <Link href={`/tasks/${p.id}`} className="truncate hover:underline">{p.title}</Link> : <span className="text-slate-500">Restricted task</span>}
                  <StateBadge state={p.state} />
                </li>
              ))}
            </ul>
          )}
        </div>
        {d.permissions.canEdit && (
          <div className="flex gap-2">
            <Select aria-label="Add predecessor" value={adding} onChange={(e) => setAdding(e.target.value)}>
              <option value="">Add predecessor…</option>
              {candidates.data?.items.filter((t) => t.id !== d.task.id && !d.task.dependencyIds.includes(t.id)).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </Select>
            <Button size="sm" variant="outline" onClick={add} disabled={!adding}>Add</Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function EditTaskDialog({ d, onClose }: { d: TaskDetail; onClose: () => void }) {
  const { task } = d;
  const me = useMe();
  const lookups = useLookups();
  const qc = useQueryClient();
  const toast = useToast();
  const tz = me.data?.organization.timezone ?? "Asia/Karachi";
  const localDue = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(task.dueAt));
  const localTime = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(task.dueAt));
  const [f, setF] = useState({
    title: task.title, brief: task.brief, priority: task.priority, assigneeId: task.assigneeId ?? "", reviewerId: task.reviewerId ?? "",
    baselinePoints: Number(task.baselinePoints).toString(), dueDate: localDue, dueTime: localTime, reason: "", baselineDueChange: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = task.state === "DRAFT";
  const save = async () => {
    setBusy(true);
    setErrors({});
    setFormError(null);
    const body: Record<string, unknown> = { reason: f.reason || undefined };
    if (f.title !== task.title) body.title = f.title;
    if (f.brief !== task.brief) body.brief = f.brief;
    if (f.priority !== task.priority) body.priority = f.priority;
    if (f.assigneeId !== (task.assigneeId ?? "")) body.assigneeId = f.assigneeId || null;
    if (f.reviewerId !== (task.reviewerId ?? "")) body.reviewerId = f.reviewerId || null;
    if (Number(f.baselinePoints).toFixed(2) !== task.baselinePoints) body.baselinePoints = f.baselinePoints;
    const due = zonedToUtc(f.dueDate, f.dueTime, tz);
    if (due !== task.dueAt) {
      body.dueAt = due;
      body.baselineDueChange = f.baselineDueChange;
    }
    try {
      await api.patch(`/tasks/${task.id}`, body, { ifMatch: task.version });
      toast({ tone: "success", title: "Task updated" });
      qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && /^\/(tasks|projects|dashboard)/.test(q.queryKey[0] as string) });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === "VERSION_CONFLICT") setConflict(e);
      else {
        if (e instanceof ApiError && e.body.fieldErrors) setErrors(e.body.fieldErrors);
        setFormError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };
  const emps = lookups.data?.employees.filter((e) => e.employmentStatus === "ACTIVE") ?? [];
  return (
    <>
      <Dialog
        open
        onClose={onClose}
        size="lg"
        title="Edit task"
        description={draft ? "Draft tasks can be changed freely." : "After assignment, reassignment and deadline or points changes require a reason and are recorded in history."}
        footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save changes</Button></>}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="et-title" error={errors.title} className="sm:col-span-2"><Input id="et-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Brief" htmlFor="et-brief" className="sm:col-span-2"><Textarea id="et-brief" value={f.brief} onChange={(e) => setF({ ...f, brief: e.target.value })} /></Field>
          <Field label="Assignee" htmlFor="et-asg" error={errors.assigneeId}>
            <Select id="et-asg" value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })}>
              <option value="">Unassigned</option>
              {emps.map((e) => <option key={e.id} value={e.id}>{e.displayName}</option>)}
            </Select>
          </Field>
          <Field label="Reviewer" htmlFor="et-rev" error={errors.reviewerId}>
            <Select id="et-rev" value={f.reviewerId} onChange={(e) => setF({ ...f, reviewerId: e.target.value })}>
              <option value="">None</option>
              {emps.map((e) => <option key={e.id} value={e.id}>{e.displayName}</option>)}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="et-pr">
            <Select id="et-pr" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as typeof f.priority })}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
            </Select>
          </Field>
          <Field label="Output points" htmlFor="et-pts" error={errors.baselinePoints} hint={!draft ? "Changing points after work begins creates a new baseline version." : undefined}>
            <Input id="et-pts" value={f.baselinePoints} onChange={(e) => setF({ ...f, baselinePoints: e.target.value })} />
          </Field>
          <Field label="Due date" htmlFor="et-due"><Input id="et-due" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
          <Field label={`Due time (${tz})`} htmlFor="et-time"><Input id="et-time" type="time" value={f.dueTime} onChange={(e) => setF({ ...f, dueTime: e.target.value })} /></Field>
          {!draft && (
            <>
              <div className="sm:col-span-2">
                <Checkbox label="This is an agreed baseline deadline change" description="Otherwise only the operational due date moves; deadline scoring keeps the agreed baseline." checked={f.baselineDueChange} onChange={(v) => setF({ ...f, baselineDueChange: v })} />
              </div>
              <Field label="Reason for change" htmlFor="et-reason" error={errors.reason} className="sm:col-span-2"><Textarea id="et-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
            </>
          )}
          {formError && <div className="sm:col-span-2"><InlineError message={formError} /></div>}
        </div>
      </Dialog>
      <VersionConflictDialog
        error={conflict}
        mine={task as unknown as Record<string, unknown>}
        fields={["title", "state", "assigneeId", "reviewerId", "dueAt", "baselinePoints", "priority", "version"]}
        onClose={() => setConflict(null)}
        onReload={() => {
          setConflict(null);
          qc.invalidateQueries({ queryKey: [`/tasks/${task.id}`] });
          onClose();
        }}
      />
    </>
  );
}
