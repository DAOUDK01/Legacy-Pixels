import type { PayComponent, PayComponentCategory } from "@/lib/types";
import { add, dec, roundMinor, sub, toFixed } from "./money";

const POSITIVE: PayComponentCategory[] = ["BASE", "BONUS", "OVERTIME", "ADJUSTMENT"];

export interface LineTotals {
  gross: string;
  deductions: string;
  net: string;
  negative: boolean;
}

/**
 * Net payable = base + approved bonuses + approved overtime - approved deductions (section 14).
 * Each displayed component is rounded to minor units (half-up) and then summed.
 * Only APPROVED components count; proposed lines are excluded until approved.
 */
export function computeLine(
  components: Pick<PayComponent, "category" | "amount" | "status">[],
  minorDigits = 2,
): LineTotals {
  const approved = components.filter((c) => c.status === "APPROVED");
  const gross = add(...approved.filter((c) => POSITIVE.includes(c.category)).map((c) => roundMinor(dec(c.amount), minorDigits)));
  const deductions = add(
    ...approved.filter((c) => c.category === "DEDUCTION").map((c) => roundMinor(dec(c.amount), minorDigits)),
  );
  const net = sub(gross, deductions);
  return {
    gross: toFixed(gross, minorDigits),
    deductions: toFixed(deductions, minorDigits),
    net: toFixed(net, minorDigits),
    negative: net < 0n,
  };
}

export function sumMoney(values: string[], minorDigits = 2): string {
  return toFixed(add(...values.map((v) => dec(v))), minorDigits);
}

/**
 * Deterministic input fingerprint used in the mock for owner approval of an exact batch.
 * The real API computes SHA-256 server-side; this is display/compare only.
 */
export function inputHash(payload: unknown): string {
  const s = JSON.stringify(payload);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}
