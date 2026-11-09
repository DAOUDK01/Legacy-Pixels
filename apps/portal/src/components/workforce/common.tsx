"use client";

import type { ReactNode } from "react";
import { ApiError } from "@/lib/api/transport";
import { useLookups } from "@/lib/api/hooks";
import { Field, Input, Select } from "@/components/ui";

export function fieldError(err: unknown, field: string): string | undefined {
  return err instanceof ApiError ? err.body.fieldErrors?.[field] : undefined;
}

/** Top-level error message when it isn't a per-field validation error. */
export function formError(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof ApiError) {
    if (err.body.fieldErrors && Object.keys(err.body.fieldErrors).length) return null;
    return err.body.message;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export function EmployeePicker({
  value, onChange, label = "Employee", includeSelf = true, selfId, allowAll, filter,
}: {
  value: string; onChange: (v: string) => void; label?: string; includeSelf?: boolean; selfId?: string; allowAll?: string; filter?: (e: { id: string; employmentStatus: string }) => boolean;
}) {
  const { data } = useLookups();
  const emps = (data?.employees ?? [])
    .filter((e) => e.employmentStatus === "ACTIVE")
    .filter((e) => includeSelf || e.id !== selfId)
    .filter((e) => (filter ? filter(e) : true))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  return (
    <Field label={label} htmlFor="emp-picker" className="min-w-[200px]">
      <Select id="emp-picker" value={value} onChange={(e) => onChange(e.target.value)}>
        {allowAll && <option value="">{allowAll}</option>}
        {emps.map((e) => (
          <option key={e.id} value={e.id}>
            {e.displayName}{e.id === selfId ? " (me)" : ""} · {e.employeeCode}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function DateRange({ from, to, onChange, children }: { from: string; to: string; onChange: (from: string, to: string) => void; children?: ReactNode }) {
  return (
    <>
      <Field label="From" htmlFor="range-from">
        <Input id="range-from" type="date" value={from} max={to} onChange={(e) => e.target.value && onChange(e.target.value, to)} />
      </Field>
      <Field label="To" htmlFor="range-to">
        <Input id="range-to" type="date" value={to} min={from} onChange={(e) => e.target.value && onChange(from, e.target.value)} />
      </Field>
      {children}
    </>
  );
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
