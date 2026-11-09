"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApiQuery, useMe } from "@/lib/api/hooks";
import type { DisputeListResponse, ScoreListResponse } from "@/lib/api/performance";
import type { ScoreDispute, ScoreSnapshot } from "@/lib/types";
import { can } from "@/lib/rbac";
import {
  Badge, Button, Card, CardBody, CardHeader, EmptyState, FilterBar, Field, PageHeader, QueryState, Select, Table, TBody, TD, TH, THead, TR, Tabs,
} from "@/components/ui";
import { Person, StateBadge } from "@/components/domain";
import { CoachingNotice, ComponentRows, DisputeDialog, DisputeList, ResolveDisputeDialog, ScoreHeadline, fmtScore, periodLabel } from "@/components/performance/score-ui";

export default function ScoresPage() {
  const me = useMe();
  const teamView = can(me.data, "score.read:organization") || can(me.data, "score.read:team");
  const [tab, setTab] = useState<"mine" | "team" | "disputes">("mine");
  const hasOwn = !!me.data?.employee && can(me.data, "score.read:self");
  const active = !hasOwn && tab === "mine" ? "team" : tab;

  const tabs = [
    ...(hasOwn ? [{ value: "mine" as const, label: "My score" }] : []),
    ...(teamView ? [{ value: "team" as const, label: can(me.data, "score.read:organization") ? "Organization" : "My team" }, { value: "disputes" as const, label: "Disputes" }] : []),
  ];

  return (
    <>
      <PageHeader title="Productivity scores" description="P = 0.25 Attendance + 0.30 Approved output + 0.20 Quality + 0.15 Deadlines + 0.10 Work-log accuracy. Every input is shown so you can check it." />
      <div className="mb-4"><CoachingNotice /></div>
      {tabs.length > 1 && <Tabs className="mb-6" value={active} onChange={setTab} tabs={tabs} />}
      {active === "mine" && hasOwn && <MyScores employeeId={me.data!.employee!.id} />}
      {active === "team" && teamView && <TeamScores />}
      {active === "disputes" && teamView && <DisputeQueue canResolve={can(me.data, "score.dispute.resolve")} />}
    </>
  );
}

function MyScores({ employeeId }: { employeeId: string }) {
  const q = useApiQuery<ScoreListResponse>("/scores", { employeeId });
  const [disputing, setDisputing] = useState<ScoreSnapshot | null>(null);
  return (
    <QueryState query={q} empty={(d) => d.items.length === 0} emptyTitle="No score snapshots yet" emptyDescription="Snapshots are computed daily once you have scheduled time, committed output or work logs in a period.">
      {(d) => (
        <div className="space-y-6">
          {d.items.map((s) => (
            <Card key={s.id}>
              <CardHeader
                title={s.periodStart >= d.currentPeriodStart ? "Current period" : "Previous period"}
                description={`${periodLabel(s)} · computed ${new Date(s.computedAt).toLocaleString("en-GB")}`}
                actions={
                  <>
                    <Link className="text-sm font-medium text-brand-600 hover:underline" href={`/scores/${s.id}`}>Details & disputes</Link>
                    <Button size="sm" variant="outline" onClick={() => setDisputing(s)}>Dispute</Button>
                  </>
                }
              />
              <CardBody><ScoreHeadline snapshot={s} /></CardBody>
              <div className="border-t border-slate-100 dark:border-slate-800"><ComponentRows components={s.components} /></div>
            </Card>
          ))}
          {disputing && <DisputeDialog open onClose={() => setDisputing(null)} snapshot={disputing} />}
        </div>
      )}
    </QueryState>
  );
}

function TeamScores() {
  const [period, setPeriod] = useState<"current" | "previous">("previous");
  const router = useRouter();
  const q = useApiQuery<ScoreListResponse>("/scores", { period });
  const avg = useMemo(() => {
    const xs = (q.data?.items ?? []).filter((s) => s.coverageWeight >= 0.999 && s.weightedScore !== null);
    return xs.length ? xs.reduce((a, s) => a + (s.weightedScore ?? 0), 0) / xs.length : null;
  }, [q.data]);
  return (
    <Card>
      <CardHeader title="Score snapshots" description={avg !== null ? `Average comparable score ${avg.toFixed(1)} (excludes partial-coverage snapshots)` : "Select a snapshot to see its inputs."} />
      <FilterBar>
        <Field label="Period" htmlFor="sc-period">
          <Select id="sc-period" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} className="w-44">
            <option value="previous">Previous (final)</option>
            <option value="current">Current (provisional)</option>
          </Select>
        </Field>
      </FilterBar>
      <QueryState query={q} empty={(d) => d.items.length === 0} emptyTitle="No snapshots in this period">
        {(d) => (
          <Table>
            <THead>
              <tr><TH>Employee</TH><TH>Period</TH>{["A", "O", "Q", "D", "L"].map((k) => <TH key={k} className="text-right">{k}</TH>)}<TH className="text-right">Score</TH><TH>Coverage</TH><TH>Status</TH></tr>
            </THead>
            <TBody>
              {d.items.map((s) => (
                <TR key={s.id} onClick={() => router.push(`/scores/${s.id}`)}>
                  <TD><Person id={s.employeeId} showTitle /></TD>
                  <TD className="whitespace-nowrap text-xs">{periodLabel(s)}</TD>
                  {s.components.map((c) => <TD key={c.key} className="text-right tabular-nums">{c.value === null ? <span className="text-slate-400">N/A</span> : c.value.toFixed(0)}</TD>)}
                  <TD className="text-right font-semibold tabular-nums">{fmtScore(s.override?.score ?? s.weightedScore)}</TD>
                  <TD>{s.coverageWeight >= 0.999 ? <Badge tone="green">Full</Badge> : <Badge tone="amber">{Math.round(s.coverageWeight * 100)}%</Badge>}</TD>
                  <TD><StateBadge state={s.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </QueryState>
    </Card>
  );
}

function DisputeQueue({ canResolve }: { canResolve: boolean }) {
  const [status, setStatus] = useState("open");
  const q = useApiQuery<DisputeListResponse>("/disputes", { status });
  const [resolving, setResolving] = useState<ScoreDispute | null>(null);
  return (
    <Card>
      <CardHeader title="Score disputes" description="Employees can dispute inputs within 7 days of a finalized snapshot." />
      <FilterBar>
        <Field label="Status" htmlFor="dq-status">
          <Select id="dq-status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
            <option value="open">Open / under review</option>
            <option value="UPHELD">Upheld</option>
            <option value="REJECTED">Rejected</option>
            <option value="">All</option>
          </Select>
        </Field>
      </FilterBar>
      <QueryState query={q} empty={(d) => d.items.length === 0} emptyTitle="No disputes">
        {(d) => (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {d.items.map((x) => (
              <li key={x.id}>
                <div className="flex flex-wrap items-center gap-3 px-5 pt-3">
                  <Person id={x.employeeId} />
                  <Link href={`/scores/${x.snapshotId}`} className="text-xs text-brand-600 hover:underline">View snapshot</Link>
                </div>
                <DisputeList disputes={[x]} onResolve={canResolve ? setResolving : undefined} />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      {!canResolve && <EmptyState title="Read-only" description="Only the owner or a designated reviewer can resolve disputes." />}
      <ResolveDisputeDialog dispute={resolving} onClose={() => setResolving(null)} />
    </Card>
  );
}
