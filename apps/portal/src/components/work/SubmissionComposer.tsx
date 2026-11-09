"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CloudOff, FilePlus2, Send, Upload } from "lucide-react";
import type { TaskDetail, UploadProgress } from "@/lib/api/work";
import { ACCEPT_HINT, uploadFile } from "@/lib/api/work";
import { api, ApiError, errorMessage } from "@/lib/api/transport";
import { fmtBytes } from "@/lib/time";
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, InlineError, Notice, Progress, Textarea } from "@/components/ui";
import { StateBadge } from "@/components/domain";
import { useToast } from "@/components/ui/toast";
import { MediaList } from "./MediaList";

export function SubmissionComposer({ detail }: { detail: TaskDetail }) {
  const { task } = detail;
  const qc = useQueryClient();
  const toast = useToast();
  const draft = detail.submissions.find((s) => s.state === "DRAFT");
  const previous = detail.submissions.find((s) => s.state !== "DRAFT");
  const [summary, setSummary] = useState(draft?.summary ?? "");
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const draftId = draft?.id;

  useEffect(() => {
    if (draft && !summary) setSummary(draft.summary);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  const refresh = () => qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/tasks") });

  const start = async () => {
    setStarting(true);
    try {
      await api.post(`/tasks/${task.id}/submissions`);
      await refresh();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't start a submission", body: errorMessage(e) });
    } finally {
      setStarting(false);
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || !draft) return;
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Date.now()}`;
      setUploads((u) => [...u, { key, name: file.name, size: file.size, state: "QUEUED", progress: 0 }]);
      const update = (p: Partial<UploadProgress>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...p } : x)));
      try {
        await uploadFile(file, { taskId: task.id, submissionDraftId: draft.id }, update);
        setUploads((u) => u.filter((x) => x.key !== key));
      } catch (e) {
        const offline = e instanceof ApiError && e.code === "DEPENDENCY_UNAVAILABLE";
        update({ state: offline ? "RECEIVING" : "FAILED", error: errorMessage(e) });
      }
      await refresh();
    }
    if (fileInput.current) fileInput.current.value = "";
  };

  const saveSummary = async () => {
    if (!draft || summary === draft.summary) return;
    try {
      await api.patch(`/submissions/${draft.id}`, { summary });
    } catch {
      /* kept locally; submit will send it again */
    }
  };

  const remove = async (mediaId: string) => {
    if (!draft) return;
    await api.patch(`/submissions/${draft.id}`, { removeMediaIds: [mediaId] });
    refresh();
  };

  const reuse = async (mediaId: string, on: boolean) => {
    if (!draft) return;
    await api.patch(`/submissions/${draft.id}`, on ? { reuseMediaIds: [mediaId] } : { removeMediaIds: [mediaId] });
    refresh();
  };

  const submit = async () => {
    if (!draft) return;
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    try {
      await api.post(`/submissions/${draft.id}/submit`, { summary }, { ifMatch: task.version });
      toast({ tone: "success", title: `Version ${draft.sequence} submitted`, body: "Your reviewer has been notified." });
      setSummary("");
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.body.fieldErrors) setErrors(e.body.fieldErrors);
      setFormError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!draft) {
    return (
      <Card>
        <CardHeader title="Submit work" description="Draft uploads are not submissions. You choose when a frozen version goes to review." />
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {task.state === "REVISION_REQUESTED" ? "Prepare a new version addressing the reviewer's feedback." : "Start a submission to attach your files and notes."}
          </p>
          <Button icon={<FilePlus2 className="h-4 w-4" />} loading={starting} onClick={start}>
            Prepare version {Math.max(0, ...detail.submissions.map((s) => s.sequence)) + 1}
          </Button>
        </CardBody>
      </Card>
    );
  }

  const allAvailable = draft.media.length > 0 && draft.media.every((m) => m.state === "AVAILABLE");
  const inflight = uploads.length > 0;
  const blockedFiles = draft.media.filter((m) => ["FAILED", "QUARANTINED", "EXPIRED", "DELETED"].includes(m.state));
  const pendingFiles = draft.media.filter((m) => ["INITIATED", "RECEIVING", "SCANNING", "TRANSFERRING"].includes(m.state));
  const ready = allAvailable && !inflight && summary.trim().length >= 10;

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2">Submission composer <Badge tone="blue">Draft v{draft.sequence}</Badge></span>}
        description="Submit becomes available once every file is scanned and available and your note describes the delivered work."
      />
      <CardBody className="space-y-5">
        <div className="rounded-lg bg-slate-50 p-4 text-sm dark:bg-slate-950/60">
          <p className="font-medium">Brief</p>
          <p className="mt-1 whitespace-pre-wrap text-slate-600 dark:text-slate-400">{task.brief || "—"}</p>
          <p className="mt-3 font-medium">Self-check against acceptance criteria</p>
          <div className="mt-2 space-y-1.5">
            {task.acceptanceChecklist.map((c) => (
              <Checkbox key={c.id} label={c.label} checked={!!checks[c.id]} onChange={(v) => setChecks((x) => ({ ...x, [c.id]: v }))} />
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">Your self-check is a personal aid; the reviewer records the official checklist.</p>
        </div>

        <Field label="What did you deliver?" htmlFor="sub-summary" required error={errors.summary} hint="Describe the delivered work, decisions and anything the reviewer should know.">
          <Textarea id="sub-summary" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} onBlur={saveSummary} invalid={!!errors.summary} />
        </Field>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Files</p>
            <div>
              <input ref={fileInput} id="sub-files" type="file" multiple className="sr-only" onChange={(e) => onFiles(e.target.files)} />
              <Button variant="outline" size="sm" icon={<Upload className="h-4 w-4" />} onClick={() => fileInput.current?.click()}>Add files</Button>
            </div>
          </div>
          <p className="text-xs text-slate-500">{ACCEPT_HINT} Up to two uploads run at once.</p>
          {uploads.length > 0 && (
            <ul className="space-y-2 rounded-lg border border-dashed border-slate-300 p-3 dark:border-slate-700">
              {uploads.map((u) => (
                <li key={u.key} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{u.name} <span className="text-xs text-slate-500">({fmtBytes(u.size)})</span></span>
                    <StateBadge state={u.state === "QUEUED" ? "PENDING" : u.state} label={u.state === "QUEUED" ? "Queued" : undefined} />
                  </div>
                  {!u.error && <div className="mt-1"><Progress value={u.progress * 100} label={`${u.name} upload`} /></div>}
                  {u.error && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-red-700">
                      {u.state === "RECEIVING" && <CloudOff className="h-3.5 w-3.5" />} {u.error}
                      <button className="ml-2 underline" onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}>Dismiss</button>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <MediaList media={draft.media} onRemove={remove} />
          {errors.files && <p className="text-xs text-red-600" role="alert">{errors.files}</p>}
          {pendingFiles.length > 0 && (
            <Notice tone="slate">{pendingFiles.length} file(s) still processing (scan → transfer). This is not a finalized submission until every file is available.</Notice>
          )}
          {blockedFiles.length > 0 && <Notice tone="red">Remove failed or quarantined files before submitting.</Notice>}
        </div>

        {previous && previous.media.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Reuse unchanged files from v{previous.sequence}</p>
            <p className="text-xs text-slate-500">Reused files keep their immutable reference — output is never counted twice.</p>
            <div className="space-y-1.5">
              {previous.media.filter((m) => m.state === "AVAILABLE").map((m) => (
                <Checkbox key={m.id} label={`${m.name} (${fmtBytes(m.sizeBytes)})`} checked={draft.mediaIds.includes(m.id)} onChange={(v) => reuse(m.id, v)} />
              ))}
            </div>
          </div>
        )}

        {formError && <InlineError message={formError} />}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            {ready ? <><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Ready to submit — files and note will be frozen as v{draft.sequence}.</> : "Submit unlocks when all files are available and the note is complete."}
          </p>
          <Button icon={<Send className="h-4 w-4" />} disabled={!ready} loading={submitting} onClick={submit}>Submit v{draft.sequence} for review</Button>
        </div>
      </CardBody>
    </Card>
  );
}
