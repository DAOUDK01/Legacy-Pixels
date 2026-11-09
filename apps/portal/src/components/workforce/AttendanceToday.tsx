"use client";

import { Coffee, LogIn, LogOut, Play } from "lucide-react";
import { useApiMutation } from "@/lib/api/hooks";
import type { AttendanceResponse } from "@/lib/api/workforce";
import { fmtTime } from "@/lib/time";
import { Button, Card, CardBody, CardHeader, InlineError } from "@/components/ui";
import { StateBadge, humanize } from "@/components/domain";
import { useToast } from "@/components/ui/toast";
import { formError } from "./common";

const ACTIONS = {
  CHECK_IN: { label: "Check in", icon: LogIn, variant: "primary" as const },
  BREAK_START: { label: "Start break", icon: Coffee, variant: "outline" as const },
  BREAK_END: { label: "End break", icon: Play, variant: "primary" as const },
  CHECK_OUT: { label: "Check out", icon: LogOut, variant: "outline" as const },
};

const STATUS_STATE: Record<string, string> = { NOT_CHECKED_IN: "PENDING", WORKING: "ACTIVE", ON_BREAK: "PAUSED", CHECKED_OUT: "COMPLETED" };

export function AttendanceToday({ data, timezone }: { data: AttendanceResponse["today"]; timezone: string }) {
  const toast = useToast();
  const m = useApiMutation<{ status: string }>("POST", "/attendance/events", {
    invalidate: ["/me/attendance", "/attendance", "/dashboard", "/tracking"],
    onSuccess: (r) => toast({ tone: "success", title: `Recorded: ${humanize(r.status)}` }),
  });
  return (
    <Card>
      <CardHeader
        title="Today"
        description={data.shift ? `${data.shift.name}${data.shift.start ? ` · ${fmtTime(data.shift.start, timezone)}–${fmtTime(data.shift.end, timezone)}` : ""}` : "No shift scheduled today"}
        actions={<StateBadge state={STATUS_STATE[data.status]} label={humanize(data.status)} />}
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {data.nextActions.map((a) => {
            const cfg = ACTIONS[a];
            const Icon = cfg.icon;
            return (
              <Button key={a} variant={cfg.variant} icon={<Icon className="h-4 w-4" />} loading={m.isPending && (m.variables as { body?: { kind?: string } } | undefined)?.body?.kind === a} disabled={m.isPending} onClick={() => m.mutate({ body: { kind: a } })}>
                {cfg.label}
              </Button>
            );
          })}
        </div>
        {formError(m.error) && <InlineError message={formError(m.error)!} />}
        {data.events.length > 0 && (
          <ol className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
            {data.events.map((e) => (
              <li key={e.id}>
                <span className="font-medium text-slate-800 dark:text-slate-200">{humanize(e.kind)}</span> {fmtTime(e.occurredAt, timezone)}
                <span className="text-slate-400"> · {e.source.toLowerCase()}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="text-xs text-slate-500">
          Checking in records attendance only. It does not start activity tracking — that only happens when you start a session in the desktop agent.
        </p>
      </CardBody>
    </Card>
  );
}
