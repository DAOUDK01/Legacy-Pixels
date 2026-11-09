"use client";

import { useState } from "react";
import { CalendarPlus, Moon, Pencil, Plus } from "lucide-react";
import { useApiMutation, useApiQuery, useLookups, useMe } from "@/lib/api/hooks";
import type { ShiftsResponse } from "@/lib/api/workforce";
import type { ShiftTemplate } from "@/lib/types";
import { can } from "@/lib/rbac";
import { businessDate, fmtDate, fmtMinutes, weekday } from "@/lib/time";
import { ApiError } from "@/lib/api/transport";
import {
  Badge, Button, Card, CardHeader, Checkbox, Dialog, Field, InlineError, Input, Notice, PageHeader, QueryState, Table, TBody, TD, TH, THead, TR,
} from "@/components/ui";
import { VersionConflictDialog } from "@/components/domain";
import { useToast } from "@/components/ui/toast";
import { WEEKDAYS, fieldError, formError } from "@/components/workforce/common";

const spanMinutes = (s: Pick<ShiftTemplate, "localStart" | "localEnd">) => {
  const [a, b] = [s.localStart, s.localEnd].map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)));
  return b > a ? b - a : 1440 - a + b;
};

export default function ShiftsPage() {
  const me = useMe();
  const q = useApiQuery<ShiftsResponse>("/shifts");
  const manage = !!me.data && can(me.data, "shift.manage");
  const [editing, setEditing] = useState<ShiftTemplate | "new" | null>(null);
  const [addingHoliday, setAddingHoliday] = useState(false);
  const { data: lookups } = useLookups();
  const teamName = (id: string) => lookups?.teams.find((t) => t.id === id)?.name ?? id;
  const today = businessDate(new Date(), me.data?.organization.timezone);

  return (
    <>
      <PageHeader
        title="Shifts & holidays"
        description="Effective-dated shift templates resolve to UTC in each template's IANA timezone. Overnight shifts belong to their scheduled start date."
        actions={manage && (
          <>
            <Button variant="outline" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setAddingHoliday(true)}>Add holiday</Button>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>New shift template</Button>
          </>
        )}
      />
      <QueryState query={q} rows={6}>
        {(d) => (
          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Shift templates" description="Changes record a new version and audit entry; past days keep the schedule that applied then." />
              <Table>
                <THead><tr><TH>Name</TH><TH>Hours</TH><TH>Days</TH><TH>Breaks</TH><TH>Grace</TH><TH>Teams</TH><TH>Effective</TH>{manage && <TH><span className="sr-only">Edit</span></TH>}</tr></THead>
                <TBody>
                  {d.templates.map((s) => {
                    const overnight = s.localEnd <= s.localStart;
                    return (
                      <TR key={s.id}>
                        <TD>
                          <span className="font-medium text-slate-900 dark:text-slate-100">{s.name}</span>
                          <span className="block text-xs text-slate-500">{s.timezone} · v{s.version}</span>
                        </TD>
                        <TD className="whitespace-nowrap tabular-nums">
                          {s.localStart}–{s.localEnd}
                          {overnight && <Badge tone="purple" className="ml-1.5"><Moon className="h-3 w-3" />Overnight</Badge>}
                          <span className="block text-xs text-slate-500">{fmtMinutes(spanMinutes(s) - s.unpaidBreakMinutes)} paid</span>
                        </TD>
                        <TD className="text-xs">{s.weekdays.map((w) => WEEKDAYS[w]).join(", ")}</TD>
                        <TD className="text-xs">{s.unpaidBreakMinutes}m unpaid{s.paidBreakMinutes ? ` · ${s.paidBreakMinutes}m paid` : ""}</TD>
                        <TD className="text-xs">{s.graceMinutes}m</TD>
                        <TD className="text-xs">{s.assignedTeamIds.length ? s.assignedTeamIds.map(teamName).join(", ") : <span className="text-slate-400">None</span>}</TD>
                        <TD className="whitespace-nowrap text-xs">{fmtDate(s.effectiveFrom)}{s.effectiveTo ? ` – ${fmtDate(s.effectiveTo)}` : " onward"}</TD>
                        {manage && <TD><Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(s)}>Edit</Button></TD>}
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </Card>
            <Card>
              <CardHeader title="Holidays" description="Configured by the organization — no statutory calendar is assumed." />
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {d.holidays.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span>
                      <span className="font-medium">{h.name}</span>
                      <span className="block text-xs text-slate-500">{WEEKDAYS[weekday(h.date)]}, {fmtDate(h.date)}</span>
                    </span>
                    {h.date < today ? <Badge>Past</Badge> : <Badge tone="purple">Upcoming</Badge>}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}
      </QueryState>
      {editing && <ShiftEditor shift={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {addingHoliday && <HolidayDialog onClose={() => setAddingHoliday(false)} />}
    </>
  );
}

function ShiftEditor({ shift, onClose }: { shift: ShiftTemplate | null; onClose: () => void }) {
  const me = useMe();
  const { data: lookups } = useLookups();
  const toast = useToast();
  const [form, setForm] = useState({
    name: shift?.name ?? "",
    timezone: shift?.timezone ?? me.data?.organization.timezone ?? "Asia/Karachi",
    localStart: shift?.localStart ?? "09:00",
    localEnd: shift?.localEnd ?? "18:00",
    weekdays: shift?.weekdays ?? [1, 2, 3, 4, 5],
    paidBreakMinutes: shift?.paidBreakMinutes ?? 0,
    unpaidBreakMinutes: shift?.unpaidBreakMinutes ?? 60,
    graceMinutes: shift?.graceMinutes ?? 10,
    effectiveFrom: shift?.effectiveFrom ?? businessDate(new Date()),
    effectiveTo: shift?.effectiveTo ?? "",
    assignedTeamIds: shift?.assignedTeamIds ?? [],
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const m = useApiMutation(shift ? "PATCH" : "POST", shift ? `/shifts/${shift.id}` : "/shifts", {
    invalidate: ["/shifts", "/attendance", "/me/attendance"],
    onSuccess: () => {
      toast({ tone: "success", title: shift ? "Shift updated" : "Shift created" });
      onClose();
    },
  });
  const overnight = form.localEnd <= form.localStart;
  const err = (k: string) => fieldError(m.error, k);
  return (
    <>
      <Dialog
        open
        size="lg"
        onClose={onClose}
        title={shift ? `Edit ${shift.name}` : "New shift template"}
        footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate({ body: form, ifMatch: shift?.version })}>Save</Button></>}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required htmlFor="sh-name" error={err("name")}><Input id="sh-name" value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Timezone (IANA)" htmlFor="sh-tz"><Input id="sh-tz" value={form.timezone} onChange={(e) => set("timezone", e.target.value)} /></Field>
          <Field label="Local start" required htmlFor="sh-start" error={err("localStart")}><Input id="sh-start" type="time" value={form.localStart} onChange={(e) => set("localStart", e.target.value)} /></Field>
          <Field label="Local end" required htmlFor="sh-end" error={err("localEnd")} hint={overnight ? "Ends the next day — the shift belongs to its start date." : undefined}><Input id="sh-end" type="time" value={form.localEnd} onChange={(e) => set("localEnd", e.target.value)} /></Field>
          <Field label="Unpaid break (min)" htmlFor="sh-ub" error={err("unpaidBreakMinutes")}><Input id="sh-ub" type="number" min={0} value={form.unpaidBreakMinutes} onChange={(e) => set("unpaidBreakMinutes", Number(e.target.value))} /></Field>
          <Field label="Paid break (min)" htmlFor="sh-pb" error={err("paidBreakMinutes")}><Input id="sh-pb" type="number" min={0} value={form.paidBreakMinutes} onChange={(e) => set("paidBreakMinutes", Number(e.target.value))} /></Field>
          <Field label="Grace (min)" htmlFor="sh-grace" error={err("graceMinutes")} hint="Affects late status only; it never adds worked minutes."><Input id="sh-grace" type="number" min={0} value={form.graceMinutes} onChange={(e) => set("graceMinutes", Number(e.target.value))} /></Field>
          <div />
          <Field label="Effective from" required htmlFor="sh-from" error={err("effectiveFrom")}><Input id="sh-from" type="date" value={form.effectiveFrom} onChange={(e) => set("effectiveFrom", e.target.value)} /></Field>
          <Field label="Effective to" htmlFor="sh-to" error={err("effectiveTo")}><Input id="sh-to" type="date" value={form.effectiveTo} onChange={(e) => set("effectiveTo", e.target.value)} /></Field>
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-sm font-medium">Weekdays</legend>
            <div className="flex flex-wrap gap-4">
              {WEEKDAYS.map((w, i) => (
                <Checkbox key={w} label={w} checked={form.weekdays.includes(i)} onChange={(v) => set("weekdays", v ? [...form.weekdays, i].sort() : form.weekdays.filter((x) => x !== i))} />
              ))}
            </div>
            {err("weekdays") && <p className="mt-1 text-xs text-red-600">{err("weekdays")}</p>}
          </fieldset>
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-sm font-medium">Assigned teams</legend>
            <div className="flex flex-wrap gap-4">
              {lookups?.teams.map((t) => (
                <Checkbox key={t.id} label={t.name} checked={form.assignedTeamIds.includes(t.id)} onChange={(v) => set("assignedTeamIds", v ? [...form.assignedTeamIds, t.id] : form.assignedTeamIds.filter((x) => x !== t.id))} />
              ))}
            </div>
          </fieldset>
          <div className="sm:col-span-2">
            <Notice tone="slate">Paid duration: {fmtMinutes(spanMinutes(form) - form.unpaidBreakMinutes)} per day. Days with DST transitions are resolved by the server from the timezone, not by assuming 24 hours.</Notice>
          </div>
          {formError(m.error) && <div className="sm:col-span-2"><InlineError message={formError(m.error)!} /></div>}
        </div>
      </Dialog>
      <VersionConflictDialog
        error={m.error instanceof ApiError ? m.error : null}
        mine={shift ? { ...shift, ...form } : undefined}
        fields={["name", "localStart", "localEnd", "weekdays", "graceMinutes", "unpaidBreakMinutes", "version"]}
        onClose={() => m.reset()}
        onReload={() => { m.reset(); onClose(); }}
      />
    </>
  );
}

function HolidayDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const m = useApiMutation("POST", "/holidays", {
    invalidate: ["/shifts", "/holidays", "/lookups", "/attendance", "/me/attendance"],
    onSuccess: () => {
      toast({ tone: "success", title: "Holiday added" });
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title="Add holiday" description="Holidays remove the day from eligible scheduled minutes." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate({ body: { date, name } })}>Add</Button></>}>
      <div className="space-y-4">
        <Field label="Date" required htmlFor="hol-date" error={fieldError(m.error, "date")}><Input id="hol-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Name" required htmlFor="hol-name" error={fieldError(m.error, "name")}><Input id="hol-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {formError(m.error) && <InlineError message={formError(m.error)!} />}
      </div>
    </Dialog>
  );
}
