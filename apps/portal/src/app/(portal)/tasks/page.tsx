"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bookmark, Columns3, List, Plus, X } from "lucide-react";
import { useApiQuery, useLookups, useMe } from "@/lib/api/hooks";
import { can } from "@/lib/rbac";
import { PRIORITIES, TASK_STATES, type TaskList } from "@/lib/api/work";
import { Button, ButtonLink, Card, Field, FilterBar, Input, PageHeader, QueryState, Select, cn } from "@/components/ui";
import { humanize } from "@/components/domain";
import { TaskBoard, TaskTable } from "@/components/work/TaskViews";

interface Filters {
  mine: boolean;
  projectId: string;
  assigneeId: string;
  state: string;
  priority: string;
  dueFrom: string;
  dueTo: string;
  q: string;
  overdue: boolean;
}

const EMPTY: Filters = { mine: false, projectId: "", assigneeId: "", state: "", priority: "", dueFrom: "", dueTo: "", q: "", overdue: false };
const SAVED_KEY = "lp.tasks.savedFilters";

export default function TasksPage() {
  return (
    <Suspense>
      <Tasks />
    </Suspense>
  );
}

function Tasks() {
  const params = useSearchParams();
  const router = useRouter();
  const me = useMe();
  const lookups = useLookups();
  const [view, setView] = useState<"list" | "board">((params.get("view") as "board") ?? "list");
  const [f, setF] = useState<Filters>({
    ...EMPTY,
    mine: params.get("mine") === "1",
    projectId: params.get("projectId") ?? "",
    state: params.get("state") ?? "",
    overdue: params.get("overdue") === "1",
  });
  const [q, setQ] = useState(f.q);
  const [saved, setSaved] = useState<{ name: string; filters: Filters }[]>([]);

  useEffect(() => {
    try {
      setSaved(JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]"));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setF((x) => ({ ...x, q })), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const sp = new URLSearchParams();
    if (f.mine) sp.set("mine", "1");
    if (f.projectId) sp.set("projectId", f.projectId);
    if (f.state) sp.set("state", f.state);
    if (f.overdue) sp.set("overdue", "1");
    if (view === "board") sp.set("view", "board");
    router.replace(`/tasks${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  }, [f.mine, f.projectId, f.state, f.overdue, view, router]);

  const query = useMemo(
    () => ({
      mine: f.mine ? "1" : undefined,
      projectId: f.projectId || undefined,
      assigneeId: f.assigneeId || undefined,
      state: f.state || undefined,
      priority: f.priority || undefined,
      dueFrom: f.dueFrom || undefined,
      dueTo: f.dueTo || undefined,
      q: f.q || undefined,
      overdue: f.overdue ? "1" : undefined,
      includeClosed: f.state ? undefined : "1",
    }),
    [f],
  );
  const tasks = useApiQuery<TaskList>("/tasks", query);
  const canCreate = can(me.data, "task.manage");
  const isEmployeeOnly = me.data && !can(me.data, "task.read:organization") && !can(me.data, "task.read:team");
  const active = Object.entries(f).filter(([k, v]) => v && k !== "q").length + (f.q ? 1 : 0);

  const saveCurrent = () => {
    const name = window.prompt("Name this filter");
    if (!name) return;
    const next = [...saved.filter((s) => s.name !== name), { name, filters: f }];
    setSaved(next);
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <PageHeader
        title={f.mine ? "My tasks" : "Tasks"}
        description="Filter by project, assignee, status, priority and due date. Changes to status happen on each task through validated transitions."
        actions={
          <>
            <div className="flex rounded-md border border-slate-200 p-0.5 dark:border-slate-700" role="group" aria-label="View">
              <button aria-pressed={view === "list"} onClick={() => setView("list")} className={cn("flex items-center gap-1.5 rounded px-2.5 py-1 text-sm", view === "list" ? "bg-slate-100 font-medium dark:bg-slate-800" : "text-slate-500")}><List className="h-4 w-4" /> List</button>
              <button aria-pressed={view === "board"} onClick={() => setView("board")} className={cn("flex items-center gap-1.5 rounded px-2.5 py-1 text-sm", view === "board" ? "bg-slate-100 font-medium dark:bg-slate-800" : "text-slate-500")}><Columns3 className="h-4 w-4" /> Board</button>
            </div>
            {canCreate && <ButtonLink href={`/tasks/new${f.projectId ? `?projectId=${f.projectId}` : ""}`} variant="primary" icon={<Plus className="h-4 w-4" />}>New task</ButtonLink>}
          </>
        }
      />
      <Card>
        <FilterBar>
          <Field label="Search" htmlFor="t-q" className="w-full sm:w-56"><Input id="t-q" type="search" placeholder="Title or brief" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
          <Field label="Project" htmlFor="t-p" className="w-full sm:w-48">
            <Select id="t-p" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}>
              <option value="">All visible</option>
              {lookups.data?.projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
            </Select>
          </Field>
          {!isEmployeeOnly && (
            <Field label="Assignee" htmlFor="t-a" className="w-full sm:w-44">
              <Select id="t-a" value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })} disabled={f.mine}>
                <option value="">Anyone</option>
                {lookups.data?.employees.filter((e) => e.employmentStatus === "ACTIVE").map((e) => <option key={e.id} value={e.id}>{e.displayName}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Status" htmlFor="t-s" className="w-full sm:w-44">
            <Select id="t-s" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}>
              <option value="">All</option>
              {TASK_STATES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="t-pr" className="w-full sm:w-32">
            <Select id="t-pr" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
              <option value="">All</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
            </Select>
          </Field>
          <Field label="Due from" htmlFor="t-df" className="w-full sm:w-40"><Input id="t-df" type="date" value={f.dueFrom} onChange={(e) => setF({ ...f, dueFrom: e.target.value })} /></Field>
          <Field label="Due to" htmlFor="t-dt" className="w-full sm:w-40"><Input id="t-dt" type="date" value={f.dueTo} onChange={(e) => setF({ ...f, dueTo: e.target.value })} /></Field>
          <div className="flex flex-wrap items-center gap-2 pb-0.5">
            {me.data?.employee && (
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={f.mine} onChange={(e) => setF({ ...f, mine: e.target.checked, assigneeId: "" })} className="rounded border-slate-300" /> Mine</label>
            )}
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={f.overdue} onChange={(e) => setF({ ...f, overdue: e.target.checked })} className="rounded border-slate-300" /> Overdue</label>
            {active > 0 && <Button size="sm" variant="ghost" icon={<X className="h-4 w-4" />} onClick={() => { setF(EMPTY); setQ(""); }}>Clear</Button>}
            <Button size="sm" variant="ghost" icon={<Bookmark className="h-4 w-4" />} onClick={saveCurrent}>Save filter</Button>
          </div>
        </FilterBar>
        {saved.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-2 text-xs dark:border-slate-800">
            <span className="text-slate-500">Saved:</span>
            {saved.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                <button className="hover:underline" onClick={() => { setF(s.filters); setQ(s.filters.q); }}>{s.name}</button>
                <button aria-label={`Delete saved filter ${s.name}`} onClick={() => { const n = saved.filter((x) => x.name !== s.name); setSaved(n); try { localStorage.setItem(SAVED_KEY, JSON.stringify(n)); } catch {} }}><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
        )}
        <QueryState query={tasks} rows={8}>
          {(d) => (
            <>
              <p className="px-5 pt-3 text-xs text-slate-500">{d.total} task(s)</p>
              {view === "list" ? <TaskTable tasks={d.items} showProject={!f.projectId} /> : <TaskBoard tasks={d.items} showProject={!f.projectId} />}
            </>
          )}
        </QueryState>
      </Card>
    </>
  );
}
