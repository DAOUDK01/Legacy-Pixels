"use client";

import { useEffect, useState } from "react";
import { EyeOff, Lock, ShieldAlert } from "lucide-react";
import type { ActivitySummaryRow } from "@/lib/types";
import type { ScreenshotView } from "@/lib/api/monitoring";
import { api, errorMessage } from "@/lib/api/transport";
import { fmtDateTime, fmtMinutes } from "@/lib/time";
import { Button, Dialog, Field, InlineError, Textarea, cn } from "@/components/ui";

export const SEGMENTS = [
  { key: "activeMinutes", label: "Active", color: "bg-emerald-500" },
  { key: "idleMinutes", label: "Idle (candidate)", color: "bg-amber-400" },
  { key: "pausedMinutes", label: "Paused", color: "bg-slate-400" },
  { key: "unknownMinutes", label: "Unknown coverage", color: "bg-[repeating-linear-gradient(45deg,#cbd5e1_0_4px,#f1f5f9_4px_8px)] dark:bg-[repeating-linear-gradient(45deg,#475569_0_4px,#1e293b_4px_8px)]" },
] as const;

type Mins = { activeMinutes: number; idleMinutes: number; pausedMinutes: number; unknownMinutes: number };

/** Active/idle/paused/unknown are mutually exclusive and sum to the session span — never more. */
export function SessionBar({ s, showLegend }: { s: Mins; showLegend?: boolean }) {
  const total = s.activeMinutes + s.idleMinutes + s.pausedMinutes + s.unknownMinutes;
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="img" aria-label={SEGMENTS.map((g) => `${g.label} ${fmtMinutes(s[g.key])}`).join(", ")}>
        {total > 0 && SEGMENTS.map((g) => <div key={g.key} className={g.color} style={{ width: `${(s[g.key] / total) * 100}%` }} />)}
      </div>
      {showLegend && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
          {SEGMENTS.map((g) => (
            <li key={g.key} className="flex items-center gap-1.5">
              <span className={cn("h-2.5 w-2.5 rounded-sm", g.color)} />
              {g.label} <span className="font-medium tabular-nums text-slate-800 dark:text-slate-200">{fmtMinutes(s[g.key])}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** App and domain durations shown as shares of active time; they never add up to more than the session. */
export function ActivityBreakdown({ rows, activeMinutes }: { rows: ActivitySummaryRow[]; activeMinutes: number }) {
  const apps = rows.filter((r) => r.kind === "APP").sort((a, b) => b.minutes - a.minutes);
  const domains = rows.filter((r) => r.kind === "DOMAIN").sort((a, b) => b.minutes - a.minutes);
  const List = ({ items, title, note }: { items: ActivitySummaryRow[]; title: string; note: string }) => (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mb-2 text-[11px] text-slate-400">{note}</p>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing recorded.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((r) => (
            <li key={r.label}>
              <div className="flex justify-between text-sm">
                <span className="truncate font-mono text-xs">{r.label}</span>
                <span className="tabular-nums text-xs text-slate-600">{fmtMinutes(r.minutes)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-full bg-brand-500" style={{ width: `${activeMinutes ? Math.min(100, (r.minutes / activeMinutes) * 100) : 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <List items={apps} title="Foreground apps" note="Executable name only — no window titles or command lines." />
      <List items={domains} title="Browser domains" note="Domain only from the managed browser extension. No paths, queries or private windows." />
    </div>
  );
}

function mulberry(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** Abstract placeholder for a capture. Demo mode never renders real screen content. */
export function CaptureArt({ seed, blurred, className }: { seed: number; blurred?: boolean; className?: string }) {
  const r = mulberry(seed);
  const hue = Math.floor(r() * 360);
  const blocks = Array.from({ length: 7 }, () => ({ x: r() * 70, y: 12 + r() * 70, w: 12 + r() * 30, h: 6 + r() * 20, o: 0.25 + r() * 0.5 }));
  return (
    <svg viewBox="0 0 160 100" className={cn("h-full w-full", blurred && "blur-[3px]", className)} aria-hidden>
      <defs>
        <linearGradient id={`g${seed}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={`hsl(${hue} 45% 92%)`} />
          <stop offset="1" stopColor={`hsl(${(hue + 60) % 360} 45% 82%)`} />
        </linearGradient>
      </defs>
      <rect width="160" height="100" fill={`url(#g${seed})`} />
      <rect width="160" height="8" fill={`hsl(${hue} 25% 35%)`} opacity="0.7" />
      <rect x="0" y="8" width="22" height="92" fill={`hsl(${hue} 20% 40%)`} opacity="0.25" />
      {blocks.map((b, i) => (
        <rect key={i} x={26 + b.x} y={b.y} width={b.w} height={b.h} rx="2" fill={`hsl(${(hue + i * 25) % 360} 50% 50%)`} opacity={b.o} />
      ))}
    </svg>
  );
}

export function ScreenshotTile({ id, captureAt, suppressionReason, restricted, onOpen, timezone }: { id: string; captureAt: string; suppressionReason?: string; restricted: boolean; onOpen?: () => void; timezone?: string }) {
  if (suppressionReason) {
    return (
      <div className="flex aspect-[16/10] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-2 text-center dark:border-slate-700 dark:bg-slate-900">
        <EyeOff className="h-4 w-4 text-slate-400" />
        <p className="text-[10px] leading-tight text-slate-500">Suppressed · no image kept</p>
        <p className="line-clamp-2 text-[10px] leading-tight text-slate-400">{suppressionReason}</p>
        <p className="text-[10px] text-slate-400">{fmtDateTime(captureAt, timezone)}</p>
      </div>
    );
  }
  return (
    <button onClick={onOpen} className="group relative block aspect-[16/10] overflow-hidden rounded-lg border border-slate-200 text-left focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-700">
      <CaptureArt seed={seedOf(id)} blurred={restricted} />
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1 pt-4 text-[10px] text-white">{fmtDateTime(captureAt, timezone)}</span>
      {restricted && (
        <span className="absolute inset-0 flex items-center justify-center bg-slate-900/40 text-[11px] font-medium text-white">
          <Lock className="mr-1 h-3 w-3" /> Restricted
        </span>
      )}
    </button>
  );
}

/**
 * Opens one capture. For anyone other than the employee, an access reason is required and audited
 * before the server returns the evidence (section 11).
 */
export function EvidenceDialog({ screenshotId, own, onClose, onRestrict }: { screenshotId: string | null; own: boolean; onClose: () => void; onRestrict?: () => void }) {
  const [reason, setReason] = useState("");
  const [view, setView] = useState<ScreenshotView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restrictMode, setRestrictMode] = useState(false);
  const [restrictReason, setRestrictReason] = useState("");
  const [restricted, setRestricted] = useState(false);

  const load = async (r?: string) => {
    setBusy(true);
    setError(null);
    try {
      setView(await api.get<ScreenshotView>(`/tracking/screenshots/${screenshotId}`, r ? { reason: r } : undefined));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    setView(null);
    setReason("");
    setError(null);
    setRestrictMode(false);
    setRestrictReason("");
    setRestricted(false);
    onClose();
  };
  useEffect(() => {
    if (screenshotId && own) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenshotId, own]);
  if (!screenshotId) return null;

  const submitRestrict = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/tracking/screenshots/${screenshotId}/restrict-request`, { reason: restrictReason });
      setRestricted(true);
      setRestrictMode(false);
      onRestrict?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={close} size="lg" title={view ? `Capture · ${fmtDateTime(view.screenshot.captureAt)}` : "View capture"} description={view ? `${view.employeeName} · ${view.screenshot.monitor}` : own ? undefined : "Screenshots are sensitive evidence. Your access and reason are recorded in the audit log and visible to the owner."}>
      {!view && !own && (
        <div className="space-y-4">
          <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
            <ShieldAlert className="h-5 w-5 shrink-0" />
            Only open evidence for a specific, documented purpose such as resolving a dispute or a reported coverage gap.
          </div>
          <Field label="Access reason" required htmlFor="ev-reason">
            <Textarea id="ev-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </Field>
          {error && <InlineError message={error} />}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close}>Cancel</Button>
            <Button loading={busy} disabled={reason.trim().length < 5} onClick={() => load(reason.trim())}>View capture</Button>
          </div>
        </div>
      )}
      {own && !view && (error ? <InlineError message={error} /> : <p className="text-sm text-slate-500">Loading…</p>)}
      {view && (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
            <div className="aspect-[16/10]"><CaptureArt seed={view.seed} blurred={view.screenshot.restricted || restricted} /></div>
          </div>
          <p className="text-xs text-slate-500">Demo placeholder. In production the image streams through the authenticated media endpoint with no-store caching; no public link exists.</p>
          {(view.screenshot.restricted || restricted) && <p className="flex items-center gap-1.5 text-sm text-amber-700"><Lock className="h-4 w-4" /> Restricted pending privacy review.</p>}
          {own && !view.screenshot.restricted && !restricted && (
            restrictMode ? (
              <div className="space-y-3">
                <Field label="Why should this capture be restricted or deleted?" required htmlFor="rs-reason" hint="Access is restricted immediately while the privacy reviewer decides, subject to approved retention.">
                  <Textarea id="rs-reason" value={restrictReason} onChange={(e) => setRestrictReason(e.target.value)} rows={2} />
                </Field>
                {error && <InlineError message={error} />}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setRestrictMode(false)}>Cancel</Button>
                  <Button variant="danger" loading={busy} onClick={submitRestrict}>Request restriction</Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" icon={<Lock className="h-4 w-4" />} onClick={() => setRestrictMode(true)}>Request restriction / deletion</Button>
            )
          )}
        </div>
      )}
    </Dialog>
  );
}
