/**
 * Fixed-precision decimal arithmetic for money (spec section 14: never floating-point money).
 * Values are held as BigInt scaled by 10^4, matching numeric(18,4) storage.
 */
const SCALE = 4;
const FACTOR = 10n ** BigInt(SCALE);

export type Dec = bigint;

export function dec(value: string | number): Dec {
  const s = typeof value === "number" ? value.toFixed(SCALE) : value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid decimal: ${value}`);
  const neg = s.startsWith("-");
  const [intPart, frac = ""] = (neg ? s.slice(1) : s).split(".");
  const fracPadded = (frac + "0".repeat(SCALE)).slice(0, SCALE);
  const extra = frac.length > SCALE ? Number(frac[SCALE]) : 0;
  let v = BigInt(intPart) * FACTOR + BigInt(fracPadded);
  if (extra >= 5) v += 1n;
  return neg ? -v : v;
}

export const add = (...xs: Dec[]): Dec => xs.reduce((a, b) => a + b, 0n);
export const sub = (a: Dec, b: Dec): Dec => a - b;

function divRound(n: bigint, d: bigint): bigint {
  const neg = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (ad * 2n);
  return neg ? -q : q;
}

/** Multiply two decimals, rounding half-up back to scale. */
export function mul(a: Dec, b: Dec): Dec {
  return divRound(a * b, FACTOR);
}

/** Round to currency minor units (half-up). */
export function roundMinor(a: Dec, minorDigits = 2): Dec {
  const step = 10n ** BigInt(SCALE - minorDigits);
  return divRound(a, step) * step;
}

export function toFixed(a: Dec, digits = 2): string {
  const r = roundMinor(a, digits);
  const neg = r < 0n;
  const abs = neg ? -r : r;
  const int = abs / FACTOR;
  const frac = (abs % FACTOR).toString().padStart(SCALE, "0").slice(0, digits);
  return `${neg ? "-" : ""}${int}${digits > 0 ? "." + frac : ""}`;
}

export function formatMoney(amount: string, currency: string): string {
  const neg = amount.trim().startsWith("-");
  const [int, frac = "00"] = amount.replace("-", "").split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${currency} ${grouped}.${(frac + "00").slice(0, 2)}`;
}
