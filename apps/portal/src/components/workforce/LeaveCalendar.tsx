"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useApiQuery, useLookups } from "@/lib/api/hooks";
import type { LeaveRequestRow } from "@/lib/api/workforce";
import { addDays, businessDate } from "@/lib/time";
import { Avatar, Button, Card, CardHeader, QueryState, cn } from "@/components/ui";
import { WEEKDAYS } from "./common";

/** Team availability month grid. Colleagues see only that someone is unavailable, never type or notes. */
export function LeaveCalendar() {
  const [month, setMonth] = useState(() => businessDate(new Date()).slice(0, 7));
  const first = `${month}-01`;
  const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const last = `${month}-${String(daysInMonth).padStart(2, "0")}`;
  const q = useApiQuery<LeaveRequestRow[]>("/leave-requests", { scope: "team", from: first, to: last });
  const { data: lookups } = useLookups();
  const today = businessDate(new Date());
  const lead = new Date(`${first}T12:00:00Z`).getUTCDay();
  const cells = useMemo(() => [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => addDays(first, i))], [lead, daysInMonth, first]);
  const shift = (n: number) => {
    const d = new Date(`${first}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  };
  const label = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${first}T12:00:00Z`));
  const holiday = (d: string) => lookups?.holidays.find((h) => h.date === d);

  return (
    <Card>
      <CardHeader
        title="Team availability"
        description="Shows who is away. Leave type and notes stay private to the employee and HR."
        actions={
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="min-w-[120px] text-center text-sm font-medium">{label}</span>
            <Button size="icon" variant="ghost" aria-label="Next month" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        }
      />
      <QueryState query={q}>
        {(rows) => (
          <div className="overflow-x-auto p-3">
            <div className="grid min-w-[640px] grid-cols-7 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 dark:border-slate-800 dark:bg-slate-800">
              {WEEKDAYS.map((w) => (
                <div key={w} className="bg-slate-50 px-2 py-1.5 text-center text-xs font-semibold text-slate-500 dark:bg-slate-900">{w}</div>
              ))}
              {cells.map((d, i) => {
                if (!d) return <div key={`x${i}`} className="min-h-[84px] bg-slate-50/60 dark:bg-slate-900/60" />;
                const away = rows.filter((r) => r.startDate <= d && r.endDate >= d);
                const h = holiday(d);
                const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
                return (
                  <div key={d} className={cn("min-h-[84px] bg-white p-1.5 dark:bg-slate-950", (wd === 0 || wd === 6) && "bg-slate-50 dark:bg-slate-900")}>
                    <div className="flex items-center justify-between">
                      <span className={cn("text-xs", d === today ? "flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 font-semibold text-white" : "text-slate-500")}>{Number(d.slice(8))}</span>
                    </div>
                    {h && <p className="mt-1 truncate rounded bg-violet-50 px-1 text-[10px] text-violet-700 dark:bg-violet-950 dark:text-violet-300">{h.name}</p>}
                    <ul className="mt-1 space-y-0.5">
                      {away.slice(0, 3).map((r) => {
                        const e = lookups?.employees.find((x) => x.id === r.employeeId);
                        return (
                          <li key={r.id} className={cn("flex items-center gap-1 truncate rounded px-1 text-[11px]", r.status === "PENDING" ? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200" : "bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200")} title={`${r.employeeName} — ${r.status === "PENDING" ? "pending" : "away"}${r.partialMinutes ? ` (part day)` : ""}`}>
                            <Avatar name={r.employeeName} color={e?.avatarColor} size={12} />
                            <span className="truncate">{r.employeeName.split(" ")[0]}{r.partialMinutes ? " ½" : ""}</span>
                          </li>
                        );
                      })}
                      {away.length > 3 && <li className="text-[10px] text-slate-500">+{away.length - 3} more</li>}
                    </ul>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-blue-200" /> Away (approved)</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-amber-200" /> Pending</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-violet-200" /> Holiday</span>
            </div>
          </div>
        )}
      </QueryState>
    </Card>
  );
}
