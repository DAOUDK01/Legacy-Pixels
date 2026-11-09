"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, GitCompare, RotateCcw } from "lucide-react";
import { useApiQuery } from "@/lib/api/hooks";
import { api, ApiError, errorMessage } from "@/lib/api/transport";
import type { TaskDetail } from "@/lib/api/work";
import type { RubricScores } from "@/lib/types";
import { RUBRIC_V1, rubricCommentErrors, weightedQuality } from "@/lib/calc/rubric";
import { fmtDateTime } from "@/lib/time";
import {
  Badge, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, InlineError, Input, Notice, PageHeader, QueryState, Select, Textarea, cn,
} from "@/components/ui";
import { Person, StateBadge, VersionConflictDialog } from "@/components/domain";
import { useToast } from "@/components/ui/toast";
import { MediaList } from "@/components/work/MediaList";

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const q = useApiQuery<TaskDetail>(`/tasks/${id}`);
  return <QueryState query={q} rows={10}>{(d) => <Review d={d} />}</QueryState>;
}

type Key = keyof RubricScores;

function Review({ d }: { d: TaskDetail }) {
  const { task } = d;
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const versions = d.submissions.filter((s) => s.state !== "DRAFT").sort((a, b) => a.sequence - b.sequence);
  const current = versions.filter((s) => s.state === "SUBMITTED").at(-1);
  const [compareA, setCompareA] = useState(versions.length > 1 ? versions[versions.length - 2].id : "");
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [scores, setScores] = useState<Record<Key, string>>({ brief: "", technical: "", presentation: "", organization: "" });
  const [comments, setComments] = useState<Partial<Record<Key, string>>>({});
  const [feedback, setFeedback] = useState("");
  const [rejected, setRejected] = useState(false);
  const [anchorComment, setAnchorComment] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"APPROVE" | "REQUEST_REVISION" | null>(null);
  const [conflict, setConflict] = useState<ApiError | null>(null);

  const numeric = useMemo(() => {
    const s = {} as RubricScores;
    for (const k of Object.keys(scores) as Key[]) s[k] = scores[k] === "" ? NaN : Number(scores[k]);
    return s;
  }, [scores]);
  const complete = Object.values(numeric).every((v) => Number.isInteger(v) && v >= 0 && v <= 100);
  const quality = complete ? weightedQuality(numeric) : null;
  const commentErrs = complete ? rubricCommentErrors(numeric, comments) : {};
  const allChecked = task.acceptanceChecklist.every((c) => checklist[c.id]);

  const compareSub = versions.find((s) => s.id === compareA);
  const changed = useMemo(() => {
    if (!compareSub || !current) return new Set<string>();
    return new Set(current.mediaIds.filter((m) => !compareSub.mediaIds.includes(m)));
  }, [compareSub, current]);

  if (!d.permissions.canReview) {
    return (
      <>
        <PageHeader title={`Review: ${task.title}`} breadcrumbs={[{ label: "Review queue", href: "/reviews" }, { label: task.title, href: `/tasks/${task.id}` }, { label: "Review" }]} />
        <Card>
          <EmptyState
            title={d.permissions.selfReviewBlocked ? "Self-review is blocked" : task.state !== "SUBMITTED" ? "Nothing to review" : "You're not the assigned reviewer"}
            description={
              d.permissions.selfReviewBlocked
                ? "The assignee and reviewer are the same person. A manager must reassign the review before approval."
                : task.state !== "SUBMITTED"
                  ? `This task is ${task.state.toLowerCase().replace("_", " ")}.`
                  : "Only the reviewer assigned to this task can decide on its submissions."
            }
          />
        </Card>
      </>
    );
  }
  if (!current) return <Card><EmptyState title="No submitted version" /></Card>;

  const decide = async (decision: "APPROVE" | "REQUEST_REVISION") => {
    const e: Record<string, string> = {};
    if (decision === "APPROVE") {
      if (!allChecked) e.checklist = "All acceptance criteria must be met to approve.";
      if (!complete) e.rubric = "Score every rubric item with a whole number 0–100.";
      for (const [k, v] of Object.entries(commentErrs)) e[`rubric.${k}`] = v!;
    } else if (feedback.trim().length < 10) e.feedback = "Give actionable feedback (at least 10 characters).";
    setErrors(e);
    setFormError(Object.keys(e).length ? "The review is incomplete." : null);
    if (Object.keys(e).length) return;
    setBusy(decision);
    try {
      const res = await api.post<{ taskState: string; quality?: string }>(
        `/submissions/${current.id}/reviews`,
        { decision, taskVersion: task.version, rubricVersion: task.rubricVersion, scores: decision === "APPROVE" ? numeric : undefined, rubricComments: comments, checklist, feedback, rejected },
        { ifMatch: task.version },
      );
      toast({ tone: "success", title: decision === "APPROVE" ? `Approved v${current.sequence}` : "Revision requested", body: res.quality ? `Weighted quality ${res.quality}` : undefined });
      qc.invalidateQueries();
      router.push(`/tasks/${task.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "VERSION_CONFLICT") setConflict(err);
      else {
        if (err instanceof ApiError && err.body.fieldErrors) setErrors(err.body.fieldErrors);
        setFormError(errorMessage(err));
      }
      setBusy(null);
    }
  };

  const postAnchored = async () => {
    if (!anchorComment.trim()) return;
    try {
      await api.post(`/tasks/${task.id}/comments`, { body: anchorComment, anchor: { submissionId: current.id } });
      setAnchorComment("");
      qc.invalidateQueries({ queryKey: [`/tasks/${task.id}`] });
      toast({ tone: "success", title: `Comment added to v${current.sequence}` });
    } catch (e) {
      toast({ tone: "error", title: "Couldn't add comment", body: errorMessage(e) });
    }
  };

  return (
    <>
      <PageHeader
        title={`Review: ${task.title}`}
        breadcrumbs={[{ label: "Review queue", href: "/reviews" }, { label: task.title, href: `/tasks/${task.id}` }, { label: `Review v${current.sequence}` }]}
        description={<span className="flex flex-wrap items-center gap-2">Submitted by <Person id={current.authorId} size={18} /> {current.submittedAt && fmtDateTime(current.submittedAt)} · Rubric v{task.rubricVersion} · Your decision applies to this exact version.</span>}
      />
      <div className="grid gap-6 xl:grid-cols-5">
        <div className="space-y-6 xl:col-span-3">
          <Card>
            <CardHeader
              title={<span className="flex items-center gap-2">Version {current.sequence} <StateBadge state={current.state} /></span>}
              actions={
                versions.length > 1 && (
                  <label className="flex items-center gap-2 text-xs text-slate-500">
                    <GitCompare className="h-4 w-4" /> Compare with
                    <Select aria-label="Compare with version" className="h-8 w-28" value={compareA} onChange={(e) => setCompareA(e.target.value)}>
                      <option value="">None</option>
                      {versions.filter((v) => v.id !== current.id).map((v) => <option key={v.id} value={v.id}>v{v.sequence}</option>)}
                    </Select>
                  </label>
                )
              }
            />
            <CardBody className="space-y-4">
              <div className={cn("grid gap-4", compareSub && "md:grid-cols-2")}>
                {compareSub && (
                  <div className="space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-950/50">
                    <p className="text-xs font-semibold uppercase text-slate-500">v{compareSub.sequence} (previous)</p>
                    <p className="whitespace-pre-wrap text-sm">{compareSub.summary}</p>
                    <MediaList media={compareSub.media} compact />
                    {d.reviews.filter((r) => r.submissionId === compareSub.id).map((r) => (
                      <p key={r.id} className="rounded bg-amber-50 p-2 text-xs dark:bg-amber-950/40">Earlier feedback: {r.feedback}</p>
                    ))}
                  </div>
                )}
                <div className="space-y-2">
                  {compareSub && <p className="text-xs font-semibold uppercase text-slate-500">v{current.sequence} (current)</p>}
                  <p className="whitespace-pre-wrap text-sm">{current.summary}</p>
                  <MediaList media={current.media} highlight={compareSub ? changed : undefined} />
                </div>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Comments on this version" description="Anchored comments stay attached to this version for everyone permitted to see it." />
            <CardBody className="space-y-3">
              <ul className="space-y-2 text-sm">
                {d.comments.filter((c) => c.anchor?.submissionId === current.id).map((c) => (
                  <li key={c.id} className="rounded bg-slate-50 p-2 dark:bg-slate-950/50"><Person id={c.authorId} size={16} /> <span className="ml-1">{c.body}</span></li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Input aria-label="Comment on this version" value={anchorComment} onChange={(e) => setAnchorComment(e.target.value)} placeholder={`Comment on v${current.sequence}…`} />
                <Button variant="outline" onClick={postAnchored}>Post</Button>
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Acceptance checklist" />
            <CardBody className="space-y-2">
              {task.acceptanceChecklist.map((c) => (
                <Checkbox key={c.id} label={c.label} checked={!!checklist[c.id]} onChange={(v) => setChecklist((x) => ({ ...x, [c.id]: v }))} />
              ))}
              {errors.checklist && <p className="text-xs text-red-600" role="alert">{errors.checklist}</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Quality rubric" description="Score each item 0–100 with evidence. A comment is required for any score below 60." actions={quality && <Badge tone="green">Weighted {quality}</Badge>} />
            <CardBody className="space-y-4">
              {RUBRIC_V1.items.map((item) => {
                const err = errors[`rubric.${item.key}`] ?? commentErrs[item.key];
                return (
                  <div key={item.key} className="space-y-1.5">
                    <div className="flex items-end gap-3">
                      <Field label={`${item.label} (${item.weight}%)`} htmlFor={`rb-${item.key}`} className="flex-1">
                        <Input id={`rb-${item.key}`} type="number" min={0} max={100} step={1} inputMode="numeric" value={scores[item.key]} onChange={(e) => setScores((s) => ({ ...s, [item.key]: e.target.value }))} />
                      </Field>
                    </div>
                    {(Number(scores[item.key]) < RUBRIC_V1.commentRequiredBelow && scores[item.key] !== "") || comments[item.key] ? (
                      <Field label="Evidence / comment" htmlFor={`rbc-${item.key}`} error={err}>
                        <Textarea id={`rbc-${item.key}`} rows={2} value={comments[item.key] ?? ""} onChange={(e) => setComments((c) => ({ ...c, [item.key]: e.target.value }))} />
                      </Field>
                    ) : (
                      <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setComments((c) => ({ ...c, [item.key]: " " }))}>Add evidence comment</button>
                    )}
                  </div>
                );
              })}
              {errors.rubric && <p className="text-xs text-red-600" role="alert">{errors.rubric}</p>}
              <p className="text-xs text-slate-500">Weighted quality = brief×0.40 + technical×0.30 + presentation×0.20 + organization×0.10.</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Decision" />
            <CardBody className="space-y-4">
              <Field label="Feedback" htmlFor="rv-feedback" error={errors.feedback} hint="Required when requesting a revision; make it actionable.">
                <Textarea id="rv-feedback" rows={4} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
              </Field>
              <Checkbox label="Mark as rejected" description="Recorded as the decision reason; the task still goes to Revision requested (or the manager may cancel it)." checked={rejected} onChange={setRejected} />
              {formError && <InlineError message={formError} />}
              <Notice tone="slate">Approval and the output credit are committed together. A decision can't overwrite an earlier one.</Notice>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" icon={<RotateCcw className="h-4 w-4" />} loading={busy === "REQUEST_REVISION"} disabled={!!busy} onClick={() => decide("REQUEST_REVISION")}>Request revision</Button>
                <Button variant="success" icon={<CheckCircle2 className="h-4 w-4" />} loading={busy === "APPROVE"} disabled={!!busy || rejected} onClick={() => decide("APPROVE")}>Approve v{current.sequence}</Button>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
      <VersionConflictDialog
        error={conflict}
        mine={task as unknown as Record<string, unknown>}
        fields={["state", "reviewerId", "version"]}
        onClose={() => setConflict(null)}
        onReload={() => {
          setConflict(null);
          qc.invalidateQueries({ queryKey: [`/tasks/${task.id}`] });
        }}
      />
    </>
  );
}
