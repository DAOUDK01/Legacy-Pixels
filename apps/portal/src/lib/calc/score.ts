import type { ScoreComponentKey } from "@/lib/types";

/** P = 0.25A + 0.30O + 0.20Q + 0.15D + 0.10L (section 13). Weights held in hundredths. */
export const SCORE_WEIGHTS_PCT: Record<ScoreComponentKey, number> = { A: 25, O: 30, Q: 20, D: 15, L: 10 };

export const SCORE_LABELS: Record<ScoreComponentKey, string> = {
  A: "Attendance",
  O: "Approved output",
  Q: "Quality",
  D: "Deadlines",
  L: "Work-log accuracy",
};

export const SCORE_FORMULAS: Record<ScoreComponentKey, string> = {
  A: "100 x min(credited eligible presence minutes / eligible scheduled minutes, 1)",
  O: "100 x min(accepted baseline output points / committed output points, 1)",
  Q: "sum(accepted points x rubric score) / sum(accepted points)",
  D: "100 x on-time accepted output points / all due output points",
  L: "100 x accepted reconciled logged minutes / submitted logged minutes",
};

export const ratio100 = (num: number, den: number): number | null =>
  den > 0 ? Math.round(Math.min((100 * num) / den, 100) * 100) / 100 : null;

export interface ScoreResult {
  /** Normalized over applicable weights; null when nothing applies. */
  score: number | null;
  /** Sum of applicable weights (1 means the full comparable score). */
  coverageWeight: number;
  comparable: boolean;
}

/** Components with no valid denominator are N/A (null) and excluded from coverage. */
export function productivityScore(values: Record<ScoreComponentKey, number | null>): ScoreResult {
  let weighted = 0;
  let coverage = 0;
  for (const k of Object.keys(SCORE_WEIGHTS_PCT) as ScoreComponentKey[]) {
    const v = values[k];
    if (v === null || v === undefined) continue;
    weighted += v * SCORE_WEIGHTS_PCT[k];
    coverage += SCORE_WEIGHTS_PCT[k];
  }
  if (coverage === 0) return { score: null, coverageWeight: 0, comparable: false };
  const score = Math.round((weighted / coverage) * 10) / 10;
  return { score, coverageWeight: coverage / 100, comparable: coverage === 100 };
}

/** Q = sum(points x rubric) / sum(points); zero-point tasks cannot skew it. */
export function qualityComponent(tasks: { points: number; quality: number }[]): number | null {
  const eligible = tasks.filter((t) => t.points > 0);
  const den = eligible.reduce((a, t) => a + t.points, 0);
  if (den === 0) return null;
  return Math.round((eligible.reduce((a, t) => a + t.points * t.quality, 0) / den) * 100) / 100;
}
