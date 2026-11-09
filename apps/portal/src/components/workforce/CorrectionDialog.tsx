"use client";

import { useEffect, useState } from "react";
import type { DailyAttendance } from "@/lib/types";
import { useApiMutation } from "@/lib/api/hooks";
import { fmtTime, zonedToUtc } from "@/lib/time";
import { Button, Dialog, Field, InlineError, Input, Notice, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { fieldError, formError } from "./common";

export function CorrectionDialog({ day, timezone, onClose }: { day: DailyAttendance | null; timezone: string; onClose: () => void }) {
  const toast = useToast();
  const [inT, setIn] = useState("");
  const [outT, setOut] = useState("");
  const [outDate, setOutDate] = useState("");
  const [reason, setReason] = useState("");
  const m = useApiMutation("POST", "/attendance/corrections", {
    invalidate: ["/me/attendance", "/attendance", "/dashboard"],
    onSuccess: () => {
      toast({ tone: "success", title: "Correction submitted", body: "Your manager validates it, then HR approves. The original records are kept." });
      onClose();
    },
  });
  useEffect(() => {
    if (day) {
      setIn(day.checkIn ? fmtTime(day.checkIn, timezone) : "");
      setOut(day.checkOut ? fmtTime(day.checkOut, timezone) : "");
      // Overnight shifts check out on the next calendar day
      setOutDate(day.scheduledEnd ? new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(day.scheduledEnd)) : day.businessDate);
      setReason("");
      m.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);
  if (!day) return null;
  const submit = () => {
    const origIn = day.checkIn ? fmtTime(day.checkIn, timezone) : "";
    const origOut = day.checkOut ? fmtTime(day.checkOut, timezone) : "";
    m.mutate({
      body: {
        businessDate: day.businessDate,
        proposedCheckIn: inT && inT !== origIn ? zonedToUtc(day.businessDate, inT, timezone) : undefined,
        proposedCheckOut: outT && outT !== origOut ? zonedToUtc(outDate || day.businessDate, outT, timezone) : undefined,
        reason,
      },
    });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Request a correction for ${day.businessDate}`}
      description={`Times are in ${timezone}. Change only what was wrong.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={m.isPending} onClick={submit}>Submit correction</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Check-in" htmlFor="cor-in" error={fieldError(m.error, "proposedCheckIn")}>
            <Input id="cor-in" type="time" value={inT} onChange={(e) => setIn(e.target.value)} />
          </Field>
          <Field label="Check-out date" htmlFor="cor-out-date">
            <Input id="cor-out-date" type="date" value={outDate} onChange={(e) => setOutDate(e.target.value)} />
          </Field>
          <Field label="Check-out" htmlFor="cor-out" error={fieldError(m.error, "proposedCheckOut")}>
            <Input id="cor-out" type="time" value={outT} onChange={(e) => setOut(e.target.value)} />
          </Field>
        </div>
        <Field label="Reason" required htmlFor="cor-reason" error={fieldError(m.error, "reason") ?? fieldError(m.error, "businessDate")} hint="Explain what happened, e.g. a forgotten checkout. Reference a work log if you have one.">
          <Textarea id="cor-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </Field>
        <Notice tone="slate">Original attendance events stay on record. An approved correction creates a new revision and recomputes the day. If the payroll period is already locked, an adjustment is proposed for the next period instead.</Notice>
        {formError(m.error) && <InlineError message={formError(m.error)!} />}
      </div>
    </Dialog>
  );
}
