"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLookups, useMe } from "@/lib/api/hooks";
import { api, ApiError, errorMessage } from "@/lib/api/transport";
import type { Project } from "@/lib/types";
import { Button, Checkbox, Dialog, Field, InlineError, Input, Select, Textarea } from "@/components/ui";
import { VersionConflictDialog } from "@/components/domain";
import { useToast } from "@/components/ui/toast";

/** Create (no `project`) or edit project settings. */
export function ProjectFormDialog({ project, onClose, onSaved }: { project?: Project; onClose: () => void; onSaved?: (p: Project) => void }) {
  const me = useMe();
  const lookups = useLookups();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    code: project?.code ?? "",
    name: project?.name ?? "",
    brief: project?.brief ?? "",
    externalReference: project?.externalReference ?? "",
    managerId: project?.managerId ?? me.data?.employee?.id ?? "",
    plannedStart: project?.plannedStart ?? "",
    plannedEnd: project?.plannedEnd ?? "",
    memberIds: project?.memberIds ?? [],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const emps = lookups.data?.employees.filter((e) => e.employmentStatus === "ACTIVE") ?? [];

  const save = async () => {
    const e: Record<string, string> = {};
    if (!project && !/^[A-Za-z0-9][A-Za-z0-9-]{1,23}$/.test(f.code.trim())) e.code = "Use 2–24 letters, digits or dashes.";
    if (!f.name.trim()) e.name = "A title is required.";
    if (!f.managerId) e.managerId = "Choose a manager.";
    if (!f.plannedStart) e.plannedStart = "Required.";
    if (!f.plannedEnd) e.plannedEnd = "Required.";
    else if (f.plannedStart && f.plannedEnd < f.plannedStart) e.plannedEnd = "End must be on or after start.";
    if (!f.memberIds.length) e.memberIds = "Add at least one member.";
    setErrors(e);
    if (Object.keys(e).length) return setFormError("Some fields need attention.");
    setBusy(true);
    setFormError(null);
    try {
      const saved = project
        ? await api.patch<Project>(`/projects/${project.id}`, { name: f.name, brief: f.brief, externalReference: f.externalReference, managerId: f.managerId, plannedStart: f.plannedStart, plannedEnd: f.plannedEnd, memberIds: f.memberIds }, { ifMatch: project.version })
        : await api.post<Project>("/projects", { ...f, code: f.code.trim().toUpperCase() });
      toast({ tone: "success", title: project ? "Project updated" : `Project ${saved.code} created` });
      qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && /^\/(projects|lookups|tasks|dashboard)/.test(q.queryKey[0] as string) });
      onSaved?.(saved);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "VERSION_CONFLICT") setConflict(err);
      else {
        if (err instanceof ApiError && err.body.fieldErrors) setErrors(err.body.fieldErrors);
        setFormError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        size="lg"
        title={project ? `Edit ${project.code}` : "New project"}
        description="The external reference is descriptive only — no client or sales records are kept."
        footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{project ? "Save" : "Create project"}</Button></>}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" htmlFor="pf-code" required error={errors.code} hint={project ? "Codes are permanent." : "Unique in the organization, e.g. WEB-2027."}>
            <Input id="pf-code" value={f.code} disabled={!!project} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Title" htmlFor="pf-name" required error={errors.name}><Input id="pf-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Description" htmlFor="pf-brief" className="sm:col-span-2"><Textarea id="pf-brief" value={f.brief} onChange={(e) => setF({ ...f, brief: e.target.value })} /></Field>
          <Field label="External reference" htmlFor="pf-ref"><Input id="pf-ref" value={f.externalReference} onChange={(e) => setF({ ...f, externalReference: e.target.value })} /></Field>
          <Field label="Manager" htmlFor="pf-mgr" required error={errors.managerId}>
            <Select id="pf-mgr" value={f.managerId} onChange={(e) => setF({ ...f, managerId: e.target.value })}>
              <option value="">Choose…</option>
              {emps.map((e) => <option key={e.id} value={e.id}>{e.displayName}</option>)}
            </Select>
          </Field>
          <Field label="Target start" htmlFor="pf-start" required error={errors.plannedStart}><Input id="pf-start" type="date" value={f.plannedStart} onChange={(e) => setF({ ...f, plannedStart: e.target.value })} /></Field>
          <Field label="Target end" htmlFor="pf-end" required error={errors.plannedEnd}><Input id="pf-end" type="date" value={f.plannedEnd} onChange={(e) => setF({ ...f, plannedEnd: e.target.value })} /></Field>
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-sm font-medium">Members <span className="text-red-600">*</span></legend>
            <div className="grid max-h-48 gap-2 overflow-y-auto rounded-md border border-slate-200 p-3 sm:grid-cols-2 dark:border-slate-700">
              {emps.map((e) => (
                <Checkbox key={e.id} label={e.displayName} description={e.title} checked={f.memberIds.includes(e.id)} onChange={(v) => setF({ ...f, memberIds: v ? [...f.memberIds, e.id] : f.memberIds.filter((x) => x !== e.id) })} />
              ))}
            </div>
            {errors.memberIds && <p className="mt-1 text-xs text-red-600" role="alert">{errors.memberIds}</p>}
          </fieldset>
          {formError && <div className="sm:col-span-2"><InlineError message={formError} /></div>}
        </div>
      </Dialog>
      <VersionConflictDialog
        error={conflict}
        mine={project as unknown as Record<string, unknown>}
        fields={["name", "managerId", "plannedStart", "plannedEnd", "memberIds", "state", "version"]}
        onClose={() => setConflict(null)}
        onReload={() => {
          setConflict(null);
          qc.invalidateQueries({ queryKey: [`/projects/${project?.id}`] });
          onClose();
        }}
      />
    </>
  );
}
