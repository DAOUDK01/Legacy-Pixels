"use client";

import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api/transport";
import type { AuditEvent, Page } from "@/lib/types";
import { fmtDateTime } from "@/lib/time";
import { Button, Card, Field, FilterBar, Input, PageHeader, QueryState, Select, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { StateBadge } from "@/components/domain";

type AuditPage = Page<AuditEvent> & { total: number; targetTypes: string[] };

export default function AuditPage() {
  const [f, setF] = useState({ q: "", actor: "", action: "", targetType: "", result: "", from: "", to: "" });
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const cursor = cursors[cursors.length - 1];
  useEffect(() => setCursors([undefined]), [f]);
  const q = useQuery<AuditPage, ApiError>({
    queryKey: ["/audit", f, cursor],
    queryFn: () => api.get<AuditPage>("/audit", { ...f, cursor, limit: 25 }),
    placeholderData: (prev) => prev,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of sign-ins, privilege changes, sensitive reads, transitions, approvals, exports and retention actions. Credentials, screenshot bytes and HR document contents are never logged." />
      <Card>
        <FilterBar>
          <Field label="Search" htmlFor="au-q" className="w-full sm:w-56"><Input id="au-q" type="search" value={f.q} onChange={set("q")} placeholder="Action, target, reason" /></Field>
          <Field label="Actor" htmlFor="au-actor" className="w-40"><Input id="au-actor" value={f.actor} onChange={set("actor")} /></Field>
          <Field label="Action prefix" htmlFor="au-action" className="w-44"><Input id="au-action" value={f.action} onChange={set("action")} placeholder="payroll." /></Field>
          <Field label="Target" htmlFor="au-target" className="w-44">
            <Select id="au-target" value={f.targetType} onChange={set("targetType")}><option value="">Any</option>{q.data?.targetTypes.map((t) => <option key={t}>{t}</option>)}</Select>
          </Field>
          <Field label="Result" htmlFor="au-result" className="w-32">
            <Select id="au-result" value={f.result} onChange={set("result")}><option value="">Any</option><option>SUCCESS</option><option>DENIED</option><option>FAILED</option></Select>
          </Field>
          <Field label="From" htmlFor="au-from" className="w-40"><Input id="au-from" type="date" value={f.from} onChange={set("from")} /></Field>
          <Field label="To" htmlFor="au-to" className="w-40"><Input id="au-to" type="date" value={f.to} onChange={set("to")} /></Field>
        </FilterBar>
        <QueryState query={q} rows={10} empty={(d) => d.items.length === 0} emptyTitle="No audit events match">
          {(d) => (
            <>
              <Table>
                <THead><tr><TH /><TH>Time</TH><TH>Actor</TH><TH>Action</TH><TH>Target</TH><TH>Result</TH><TH>Reason</TH></tr></THead>
                <TBody>
                  {d.items.map((a) => {
                    const open = expanded === a.id;
                    return (
                      <Fragment key={a.id}>
                        <TR>
                          <TD className="w-8 px-2">
                            <button aria-label={open ? "Hide details" : "Show details"} aria-expanded={open} onClick={() => setExpanded(open ? null : a.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          </TD>
                          <TD className="whitespace-nowrap text-xs">{fmtDateTime(a.occurredAt)}</TD>
                          <TD className="whitespace-nowrap">{a.actorLabel}<span className="block text-[11px] text-slate-400">{a.actorType.toLowerCase()}</span></TD>
                          <TD className="font-mono text-xs">{a.action}</TD>
                          <TD className="text-xs">{a.targetType}<span className="block font-mono text-[11px] text-slate-400">{a.targetId}</span></TD>
                          <TD><StateBadge state={a.result} /></TD>
                          <TD className="max-w-xs truncate text-xs" >{a.reason ?? "—"}</TD>
                        </TR>
                        {open && (
                          <tr className="bg-slate-50 dark:bg-slate-900/60">
                            <td colSpan={7} className="px-6 py-4 text-xs">
                              <div className="grid gap-4 md:grid-cols-3">
                                <div><p className="font-semibold text-slate-600">Request</p><p className="font-mono">{a.requestId}</p><p className="mt-1 text-slate-500">Event {a.id}</p></div>
                                <div><p className="font-semibold text-slate-600">Before (redacted)</p><pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono">{a.change?.before ? JSON.stringify(a.change.before, null, 2) : "—"}</pre></div>
                                <div><p className="font-semibold text-slate-600">After (redacted)</p><pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono">{a.change?.after ? JSON.stringify(a.change.after, null, 2) : "—"}</pre></div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </TBody>
              </Table>
              <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500 dark:border-slate-800">
                <span>{d.total} event(s){q.isFetching ? " · loading…" : ""}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={cursors.length <= 1} onClick={() => setCursors(cursors.slice(0, -1))}>Previous</Button>
                  <Button size="sm" variant="outline" disabled={!d.nextCursor} onClick={() => setCursors([...cursors, d.nextCursor])}>Next</Button>
                </div>
              </div>
            </>
          )}
        </QueryState>
      </Card>
    </>
  );
}
