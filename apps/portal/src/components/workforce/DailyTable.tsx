"use client";

import type { DailyAttendance } from "@/lib/types";
import { fmtDate, fmtMinutes, fmtTime, weekday } from "@/lib/time";
import { Button, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { StateBadge } from "@/components/domain";
import { WEEKDAYS } from "./common";

export function DailyTable({ days, timezone, onCorrect }: { days: DailyAttendance[]; timezone: string; onCorrect?: (d: DailyAttendance) => void }) {
  return (
    <Table>
      <THead>
        <tr>
          <TH>Date</TH>
          <TH>Status</TH>
          <TH>Scheduled</TH>
          <TH>In</TH>
          <TH>Out</TH>
          <TH className="text-right">Breaks</TH>
          <TH className="text-right">Credited</TH>
          <TH className="text-right">Tracked</TH>
          <TH className="text-right">OT</TH>
          <TH>Notes</TH>
          {onCorrect && <TH><span className="sr-only">Actions</span></TH>}
        </tr>
      </THead>
      <TBody>
        {days.map((d) => (
          <TR key={d.businessDate}>
            <TD className="whitespace-nowrap">
              <span className="font-medium text-slate-900 dark:text-slate-100">{fmtDate(d.businessDate)}</span>
              <span className="ml-1.5 text-xs text-slate-400">{WEEKDAYS[weekday(d.businessDate)]}</span>
            </TD>
            <TD>
              <div className="flex items-center gap-1.5">
                <StateBadge state={d.status} />
                {d.provisional && <span className="text-[11px] text-amber-600" title="Provisional until reviewed">prov.</span>}
              </div>
            </TD>
            <TD className="whitespace-nowrap text-xs text-slate-500">
              {d.scheduledStart ? `${fmtTime(d.scheduledStart, timezone)}–${fmtTime(d.scheduledEnd, timezone)}` : "—"}
              {d.scheduledMinutes > 0 && <span className="block">{fmtMinutes(d.scheduledMinutes)} eligible</span>}
            </TD>
            <TD className="tabular-nums">{fmtTime(d.checkIn, timezone)}</TD>
            <TD className="tabular-nums">{d.checkOut ? fmtTime(d.checkOut, timezone) : d.checkIn ? <span className="text-amber-600">—</span> : "—"}</TD>
            <TD className="text-right tabular-nums">{d.breakMinutes ? fmtMinutes(d.breakMinutes) : "—"}</TD>
            <TD className="text-right font-medium tabular-nums">{d.scheduledMinutes || d.creditedMinutes ? fmtMinutes(d.creditedMinutes) : "—"}</TD>
            <TD className="text-right tabular-nums text-slate-500" title="Authorized tracking session time (separate evidence)">{d.trackedMinutes ? fmtMinutes(d.trackedMinutes) : "—"}</TD>
            <TD className="text-right tabular-nums">{d.overtimeMinutes ? fmtMinutes(d.overtimeMinutes) : "—"}</TD>
            <TD className="max-w-[260px] text-xs text-slate-500">{d.flags.join(" · ") || "—"}</TD>
            {onCorrect && (
              <TD>
                {d.status !== "OFF" && d.status !== "HOLIDAY" && d.status !== "LEAVE" && !d.flags.includes("Future date") && !d.flags.includes("Correction pending") && (
                  <Button size="sm" variant="ghost" onClick={() => onCorrect(d)}>Correct</Button>
                )}
              </TD>
            )}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
