import type { ScoreDispute, ScoreSnapshot } from "@/lib/types";

export interface ScoreListResponse {
  items: ScoreSnapshot[];
  currentPeriodStart: string;
  scope: "organization" | "team" | "self";
}

export interface ScoreDetail {
  snapshot: ScoreSnapshot;
  disputes: ScoreDispute[];
  isOwn: boolean;
  canDispute: boolean;
  disputeDeadline?: string;
  disputeBlockedReason?: string;
  canOverride: boolean;
  canResolve: boolean;
}

export interface DisputeListResponse {
  items: (ScoreDispute & { periodStart?: string; periodEnd?: string })[];
}

export const DISPUTE_WINDOW_DAYS = 7;
