"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, ShieldCheck } from "lucide-react";
import { useApiMutation, useApiQuery } from "@/lib/api/hooks";
import type { Notification } from "@/lib/types";
import { fmtDateTime, relativeTime } from "@/lib/time";
import { Button, Card, PageHeader, QueryState, Tabs, cn } from "@/components/ui";
import { humanize } from "@/components/domain";

export default function NotificationsPage() {
  const [tab, setTab] = useState<"all" | "unread">("all");
  const router = useRouter();
  const q = useApiQuery<{ items: Notification[]; unread: number }>("/notifications", tab === "unread" ? { unread: "true" } : undefined);
  const readAll = useApiMutation("POST", "/notifications/read-all", { invalidate: ["/notifications"] });
  const read = useApiMutation("POST", "/notifications/x/read", { invalidate: ["/notifications"] });

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Reading a notification never approves the request it refers to. Links recheck your permissions when opened."
        actions={<Button variant="outline" icon={<CheckCheck className="h-4 w-4" />} loading={readAll.isPending} onClick={() => readAll.mutate()}>Mark all read</Button>}
      />
      <Card>
        <Tabs className="px-3" value={tab} onChange={setTab} tabs={[{ value: "all", label: "All" }, { value: "unread", label: "Unread", count: q.data?.unread }]} />
        <QueryState query={q} empty={(d) => d.items.length === 0} emptyTitle="No notifications">
          {(d) => (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {d.items.map((n) => (
                <li key={n.id} className={cn("flex items-start gap-3 px-5 py-4", !n.readAt && "bg-brand-50/40 dark:bg-brand-950/20")}>
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-slate-200" : "bg-brand-600")} aria-label={n.readAt ? "Read" : "Unread"} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {n.mandatory && <ShieldCheck className="h-4 w-4 text-amber-600" aria-label="Mandatory notice" />}
                      {n.title}
                      <span className="text-xs font-normal text-slate-400">{humanize(n.kind)}</span>
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">{n.body}</p>
                    <p className="mt-1 text-xs text-slate-400" title={fmtDateTime(n.createdAt)}>{relativeTime(n.createdAt)}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {n.href && (
                      <Button size="sm" variant="outline" onClick={async () => { await read.mutateAsync({ path: `/notifications/${n.id}/read` }); router.push(n.href!); }}>Open</Button>
                    )}
                    {!n.readAt && <Button size="sm" variant="ghost" onClick={() => read.mutate({ path: `/notifications/${n.id}/read` })}>Mark read</Button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </Card>
    </>
  );
}
