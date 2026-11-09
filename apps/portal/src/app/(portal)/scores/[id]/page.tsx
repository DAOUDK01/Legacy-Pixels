"use client";

import { use, useState } from "react";
import { useApiQuery } from "@/lib/api/hooks";
import type { ScoreDetail } from "@/lib/api/performance";
import type { ScoreDispute } from "@/lib/types";
import { fmtDateTime } from "@/lib/time";
import { Button, Card, CardBody, CardHeader, Notice, PageHeader, QueryState } from "@/components/ui";
import { Person } from "@/components/domain";
import { CoachingNotice, ComponentRows, DisputeDialog, DisputeList, OverrideDialog, ResolveDisputeDialog, ScoreHeadline, periodLabel } from "@/components/performance/score-ui";

export default function ScoreDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useApiQuery<ScoreDetail>(`/scores/${id}`);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [resolving, setResolving] = useState<ScoreDispute | null>(null);

  return (
    <QueryState query={q} rows={8}>
      {(d) => (
        <>
          <PageHeader
            breadcrumbs={[{ label: "Scores", href: "/scores" }, { label: periodLabel(d.snapshot) }]}
            title={d.isOwn ? "My score" : <span className="inline-flex items-center gap-3"><Person id={d.snapshot.employeeId} size={32} /></span>}
            description={`${periodLabel(d.snapshot)} · computed ${fmtDateTime(d.snapshot.computedAt)}`}
            actions={
              <>
                {d.isOwn && <Button variant="outline" disabled={!d.canDispute} title={d.disputeBlockedReason} onClick={() => setDisputeOpen(true)}>Dispute</Button>}
                {d.canOverride && <Button variant="outline" onClick={() => setOverrideOpen(true)}>Override</Button>}
              </>
            }
          />
          <div className="space-y-6">
            <CoachingNotice />
            {d.isOwn && !d.canDispute && d.disputeBlockedReason && <Notice tone="amber">{d.disputeBlockedReason}</Notice>}
            {d.isOwn && d.disputeDeadline && d.canDispute && <Notice tone="blue">You can dispute this finalized snapshot until {fmtDateTime(d.disputeDeadline)}.</Notice>}
            <Card>
              <CardBody><ScoreHeadline snapshot={d.snapshot} /></CardBody>
              <div className="border-t border-slate-100 dark:border-slate-800"><ComponentRows components={d.snapshot.components} /></div>
            </Card>
            <Card>
              <CardHeader title="Disputes" description="Disputes and their outcomes are kept with the snapshot." />
              <DisputeList disputes={d.disputes} onResolve={d.canResolve ? setResolving : undefined} />
            </Card>
          </div>
          <DisputeDialog open={disputeOpen} onClose={() => setDisputeOpen(false)} snapshot={d.snapshot} />
          <OverrideDialog open={overrideOpen} onClose={() => setOverrideOpen(false)} snapshot={d.snapshot} />
          <ResolveDisputeDialog dispute={resolving} onClose={() => setResolving(null)} />
        </>
      )}
    </QueryState>
  );
}
