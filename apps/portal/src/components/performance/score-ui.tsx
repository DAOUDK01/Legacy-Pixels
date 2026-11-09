"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Info, MessageSquareWarning } from "lucide-react";
import type { ScoreComponent, ScoreComponentKey, ScoreDispute, ScoreSnapshot } from "@/lib/types";
import { SCORE_FORMULAS, SCORE_LABELS, SCORE_WEIGHTS_PCT } from "@/lib/calc/score";
import { useApiMutation } from "@/lib/api/hooks";
import { errorMessage } from "@/lib/api/transport";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { Badge, Button, Dialog, Field, InlineError, Input, Notice, Progress, Select, Textarea, cn } from "@/components/ui";
import { Person, StateBadge } from "@/components/domain";

export function scoreTone(v: number | null | undefined): "green" | "amber" | "red" | "brand" {
  if (v === null || v === undefined) return "brand";
  return v >= 85 ? "green" : v >= 65 ? "amber" : "red";
}

export function fmtScore(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? "N/A" : v.toFixed(digits);
}

export function periodLabel(s: Pick<ScoreSnapshot, "periodStart" | "periodEnd">): string {
  return `${fmtDate(s.periodStart)} – ${fmtDate(s.periodEnd)}`;
}

/** Headline score with the comparability label required by section 13. */
export function ScoreHeadline({ snapshot, compact }: { snapshot: ScoreSnapshot; compact?: boolean }) {
  const comparable = snapshot.coverageWeight >= 0.999;
  const shown = snapshot.override?.score ?? snapshot.weightedScore;
  return (
    <div className={cn("flex flex-wrap items-end gap-x-6 gap-y-3", compact && "gap-x-4")}>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{snapshot.override ? "Overridden score" : comparable ? "Productivity score" : "Provisional normalized score"}</p>
        <p className={cn("font-semibold tabular-nums text-slate-900 dark:text-white", compact ? "text-3xl" : "text-5xl")}>
          {fmtScore(shown)}
          <span className="ml-1 text-base font-normal text-slate-400">/ 100</span>
        </p>
      </div>
      <div className="space-y-1.5 pb-1">
        <div className="flex flex-wrap gap-2">
          <StateBadge state={snapshot.status} />
          {!comparable && <Badge tone="amber">Covers {Math.round(snapshot.coverageWeight * 100)}% of weights</Badge>}
          <Badge tone="slate">Formula v{snapshot.formulaVersion}</Badge>
        </div>
        {!comparable && <p className="max-w-md text-xs text-slate-500">Some components have no valid denominator (N/A), so this is normalized over the applicable weights only and is not the full comparable score.</p>}
        {snapshot.override && (
          <p className="max-w-md text-xs text-slate-500">
            Original computed score {fmtScore(snapshot.weightedScore)} is preserved. Owner override recorded {fmtDateTime(snapshot.override.at)}: {snapshot.override.reason}
          </p>
        )}
      </div>
    </div>
  );
}

export function ComponentRows({ components }: { components: ScoreComponent[] }) {
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {components.map((c) => (
        <li key={c.key} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_200px]">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
              <span className="flex h-6 w-6 items-center justify-center rounded bg-slate-100 font-mono text-xs dark:bg-slate-800">{c.key}</span>
              {SCORE_LABELS[c.key]}
              <span className="text-xs font-normal text-slate-500">weight {SCORE_WEIGHTS_PCT[c.key]}%</span>
              {c.provisional && <Badge tone="amber">Provisional</Badge>}
            </p>
            <p className="mt-1 font-mono text-[11px] text-slate-500">{SCORE_FORMULAS[c.key]}</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{c.explanation}</p>
            {c.value !== null && c.numerator !== null && c.denominator !== null && (
              <p className="mt-1 text-xs text-slate-500">
                Inputs: <span className="tabular-nums">{c.numerator.toLocaleString()}</span> / <span className="tabular-nums">{c.denominator.toLocaleString()}</span>
              </p>
            )}
            {c.sources.length > 0 && (
              <p className="mt-1 flex flex-wrap gap-x-3 text-xs">
                {c.sources.map((s) => (
                  <Link key={s.id} href={s.type === "task" ? `/tasks/${s.id}` : "#"} className="text-brand-600 hover:underline">{s.label}</Link>
                ))}
              </p>
            )}
          </div>
          <div className="flex flex-col justify-center gap-1.5">
            <p className="text-right text-lg font-semibold tabular-nums">{c.value === null ? <span className="text-sm font-medium text-slate-400">N/A</span> : c.value.toFixed(c.value % 1 ? 2 : 0)}</p>
            {c.value !== null && <Progress value={c.value} tone={scoreTone(c.value)} label={`${SCORE_LABELS[c.key]} ${c.value}`} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CoachingNotice() {
  return (
    <Notice tone="slate" icon={<Info className="h-4 w-4" />}>
      Scores support coaching and review. They never change wages automatically and never trigger penalties. Missing monitoring is not counted against you, and you can dispute any input within the dispute window.
    </Notice>
  );
}

export function DisputeList({ disputes, onResolve }: { disputes: ScoreDispute[]; onResolve?: (d: ScoreDispute) => void }) {
  if (!disputes.length) return <p className="px-5 py-4 text-sm text-slate-500">No disputes raised.</p>;
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {disputes.map((d) => (
        <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <MessageSquareWarning className="h-4 w-4 text-amber-500" />
              <span className="font-medium">{d.component ? `${d.component} · ${SCORE_LABELS[d.component]}` : "Whole score"}</span>
              <StateBadge state={d.status} />
              <span className="text-xs text-slate-500">{fmtDateTime(d.createdAt)}</span>
            </p>
            <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{d.reason}</p>
            {d.resolution && <p className="mt-1 text-sm text-slate-500">Resolution: {d.resolution}</p>}
          </div>
          {onResolve && (d.status === "OPEN" || d.status === "UNDER_REVIEW") && <Button size="sm" variant="outline" onClick={() => onResolve(d)}>Resolve</Button>}
        </li>
      ))}
    </ul>
  );
}

export function DisputeDialog({ open, onClose, snapshot }: { open: boolean; onClose: () => void; snapshot: ScoreSnapshot }) {
  const [component, setComponent] = useState<"" | ScoreComponentKey>("");
  const [reason, setReason] = useState("");
  const m = useApiMutation("POST", `/scores/${snapshot.id}/disputes`, { invalidate: ["/scores", "/disputes"], onSuccess: onClose });
  useEffect(() => {
    if (open) {
      setComponent("");
      setReason("");
      m.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const fe = m.error?.body.fieldErrors ?? {};
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Dispute this score"
      description="Explain which input looks wrong. A reviewer will check the evidence; your original score is preserved either way."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate({ body: { component: component || undefined, reason } })}>Submit dispute</Button></>}
    >
      <div className="space-y-4">
        <Field label="Component" htmlFor="dsp-comp" error={fe.component}>
          <Select id="dsp-comp" value={component} onChange={(e) => setComponent(e.target.value as ScoreComponentKey | "")}>
            <option value="">Whole score</option>
            {(Object.keys(SCORE_LABELS) as ScoreComponentKey[]).map((k) => <option key={k} value={k}>{k} · {SCORE_LABELS[k]}</option>)}
          </Select>
        </Field>
        <Field label="What looks wrong?" htmlFor="dsp-reason" required error={fe.reason} hint="Reference tasks, dates or approved exceptions where you can.">
          <Textarea id="dsp-reason" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!fe.reason} />
        </Field>
        {m.error && !Object.keys(fe).length && <InlineError message={errorMessage(m.error)} />}
      </div>
    </Dialog>
  );
}

export function ResolveDisputeDialog({ dispute, onClose }: { dispute: ScoreDispute | null; onClose: () => void }) {
  const [status, setStatus] = useState<"UNDER_REVIEW" | "UPHELD" | "REJECTED">("UPHELD");
  const [resolution, setResolution] = useState("");
  const m = useApiMutation("POST", `/disputes/${dispute?.id}/decision`, { invalidate: ["/scores", "/disputes"], onSuccess: onClose });
  useEffect(() => {
    if (dispute) {
      setStatus("UPHELD");
      setResolution("");
      m.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispute]);
  const fe = m.error?.body.fieldErrors ?? {};
  return (
    <Dialog
      open={!!dispute}
      onClose={onClose}
      title="Resolve dispute"
      description="Upholding a dispute does not change the score by itself; use an override with evidence if the score must change."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate({ path: `/disputes/${dispute!.id}/decision`, body: { status, resolution } })}>Save decision</Button></>}
    >
      {dispute && (
        <div className="space-y-4">
          <div className="rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-800">
            <Person id={dispute.employeeId} />
            <p className="mt-2 text-slate-700 dark:text-slate-300">{dispute.reason}</p>
          </div>
          <Field label="Decision" htmlFor="res-status" error={fe.status}>
            <Select id="res-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="UNDER_REVIEW">Mark under review</option>
              <option value="UPHELD">Uphold</option>
              <option value="REJECTED">Reject</option>
            </Select>
          </Field>
          <Field label="Resolution and evidence considered" htmlFor="res-text" required={status !== "UNDER_REVIEW"} error={fe.resolution}>
            <Textarea id="res-text" rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} />
          </Field>
          {m.error && !Object.keys(fe).length && <InlineError message={errorMessage(m.error)} />}
        </div>
      )}
    </Dialog>
  );
}

export function OverrideDialog({ open, onClose, snapshot }: { open: boolean; onClose: () => void; snapshot: ScoreSnapshot }) {
  const [score, setScore] = useState("");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const m = useApiMutation("POST", `/scores/${snapshot.id}/override`, { invalidate: ["/scores", "/disputes"], onSuccess: onClose });
  useEffect(() => {
    if (open) {
      setScore(String(snapshot.override?.score ?? snapshot.weightedScore ?? ""));
      setReason("");
      setEvidence("");
      m.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const fe = m.error?.body.fieldErrors ?? {};
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Owner override"
      description={`The computed score (${fmtScore(snapshot.weightedScore)}) is preserved alongside the override and both are audited.`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate({ body: { score, reason, evidence } })}>Record override</Button></>}
    >
      <div className="space-y-4">
        <Field label="Override score (0–100)" htmlFor="ovr-score" required error={fe.score}>
          <Input id="ovr-score" type="number" min={0} max={100} step={0.1} value={score} onChange={(e) => setScore(e.target.value)} invalid={!!fe.score} />
        </Field>
        <Field label="Reason" htmlFor="ovr-reason" required error={fe.reason}>
          <Textarea id="ovr-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label="Evidence reference" htmlFor="ovr-ev" required error={fe.evidence} hint="e.g. approved deadline change, dispute ID, task baseline revision">
          <Input id="ovr-ev" value={evidence} onChange={(e) => setEvidence(e.target.value)} />
        </Field>
        {m.error && !Object.keys(fe).length && <InlineError message={errorMessage(m.error)} />}
      </div>
    </Dialog>
  );
}
