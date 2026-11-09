import type { RubricScores } from "@/lib/types";

/** Proposed quality rubric v1 (section 7). Weights are fixed per rubric version. */
export const RUBRIC_V1 = {
  version: 1,
  items: [
    { key: "brief", label: "Brief adherence", weight: 40 },
    { key: "technical", label: "Technical correctness", weight: 30 },
    { key: "presentation", label: "Presentation", weight: 20 },
    { key: "organization", label: "Source organization", weight: 10 },
  ] as const,
  commentRequiredBelow: 60,
};

/**
 * Weighted quality, computed in integer hundredths to avoid float drift.
 * 90x0.40 + 85x0.30 + 80x0.20 + 100x0.10 = 87.50 (section 24, normative).
 */
export function weightedQuality(scores: RubricScores): string {
  let totalHundredths = 0;
  for (const item of RUBRIC_V1.items) {
    const s = scores[item.key];
    if (!Number.isInteger(s) || s < 0 || s > 100) throw new Error(`Rubric score ${item.key} must be an integer 0-100`);
    totalHundredths += s * item.weight;
  }
  const whole = Math.floor(totalHundredths / 100);
  const frac = totalHundredths % 100;
  return `${whole}.${String(frac).padStart(2, "0")}`;
}

export function rubricCommentErrors(
  scores: RubricScores,
  comments: Partial<Record<keyof RubricScores, string>>,
): Partial<Record<keyof RubricScores, string>> {
  const errors: Partial<Record<keyof RubricScores, string>> = {};
  for (const item of RUBRIC_V1.items) {
    if (scores[item.key] < RUBRIC_V1.commentRequiredBelow && !comments[item.key]?.trim()) {
      errors[item.key] = `A comment is required when ${item.label.toLowerCase()} is below ${RUBRIC_V1.commentRequiredBelow}.`;
    }
  }
  return errors;
}
