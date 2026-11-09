"use client";

import Link from "next/link";
import {
  AlertTriangle, ArrowRight, CalendarCheck2, CheckCircle2, ClipboardCheck, Clock, FolderKanban, ListChecks, MonitorDot,
  Upload, Users, Wallet,
} from "lucide-react";
import { useApiQuery, useMe } from "@/lib/api/hooks";
import type { DashboardData } from "@/mock/handlers/identity";
import { fmtDateTime, fmtTime, isOverdue, relativeTime } from "@/lib/time";
import { Badge, ButtonLink, Card, CardBody, CardHeader, EmptyState, PageHeader, QueryState, Stat, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { Person, PriorityBadge, StateBadge, humanize } from "@/components/domain";

export default function DashboardPage() {
  const me = useMe();
  const q = useApiQuery<DashboardData>("/dashboard");
  const first = me.data?.employee?.displayName.split(" ")[0] ?? "there";
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: me.data?.organization.timezone }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHeader title={`${greeting}, ${first}`} description="Your assigned work, reviews, attendance and approvals in one place." />
      <QueryState query={q} rows={8}>
        {(d) => (
          <div className="space-y-6">
            {d.org && (
              <section aria-label="Organization overview" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat label="Active projects" value={d.org.activeProjects} icon={<FolderKanban className="h-4 w-4" />} tone="blue" href="/projects" />
                <Stat label="Open tasks" value={d.org.openTasks} hint={<span className={d.org.overdueTasks ? "text-red-600" : ""}>{d.org.overdueTasks} overdue</span>} icon={<ListChecks className="h-4 w-4" />} tone="cyan" href="/tasks" />
                <Stat label="Present today" value={`${d.org.presentToday}/${d.org.activeEmployees}`} hint={`${d.org.onLeaveToday} on leave · ${d.org.trackingNow} tracking now`} icon={<Users className="h-4 w-4" />} tone="green" href="/attendance" />
                <Stat label="Accepted output" value={`${d.org.outputAcceptedPoints} pts`} hint={`${d.org.pendingReviews} awaiting review`} icon={<CheckCircle2 className="h-4 w-4" />} tone="purple" href="/reports" />
              </section>
            )}

            <div className="grid gap-6 xl:grid-cols-3">
              <div className="min-w-0 space-y-6 xl:col-span-2">
                {(d.myTasks.open > 0 || d.attendance) && (
                  <Card>
                    <CardHeader
                      title="My tasks"
                      description={`${d.myTasks.open} open · ${d.myTasks.dueSoon} due in 3 days · ${d.myTasks.overdue} overdue · ${d.myTasks.revision} need revision`}
                      actions={<ButtonLink href="/tasks?mine=1" size="sm">All my tasks</ButtonLink>}
                    />
                    {d.myTasks.items.length === 0 ? (
                      <EmptyState title="No open tasks" description="New assignments will appear here." />
                    ) : (
                      <Table>
                        <THead>
                          <tr><TH>Task</TH><TH>Status</TH><TH>Priority</TH><TH>Due</TH></tr>
                        </THead>
                        <TBody>
                          {d.myTasks.items.map((t) => (
                            <TR key={t.id}>
                              <TD><Link href={`/tasks/${t.id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline dark:text-slate-100">{t.title}</Link></TD>
                              <TD><StateBadge state={t.state} /></TD>
                              <TD><PriorityBadge priority={t.priority} /></TD>
                              <TD className={isOverdue(t.dueAt) && t.state !== "SUBMITTED" ? "font-medium text-red-600" : ""}>{fmtDateTime(t.dueAt)}</TD>
                            </TR>
                          ))}
                        </TBody>
                      </Table>
                    )}
                  </Card>
                )}

                {d.pendingReviews.count > 0 && (
                  <Card>
                    <CardHeader title="Pending reviews" description="Submissions waiting for your decision." actions={<ButtonLink href="/reviews" size="sm">Review queue</ButtonLink>} />
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                      {d.pendingReviews.items.map(({ task, submission }) => (
                        <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                          <div className="min-w-0">
                            <Link href={`/tasks/${task.id}/review`} className="font-medium hover:underline">{task.title}</Link>
                            <p className="text-xs text-slate-500">v{submission?.sequence} submitted {submission?.submittedAt ? relativeTime(submission.submittedAt) : ""}</p>
                          </div>
                          <Person id={task.assigneeId} />
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                {d.team && (
                  <Card>
                    <CardHeader title="Team workload" description="Open work per employee, including submitted items awaiting review." actions={<ButtonLink href="/tasks" size="sm">Assign work</ButtonLink>} />
                    <Table>
                      <THead><tr><TH>Employee</TH><TH className="text-right">Open</TH><TH className="text-right">Points</TH><TH className="text-right">Overdue</TH><TH className="text-right">Blocked</TH></tr></THead>
                      <TBody>
                        {d.team.workload.map((w) => (
                          <TR key={w.employee.id}>
                            <TD><Person id={w.employee.id} showTitle /></TD>
                            <TD className="text-right tabular-nums">{w.open}</TD>
                            <TD className="text-right tabular-nums">{w.points}</TD>
                            <TD className="text-right">{w.overdue ? <Badge tone="red">{w.overdue}</Badge> : <span className="text-slate-400">0</span>}</TD>
                            <TD className="text-right">{w.blocked ? <Badge tone="amber">{w.blocked}</Badge> : <span className="text-slate-400">0</span>}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </Card>
                )}
              </div>

              <div className="min-w-0 space-y-6">
                {d.attendance && (
                  <Card>
                    <CardHeader title="Attendance today" actions={<ButtonLink href="/attendance" size="sm">Open</ButtonLink>} />
                    <CardBody className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-slate-400" />
                        <StateBadge state={d.attendance.status === "WORKING" ? "ACTIVE" : d.attendance.status === "ON_BREAK" ? "PAUSED" : d.attendance.status === "CHECKED_OUT" ? "COMPLETED" : "PENDING"} label={humanize(d.attendance.status)} />
                        {d.attendance.since && <span className="text-xs text-slate-500">since {fmtTime(d.attendance.since)}</span>}
                      </div>
                      {d.attendance.shift && <p className="text-xs text-slate-500">Scheduled: {d.attendance.shift}</p>}
                    </CardBody>
                  </Card>
                )}
                {d.tracking && (
                  <Card>
                    <CardHeader title="Authorized tracking" actions={<ButtonLink href="/tracking" size="sm">Details</ButtonLink>} />
                    <CardBody className="space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <MonitorDot className="h-4 w-4 text-slate-400" />
                        {d.tracking.state === "NONE" ? <span className="text-slate-600">No active session. Nothing is being collected.</span> : <StateBadge state={d.tracking.state} label={`Session ${humanize(d.tracking.state).toLowerCase()}`} />}
                      </div>
                      {d.tracking.pendingUploads > 0 && <p className="flex items-center gap-1.5 text-xs text-slate-500"><Upload className="h-3.5 w-3.5" /> {d.tracking.pendingUploads} capture(s) waiting to upload</p>}
                    </CardBody>
                  </Card>
                )}
                <Card>
                  <CardHeader title="Approvals for you" />
                  {d.approvals.length === 0 ? (
                    <EmptyState icon={<CalendarCheck2 className="h-6 w-6" />} title="Nothing waiting" description="Requests that need your decision will show here." />
                  ) : (
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                      {d.approvals.map((a) => (
                        <li key={a.label}>
                          <Link href={a.href} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50">
                            <span>{a.label}</span>
                            <span className="flex items-center gap-2"><Badge tone="amber">{a.count}</Badge><ArrowRight className="h-4 w-4 text-slate-400" /></span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                {d.syncIssues.count > 0 && (
                  <Card>
                    <CardHeader title="Sync issues" description="Pending uploads and coverage gaps. Gaps are shown as unknown, never as idle or worked time." />
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                      {d.syncIssues.items.map((s, i) => (
                        <li key={i}>
                          <Link href={s.href} className="flex items-start gap-2 px-5 py-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                            {s.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
                {d.org?.payrollState && (
                  <Card>
                    <CardHeader title="Payroll" actions={<ButtonLink href="/payroll" size="sm">Open</ButtonLink>} />
                    <CardBody className="flex items-center gap-2 text-sm">
                      <Wallet className="h-4 w-4 text-slate-400" /> Current run: <StateBadge state={d.org.payrollState} />
                    </CardBody>
                  </Card>
                )}
                {!d.attendance && !d.org && d.pendingReviews.count === 0 && (
                  <Card><EmptyState icon={<ClipboardCheck className="h-6 w-6" />} title="Read-only access" description="Your role gives read-only access to granted records. Use Reports and the Audit log." /></Card>
                )}
              </div>
            </div>
          </div>
        )}
      </QueryState>
    </>
  );
}
