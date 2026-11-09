"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useApiQuery, useMe } from "@/lib/api/hooks";
import { can } from "@/lib/rbac";
import type { Page, Project } from "@/lib/types";
import { PROJECT_STATES } from "@/lib/api/work";
import { fmtDate } from "@/lib/time";
import { Button, Card, Field, FilterBar, Input, PageHeader, Progress, QueryState, Select, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { Person, StateBadge, humanize } from "@/components/domain";
import { ProjectFormDialog } from "@/components/work/ProjectForm";

export default function ProjectsPage() {
  const me = useMe();
  const router = useRouter();
  const [state, setState] = useState("");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const list = useApiQuery<Page<Project>>("/projects", { state: state || undefined, q: debounced || undefined, limit: 100 });

  return (
    <>
      <PageHeader
        title="Projects"
        description="Archived projects stay readable but accept no new work."
        actions={can(me.data, "project.manage") && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New project</Button>}
      />
      <Card>
        <FilterBar>
          <Field label="Search" htmlFor="p-q" className="w-full sm:w-64"><Input id="p-q" type="search" placeholder="Name, code or reference" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
          <Field label="Status" htmlFor="p-s" className="w-full sm:w-44">
            <Select id="p-s" value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">All</option>
              {PROJECT_STATES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </Select>
          </Field>
        </FilterBar>
        <QueryState query={list} empty={(d) => d.items.length === 0} emptyTitle="No projects" emptyDescription="Projects you manage or belong to will appear here.">
          {(d) => (
            <Table>
              <THead><tr><TH>Project</TH><TH>Code</TH><TH>Manager</TH><TH>Status</TH><TH>Dates</TH><TH className="w-48">Completion</TH></tr></THead>
              <TBody>
                {d.items.map((p) => (
                  <TR key={p.id} onClick={() => router.push(`/projects/${p.id}`)}>
                    <TD className="min-w-[200px]">
                      <Link href={`/projects/${p.id}`} className="font-medium text-slate-900 hover:underline dark:text-slate-100" onClick={(e) => e.stopPropagation()}>{p.name}</Link>
                      {p.externalReference && <span className="block text-xs text-slate-500">{p.externalReference}</span>}
                    </TD>
                    <TD><span className="font-mono text-xs">{p.code}</span></TD>
                    <TD><Person id={p.managerId} /></TD>
                    <TD><StateBadge state={p.state} /></TD>
                    <TD className="whitespace-nowrap text-xs">{fmtDate(p.plannedStart)} – {fmtDate(p.plannedEnd)}</TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <Progress value={p.taskCounts.completed} max={p.taskCounts.total || 1} tone="green" label={`${p.name} completion`} />
                        <span className="whitespace-nowrap text-xs tabular-nums text-slate-500">{p.taskCounts.completed}/{p.taskCounts.total}</span>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </QueryState>
      </Card>
      {creating && <ProjectFormDialog onClose={() => setCreating(false)} onSaved={(p) => router.push(`/projects/${p.id}`)} />}
    </>
  );
}
