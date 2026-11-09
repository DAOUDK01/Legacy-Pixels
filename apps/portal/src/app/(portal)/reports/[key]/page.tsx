"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Download } from "lucide-react";
import { useApiQuery, useLookups } from "@/lib/api/hooks";
import { api, errorMessage } from "@/lib/api/transport";
import type { ExportResult, ReportResult } from "@/lib/api/admin";
import { REPORT_CATALOG } from "@/lib/api/admin";
import { addDays } from "@/lib/time";
import { Button, Card, Field, FilterBar, Input, PageHeader, QueryState, Select, Table, TBody, TD, TH, THead, TR, cn } from "@/components/ui";
import { ReportMeta, StateBadge } from "@/components/domain";
import { useToast } from "@/components/ui/toast";

const STATE_COLUMNS = new Set(["state", "status"]);

export default function ReportViewer() {
  const { key } = useParams<{ key: string }>();
  const today = new Date().toISOString().slice(0, 10);
  const [filters, setFilters] = useState({ from: addDays(today, -30), to: today, team: "", project: "", employee: "", status: "" });
  const lookups = useLookups();
  const q = useApiQuery<ReportResult>(`/reports/${key}`, filters);
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const cat = REPORT_CATALOG.find((r) => r.key === key);
  const set = (k: keyof typeof filters) => (e: { target: { value: string } }) => setFilters({ ...filters, [k]: e.target.value });

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await api.post<ExportResult>("/reports/exports", { key, filters });
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast({ tone: "success", title: "Export ready", body: "The export was logged and its download link expires in 24 hours." });
    } catch (e) {
      toast({ tone: "error", title: "Export failed", body: errorMessage(e) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: cat?.title ?? key }]}
        title={cat?.title ?? "Report"}
        description={cat?.description}
        actions={<Button variant="outline" icon={<Download className="h-4 w-4" />} loading={exporting} disabled={!q.data} onClick={exportCsv}>Export CSV</Button>}
      />
      <Card>
        <FilterBar>
          <Field label="From" htmlFor="rf-from" className="w-40"><Input id="rf-from" type="date" value={filters.from} max={filters.to} onChange={set("from")} /></Field>
          <Field label="To" htmlFor="rf-to" className="w-40"><Input id="rf-to" type="date" value={filters.to} min={filters.from} onChange={set("to")} /></Field>
          <Field label="Team" htmlFor="rf-team" className="w-40">
            <Select id="rf-team" value={filters.team} onChange={set("team")}><option value="">All visible</option>{lookups.data?.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
          </Field>
          <Field label="Project" htmlFor="rf-proj" className="w-44">
            <Select id="rf-proj" value={filters.project} onChange={set("project")}><option value="">All visible</option>{lookups.data?.projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</Select>
          </Field>
          <Field label="Employee" htmlFor="rf-emp" className="w-48">
            <Select id="rf-emp" value={filters.employee} onChange={set("employee")}><option value="">All visible</option>{lookups.data?.employees.map((e) => <option key={e.id} value={e.id}>{e.displayName}</option>)}</Select>
          </Field>
          <Field label="Status" htmlFor="rf-status" className="w-40"><Input id="rf-status" placeholder="e.g. IN_PROGRESS" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value.toUpperCase() })} /></Field>
        </FilterBar>
        <QueryState query={q} rows={8}>
          {(r) => (
            <>
              {r.rows.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-slate-500">No rows for these filters.</p>
              ) : (
                <Table>
                  <THead><tr>{r.columns.map((c) => <TH key={c.key} className={c.align === "right" ? "text-right" : ""}>{c.label}</TH>)}</tr></THead>
                  <TBody>
                    {r.rows.map((row, i) => (
                      <TR key={i}>
                        {r.columns.map((c) => {
                          const v = row[c.key];
                          return (
                            <TD key={c.key} className={cn(c.align === "right" && "text-right tabular-nums", "whitespace-nowrap", c.key === "feedback" && "whitespace-normal min-w-[16rem]")}>
                              {v === null || v === undefined ? <span className="text-slate-400">—</span> : STATE_COLUMNS.has(c.key) && typeof v === "string" ? <StateBadge state={v} /> : String(v)}
                            </TD>
                          );
                        })}
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
              <div className="space-y-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
                {r.notes?.map((n) => <p key={n} className="text-xs text-slate-500">{n}</p>)}
                <ReportMeta timezone={r.meta.timezone} generatedAt={r.meta.generatedAt} cutoff={r.meta.dataCutoff} policyVersion={r.meta.policyVersion} state={r.meta.state} />
                <p className="text-xs text-slate-400">{r.rows.length} row(s). Values outside your authorization are omitted or shown as “Restricted”.</p>
              </div>
            </>
          )}
        </QueryState>
      </Card>
    </>
  );
}
