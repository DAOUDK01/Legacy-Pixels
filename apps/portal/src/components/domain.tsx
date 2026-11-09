"use client";

/** Small domain-aware display components shared across screens. */
import type { ReactNode } from "react";
import { GitCompare } from "lucide-react";
import { Avatar, Badge, Button, Dialog, type Tone } from "@/components/ui";
import { useLookups } from "@/lib/api/hooks";
import { ApiError } from "@/lib/api/transport";
import { formatMoney } from "@/lib/calc/money";
import { fmtDateTime } from "@/lib/time";

const STATE_TONES: Record<string, Tone> = {
  // generic
  DRAFT: "slate", PENDING: "amber", APPROVED: "green", REJECTED: "red", CANCELLED: "slate", WITHDRAWN: "slate",
  ACTIVE: "green", INVITED: "blue", SUSPENDED: "amber", OFFBOARDED: "slate", REVOKED: "red",
  // project
  ON_HOLD: "amber", COMPLETED: "purple", ARCHIVED: "slate",
  // task
  ASSIGNED: "blue", IN_PROGRESS: "cyan", SUBMITTED: "purple", REVISION_REQUESTED: "amber", BLOCKED: "red",
  // media
  INITIATED: "slate", RECEIVING: "blue", SCANNING: "blue", TRANSFERRING: "blue", AVAILABLE: "green", FAILED: "red", QUARANTINED: "red", EXPIRED: "slate", DELETED: "slate",
  // submissions
  SUPERSEDED: "slate",
  // attendance
  PRESENT: "green", LATE: "amber", ABSENT: "red", LEAVE: "blue", HOLIDAY: "purple", INCOMPLETE: "amber", UNKNOWN: "slate", OFF: "slate",
  PROPOSED: "amber", MANAGER_VALIDATED: "blue",
  // overtime
  MANAGER_RECOMMENDED: "blue", PAYROLL_VALIDATED: "green", FLAGGED: "red",
  // tracking
  STOPPED: "slate", STARTING: "blue", PAUSED: "amber", IDLE: "amber",
  // score
  PROVISIONAL: "amber", FINAL: "green", DISPUTED: "red", OVERRIDDEN: "purple", OPEN: "amber", UNDER_REVIEW: "blue", UPHELD: "green",
  // payroll
  LOCKED: "purple", EXPORTED: "cyan", PAID: "green", CLOSED: "slate",
  // assets
  RETURN_REQUESTED: "amber", RETURNED: "blue", MAINTENANCE: "amber", RETIRED: "slate",
  // policy
  PENDING_APPROVAL: "amber",
  // audit
  SUCCESS: "green", DENIED: "red",
};

export function humanize(state: string): string {
  const s = state.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function StateBadge({ state, label }: { state: string; label?: string }) {
  return (
    <Badge tone={STATE_TONES[state] ?? "slate"} dot>
      {label ?? humanize(state)}
    </Badge>
  );
}

const PRIORITY_TONE: Record<string, Tone> = { LOW: "slate", MEDIUM: "blue", HIGH: "amber", URGENT: "red" };
export function PriorityBadge({ priority }: { priority: string }) {
  return <Badge tone={PRIORITY_TONE[priority] ?? "slate"}>{humanize(priority)}</Badge>;
}

export function Person({ id, showTitle, size = 24 }: { id?: string; showTitle?: boolean; size?: number }) {
  const { data } = useLookups();
  if (!id) return <span className="text-slate-400">Unassigned</span>;
  const e = data?.employees.find((x) => x.id === id);
  if (!e) return <span className="text-slate-500">Restricted</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Avatar name={e.displayName} color={e.avatarColor} size={size} />
      <span className="min-w-0">
        <span className="block truncate text-sm text-slate-900 dark:text-slate-100">{e.displayName}</span>
        {showTitle && <span className="block truncate text-xs text-slate-500">{e.title}</span>}
      </span>
    </span>
  );
}

export function MoneyText({ amount, currency, className }: { amount: string; currency: string; className?: string }) {
  return <span className={`tabular-nums ${className ?? ""}`}>{formatMoney(amount, currency)}</span>;
}

/** Report/footer metadata required on every report (section 16). */
export function ReportMeta({ timezone, generatedAt, cutoff, policyVersion, state }: { timezone: string; generatedAt: string; cutoff: string; policyVersion: number; state: "PROVISIONAL" | "FINAL" }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
      <span>Timezone: {timezone}</span>
      <span>Generated: {fmtDateTime(generatedAt, timezone)}</span>
      <span>Data cutoff: {fmtDateTime(cutoff, timezone)}</span>
      <span>Policy v{policyVersion}</span>
      <StateBadge state={state} />
    </div>
  );
}

/**
 * Shown when a mutation fails with 409 VERSION_CONFLICT: displays what changed between the version
 * the user edited and the latest server version before they retry (section 4).
 */
export function VersionConflictDialog({ error, mine, onClose, onReload, fields }: { error: ApiError | null; mine?: Record<string, unknown>; onClose: () => void; onReload: () => void; fields?: string[] }) {
  const latest = (error?.body.latest ?? {}) as Record<string, unknown>;
  const keys = (fields ?? Object.keys(latest)).filter((k) => !["organizationId", "createdAt"].includes(k));
  const changed = keys.filter((k) => mine && JSON.stringify(mine[k]) !== JSON.stringify(latest[k]));
  return (
    <Dialog
      open={!!error && error.code === "VERSION_CONFLICT"}
      onClose={onClose}
      title="This record changed"
      description="Someone else updated it after you opened it. Compare the changes, then reload and retry."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Keep editing</Button>
          <Button icon={<GitCompare className="h-4 w-4" />} onClick={onReload}>Load latest version</Button>
        </>
      }
    >
      {changed.length === 0 ? (
        <p className="text-sm text-slate-600">The latest version is v{String(latest.version ?? "?")}. Reload to continue.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-slate-500">
              <th className="py-1">Field</th>
              <th className="py-1">Your copy</th>
              <th className="py-1">Latest</th>
            </tr>
          </thead>
          <tbody>
            {changed.map((k) => (
              <tr key={k} className="border-t border-slate-100 align-top dark:border-slate-800">
                <td className="py-2 pr-3 font-medium">{k}</td>
                <td className="py-2 pr-3 font-mono text-xs text-red-700">{short(mine?.[k])}</td>
                <td className="py-2 font-mono text-xs text-emerald-700">{short(latest[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}

function short(v: unknown): ReactNode {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > 120 ? s.slice(0, 117) + "…" : s ?? "—";
}

export function SectionTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{children}</h3>
      {actions}
    </div>
  );
}
