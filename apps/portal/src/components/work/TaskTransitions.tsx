"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, Lock, Play, RotateCcw, ShieldAlert, Unlock, UserCheck } from "lucide-react";
import type { Task } from "@/lib/types";
import { TRANSITION_LABELS, type TaskDetail } from "@/lib/api/work";
import { api, ApiError, errorMessage } from "@/lib/api/transport";
import { Button, ConfirmDialog, Field, Input, Select } from "@/components/ui";
import { VersionConflictDialog } from "@/components/domain";
import { useToast } from "@/components/ui/toast";

const ICONS: Record<string, React.ReactNode> = {
  assign: <UserCheck className="h-4 w-4" />,
  start: <Play className="h-4 w-4" />,
  block: <Lock className="h-4 w-4" />,
  unblock: <Unlock className="h-4 w-4" />,
  complete: <CheckCircle2 className="h-4 w-4" />,
  cancel: <Ban className="h-4 w-4" />,
  reopen: <RotateCcw className="h-4 w-4" />,
  override_dependencies: <ShieldAlert className="h-4 w-4" />,
};

const DIRECT = new Set(["start", "unblock"]);

export function TaskTransitions({ detail }: { detail: TaskDetail }) {
  const { task, permissions } = detail;
  const qc = useQueryClient();
  const toast = useToast();
  const [action, setAction] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ApiError | null>(null);
  const [party, setParty] = useState("");
  const [credit, setCredit] = useState("NO_CREDIT");

  const refresh = () => qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && /^\/(tasks|projects|dashboard|reviews)/.test(q.queryKey[0] as string) });

  const run = async (a: string, reason?: string) => {
    setBusy(a);
    setError(null);
    try {
      await api.post<Task>(`/tasks/${task.id}/transitions`, { action: a, reason, responsibleParty: party || undefined, creditDisposition: credit }, { ifMatch: task.version });
      toast({ tone: "success", title: `${TRANSITION_LABELS[a] ?? a} done` });
      setAction(null);
      setParty("");
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === "VERSION_CONFLICT") {
        setAction(null);
        setConflict(e);
      } else if (action) setError(errorMessage(e));
      else toast({ tone: "error", title: `Couldn't ${TRANSITION_LABELS[a]?.toLowerCase() ?? a}`, body: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  if (!permissions.transitions.length) return null;

  const needsReason = action !== null && ["block", "cancel", "reopen", "override_dependencies"].includes(action);
  const tone = action === "cancel" ? "danger" : action === "complete" ? "success" : "primary";
  const descriptions: Record<string, string> = {
    assign: "Validates the brief, assignee, reviewer, estimate and acceptance checklist, then notifies the assignee.",
    block: "Records the blocker and who must resolve it. Unblocking returns the task to its current state; deadlines stay unchanged unless edited explicitly.",
    complete: "Administrative closure of accepted output. Confirms there are no unresolved obligations.",
    cancel: "Cancels the task. History is preserved, pending uploads are cleaned up and the credit disposition is recorded.",
    reopen: "Invalidates the current acceptance going forward. The original approval is preserved and a score/payroll impact review is triggered.",
    override_dependencies: "Allows the assignee to start before blocking predecessors are complete. The override is recorded in the task history.",
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {permissions.transitions.map((a) => (
          <Button
            key={a}
            size="sm"
            variant={a === "cancel" ? "outline" : a === "start" || a === "assign" || a === "complete" ? "primary" : "outline"}
            className={a === "cancel" ? "text-red-700" : undefined}
            icon={ICONS[a]}
            loading={busy === a && DIRECT.has(a)}
            onClick={() => (DIRECT.has(a) ? run(a) : (setError(null), setAction(a)))}
          >
            {TRANSITION_LABELS[a] ?? a}
          </Button>
        ))}
      </div>
      <ConfirmDialog
        open={!!action}
        onClose={() => setAction(null)}
        onConfirm={(reason) => {
          if (action === "block" && !party.trim()) {
            setError("Name who is responsible for unblocking.");
            return;
          }
          run(action!, reason);
        }}
        title={`${TRANSITION_LABELS[action ?? ""] ?? ""}: ${task.title}`}
        description={action ? descriptions[action] : undefined}
        confirmLabel={TRANSITION_LABELS[action ?? ""] ?? "Confirm"}
        tone={tone}
        requireReason={needsReason}
        reasonLabel={action === "block" ? "Blocker" : "Reason"}
        loading={!!busy}
        error={error}
      >
        {action === "block" && (
          <Field label="Responsible party" htmlFor="blk-party" required hint="Who needs to act, e.g. “Client content team” or a person.">
            <Input id="blk-party" value={party} onChange={(e) => setParty(e.target.value)} />
          </Field>
        )}
        {action === "cancel" && (
          <Field label="Credit disposition" htmlFor="cancel-credit">
            <Select id="cancel-credit" value={credit} onChange={(e) => setCredit(e.target.value)}>
              <option value="NO_CREDIT">No output credit</option>
              <option value="REMOVE_FROM_COMMITMENT">Remove from committed points (baseline revision)</option>
              <option value="PARTIAL_BY_MANAGER">Partial credit decided by manager</option>
            </Select>
          </Field>
        )}
      </ConfirmDialog>
      <VersionConflictDialog
        error={conflict}
        mine={task as unknown as Record<string, unknown>}
        fields={["state", "assigneeId", "reviewerId", "dueAt", "baselinePoints", "priority", "version"]}
        onClose={() => setConflict(null)}
        onReload={() => {
          setConflict(null);
          refresh();
        }}
      />
    </>
  );
}
