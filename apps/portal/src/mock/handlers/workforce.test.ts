import { describe, expect, it } from "vitest";
import { buildSeed } from "../seed";
import { computeDaily } from "./workforce";
import { addDays, businessDate } from "@/lib/time";

describe("daily attendance (section 8, AC04)", () => {
  const db = buildSeed();
  const today = businessDate(new Date(), db.organization.timezone);

  it("marks Ali's missing checkout three days ago as incomplete and provisional (unless it's a weekend)", () => {
    const d = computeDaily(db, "emp-ali", addDays(today, -3));
    if (d.status !== "OFF" && d.status !== "HOLIDAY") {
      expect(d.status).toBe("INCOMPLETE");
      expect(d.provisional).toBe(true);
      expect(d.creditedMinutes).toBeLessThanOrEqual(d.scheduledMinutes);
    }
  });

  it("never credits more than eligible scheduled minutes", () => {
    for (let i = -14; i <= 0; i++) {
      for (const e of ["emp-ali", "emp-fatima", "emp-usman", "emp-hira"]) {
        const d = computeDaily(db, e, addDays(today, i));
        expect(d.creditedMinutes).toBeLessThanOrEqual(d.scheduledMinutes);
        expect(d.creditedMinutes).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("treats approved full-day leave as LEAVE with no eligible minutes", () => {
    const d = computeDaily(db, "emp-usman", addDays(today, -6));
    if (d.status !== "OFF" && !d.flags.some((f) => f.includes("day"))) {
      expect(["LEAVE", "HOLIDAY"]).toContain(d.status);
      expect(d.scheduledMinutes).toBe(0);
    }
  });

  it("resolves overnight shifts to the start date", () => {
    db.shiftTemplates.find((s) => s.id === "shift-night")!.assignedTeamIds = ["team-video"];
    db.shiftTemplates.find((s) => s.id === "shift-late")!.assignedTeamIds = [];
    let friday = today;
    while (new Date(`${friday}T12:00:00Z`).getUTCDay() !== 5) friday = addDays(friday, 1);
    const d = computeDaily(db, "emp-usman", friday);
    expect(d.scheduledStart! < d.scheduledEnd!).toBe(true);
    expect(d.scheduledEnd!.slice(0, 10) >= friday).toBe(true);
    expect(d.scheduledMinutes).toBe(8 * 60);
  });
});
