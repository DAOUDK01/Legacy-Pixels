"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useApiQuery, useLookups, useMe } from "@/lib/api/hooks";
import { api, ApiError, errorMessage } from "@/lib/api/transport";
import { PRIORITIES, type TaskList } from "@/lib/api/work";
import { zonedToUtc } from "@/lib/time";
import { can } from "@/lib/rbac";
import { Button, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, InlineError, Input, Notice, PageHeader, Select, Textarea } from "@/components/ui";
import { humanize } from "@/components/domain";
import { useToast } from "@/components/ui/toast";

export default function NewTaskPage() {
  return (
    <Suspense>
      <NewTask />
    </Suspense>
  );
}

interface Form {
  projectId: string;
  title: string;
  brief: string;
  checklist: string[];
  assigneeId: string;
  reviewerId: string;
  priority: string;
  baselinePoints: string;
  estimateHours: string;
  noEstimateReason: string;
  dueDate: string;
  dueTime: string;
  dependencyIds: string[];
  assignNow: boolean;
}

function NewTask() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const me = useMe();
  const lookups = useLookups();
  const [form, setForm] = useState<Form>({
    projectId: params.get("projectId") ?? "", title: "", brief: "", checklist: [""], assigneeId: "", reviewerId: "", priority: "MEDIUM",
    baselinePoints: "", estimateHours: "", noEstimateReason: "", dueDate: "", dueTime: "18:00", dependencyIds: [], assignNow: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const projectTasks = useApiQuery<TaskList>(form.projectId ? "/tasks" : null, { projectId: form.projectId, includeClosed: "1" });
  const tz = me.data?.organization.timezone ?? "Asia/Karachi";
  const projects = lookups.data?.projects.filter((p) => ["DRAFT", "ACTIVE", "ON_HOLD"].includes(p.state)) ?? [];
  const activeEmployees = useMemo(() => lookups.data?.employees.filter((e) => e.employmentStatus === "ACTIVE") ?? [], [lookups.data]);

  if (me.data && !can(me.data, "task.manage")) {
    return <Card><EmptyState title="You can't create tasks" description="Only managers with project scope can create and assign tasks." /></Card>;
  }

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!form.projectId) e.projectId = "Choose a project.";
    if (!form.title.trim()) e.title = "A title is required.";
    if (!/^\d+(\.\d{1,2})?$/.test(form.baselinePoints)) e.baselinePoints = "Enter planned output points (up to 2 decimals).";
    if (!form.dueDate) e.dueAt = "Choose a due date.";
    if (form.assignNow) {
      if (!form.brief.trim()) e.brief = "A brief is required before assignment.";
      if (!form.assigneeId) e.assigneeId = "Choose an accountable assignee.";
      if (!form.reviewerId) e.reviewerId = "Choose a reviewer.";
      if (!(Number(form.estimateHours) > 0) && !form.noEstimateReason.trim()) e.estimateMinutes = "Give an estimate or a no-estimate reason.";
      if (!form.checklist.some((c) => c.trim())) e.acceptanceChecklist = "Add at least one acceptance criterion.";
    }
    return e;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    setFormError(null);
    if (Object.keys(e).length) {
      setFormError("Some fields need attention.");
      return;
    }
    setSaving(true);
    try {
      const res = await api.post<{ id: string }>("/tasks", {
        projectId: form.projectId,
        title: form.title,
        brief: form.brief,
        acceptanceChecklist: form.checklist.filter((c) => c.trim()),
        assigneeId: form.assigneeId || undefined,
        reviewerId: form.reviewerId || undefined,
        priority: form.priority,
        baselinePoints: form.baselinePoints,
        estimateMinutes: form.estimateHours ? Math.round(Number(form.estimateHours) * 60) : undefined,
        noEstimateReason: form.noEstimateReason || undefined,
        dueAt: zonedToUtc(form.dueDate, form.dueTime || "18:00", tz),
        dependencyIds: form.dependencyIds,
        assignNow: form.assignNow,
      });
      toast({ tone: "success", title: form.assignNow ? "Task created and assigned" : "Draft task created" });
      qc.invalidateQueries();
      router.push(`/tasks/${res.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.body.fieldErrors) setErrors(err.body.fieldErrors);
      setFormError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="New task" breadcrumbs={[{ label: "Tasks", href: "/tasks" }, { label: "New" }]} description="One accountable assignee per task. Split shared ownership into subtasks so approval and credit stay explicit." />
      <form onSubmit={submit} noValidate className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Work definition" />
            <CardBody className="space-y-4">
              <Field label="Project" htmlFor="nt-project" required error={errors.projectId}>
                <Select id="nt-project" value={form.projectId} invalid={!!errors.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value, dependencyIds: [] })}>
                  <option value="">Choose…</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name} ({humanize(p.state)})</option>)}
                </Select>
              </Field>
              <Field label="Title" htmlFor="nt-title" required error={errors.title}>
                <Input id="nt-title" value={form.title} invalid={!!errors.title} onChange={(e) => set("title", e.target.value)} />
              </Field>
              <Field label="Brief" htmlFor="nt-brief" required={form.assignNow} error={errors.brief}>
                <Textarea id="nt-brief" rows={4} value={form.brief} invalid={!!errors.brief} onChange={(e) => set("brief", e.target.value)} />
              </Field>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Acceptance checklist{form.assignNow && <span className="text-red-600"> *</span>}</legend>
                {form.checklist.map((c, i) => (
                  <div key={i} className="flex gap-2">
                    <Input aria-label={`Acceptance criterion ${i + 1}`} value={c} placeholder="e.g. Source file with outlined type" onChange={(e) => set("checklist", form.checklist.map((x, j) => (j === i ? e.target.value : x)))} />
                    <Button variant="ghost" size="icon" aria-label={`Remove criterion ${i + 1}`} disabled={form.checklist.length === 1} onClick={() => set("checklist", form.checklist.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button variant="ghost" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => set("checklist", [...form.checklist, ""])}>Add criterion</Button>
                {errors.acceptanceChecklist && <p className="text-xs text-red-600" role="alert">{errors.acceptanceChecklist}</p>}
              </fieldset>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Dependencies" description="Predecessors must be complete before work starts, unless a manager records an override. Cycles are rejected." />
            <CardBody>
              {!form.projectId ? (
                <p className="text-sm text-slate-500">Choose a project first.</p>
              ) : projectTasks.data?.items.length ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {projectTasks.data.items.filter((t) => t.state !== "CANCELLED").map((t) => (
                    <Checkbox key={t.id} label={t.title} description={humanize(t.state)} checked={form.dependencyIds.includes(t.id)} onChange={(v) => set("dependencyIds", v ? [...form.dependencyIds, t.id] : form.dependencyIds.filter((x) => x !== t.id))} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">No other tasks in this project.</p>
              )}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Assignment & baseline" description="Planned output points are fixed before work begins." />
            <CardBody className="space-y-4">
              <Field label="Assignee" htmlFor="nt-assignee" required={form.assignNow} error={errors.assigneeId}>
                <Select id="nt-assignee" value={form.assigneeId} invalid={!!errors.assigneeId} onChange={(e) => set("assigneeId", e.target.value)}>
                  <option value="">Unassigned</option>
                  {activeEmployees.map((e) => <option key={e.id} value={e.id}>{e.displayName} — {e.title}</option>)}
                </Select>
              </Field>
              <Field label="Reviewer" htmlFor="nt-reviewer" required={form.assignNow} error={errors.reviewerId}>
                <Select id="nt-reviewer" value={form.reviewerId} invalid={!!errors.reviewerId} onChange={(e) => set("reviewerId", e.target.value)}>
                  <option value="">Choose…</option>
                  {activeEmployees.map((e) => <option key={e.id} value={e.id}>{e.displayName} — {e.title}</option>)}
                </Select>
              </Field>
              {form.assigneeId && form.assigneeId === form.reviewerId && (
                <Notice tone="amber">The assignee and reviewer are the same person. Submission can proceed, but approval stays blocked until the review is reassigned.</Notice>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Priority" htmlFor="nt-prio">
                  <Select id="nt-prio" value={form.priority} onChange={(e) => set("priority", e.target.value)}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
                  </Select>
                </Field>
                <Field label="Output points" htmlFor="nt-pts" required error={errors.baselinePoints}>
                  <Input id="nt-pts" inputMode="decimal" value={form.baselinePoints} invalid={!!errors.baselinePoints} onChange={(e) => set("baselinePoints", e.target.value)} />
                </Field>
              </div>
              <Field label="Estimate (hours)" htmlFor="nt-est" error={errors.estimateMinutes} hint="Or give an approved no-estimate reason below.">
                <Input id="nt-est" type="number" min={0} step={0.25} value={form.estimateHours} invalid={!!errors.estimateMinutes} onChange={(e) => set("estimateHours", e.target.value)} />
              </Field>
              <Field label="No-estimate reason" htmlFor="nt-noest">
                <Input id="nt-noest" value={form.noEstimateReason} onChange={(e) => set("noEstimateReason", e.target.value)} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Due date" htmlFor="nt-due" required error={errors.dueAt}>
                  <Input id="nt-due" type="date" value={form.dueDate} invalid={!!errors.dueAt} onChange={(e) => set("dueDate", e.target.value)} />
                </Field>
                <Field label={`Time (${tz})`} htmlFor="nt-time">
                  <Input id="nt-time" type="time" value={form.dueTime} onChange={(e) => set("dueTime", e.target.value)} />
                </Field>
              </div>
              <Checkbox label="Assign now" description="Validates required fields and notifies the assignee. Untick to save as a draft." checked={form.assignNow} onChange={(v) => set("assignNow", v)} />
            </CardBody>
          </Card>
          {formError && <InlineError message={formError} />}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
            <Button type="submit" loading={saving}>{form.assignNow ? "Create & assign" : "Save draft"}</Button>
          </div>
        </div>
      </form>
    </>
  );
}
