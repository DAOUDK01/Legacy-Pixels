import { describe, expect, it } from "vitest";
import { weightedQuality, rubricCommentErrors } from "./rubric";
import { productivityScore, qualityComponent } from "./score";
import { computeLine } from "./payroll";
import { dec, toFixed, mul, formatMoney } from "./money";

describe("rubric (section 24)", () => {
  it("90/85/80/100 gives 87.50", () => {
    expect(weightedQuality({ brief: 90, technical: 85, presentation: 80, organization: 100 })).toBe("87.50");
  });
  it("requires comments below 60", () => {
    const e = rubricCommentErrors({ brief: 59, technical: 60, presentation: 90, organization: 90 }, {});
    expect(Object.keys(e)).toEqual(["brief"]);
  });
});

describe("productivity score (section 13, AC07)", () => {
  it("A=90 O=80 Q=85 D=100 L=95 gives 88.0", () => {
    const r = productivityScore({ A: 90, O: 80, Q: 85, D: 100, L: 95 });
    expect(r.score).toBe(88);
    expect(r.comparable).toBe(true);
  });
  it("marks N/A components and normalizes over applicable weights", () => {
    const r = productivityScore({ A: 100, O: null, Q: null, D: null, L: 50 });
    expect(r.coverageWeight).toBe(0.35);
    expect(r.comparable).toBe(false);
    expect(r.score).toBe(85.7);
  });
  it("returns null with no applicable components", () => {
    expect(productivityScore({ A: null, O: null, Q: null, D: null, L: null }).score).toBeNull();
  });
  it("zero-point tasks cannot skew quality", () => {
    expect(qualityComponent([{ points: 0, quality: 10 }, { points: 4, quality: 90 }])).toBe(90);
    expect(qualityComponent([{ points: 0, quality: 10 }])).toBeNull();
  });
});

describe("payroll (section 14, AC08)", () => {
  it("100000 + 5000 + 2500 - 1000 = 106500", () => {
    const r = computeLine([
      { category: "BASE", amount: "100000", status: "APPROVED" },
      { category: "BONUS", amount: "5000", status: "APPROVED" },
      { category: "OVERTIME", amount: "2500", status: "APPROVED" },
      { category: "DEDUCTION", amount: "1000", status: "APPROVED" },
    ]);
    expect(r.net).toBe("106500.00");
  });
  it("ignores proposed components and flags negative net", () => {
    const r = computeLine([
      { category: "BASE", amount: "100", status: "APPROVED" },
      { category: "BONUS", amount: "999", status: "PROPOSED" },
      { category: "DEDUCTION", amount: "150", status: "APPROVED" },
    ]);
    expect(r.net).toBe("-50.00");
    expect(r.negative).toBe(true);
  });
  it("uses fixed precision, not floats", () => {
    expect(toFixed(dec("0.1") + dec("0.2"))).toBe("0.30");
    expect(toFixed(mul(dec("1234.565"), dec("1")))).toBe("1234.57");
    expect(formatMoney("106500.00", "PKR")).toBe("PKR 106,500.00");
  });
});
