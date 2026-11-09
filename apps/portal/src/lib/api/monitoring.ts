/** DTOs for authorized tracking endpoints (spec sections 10-12). */
import type {
  ActivitySummaryRow, CoverageGap, Device, IdleLabelRequest, PolicyVersion, Screenshot, TrackingSession,
} from "@/lib/types";

export interface TrackingMe {
  devices: Device[];
  current?: TrackingSession & { taskTitle?: string };
  currentActivity: ActivitySummaryRow[];
  policy?: PolicyVersion;
  pendingPolicy?: PolicyVersion;
  acknowledged: boolean;
  acknowledgedAt?: string;
  checkedIn: boolean;
  enrollmentCode?: { code: string; expiresAt: string };
  employeeId: string;
}

export interface SessionRow extends TrackingSession {
  employeeName: string;
  deviceHostname?: string;
  gapCount: number;
  taskTitle?: string;
}

export interface SessionDetail {
  session: SessionRow;
  activity: ActivitySummaryRow[];
  gaps: CoverageGap[];
  screenshots: Screenshot[];
  screenshotsVisible: boolean;
  idle: IdleLabelRequest[];
  isOwn: boolean;
}

export interface TeamTrackingRow {
  employeeId: string;
  employeeName: string;
  liveState: TrackingSession["state"] | "NONE";
  sessions: number;
  activeMinutes: number;
  idleMinutes: number;
  pausedMinutes: number;
  unknownMinutes: number;
  gaps: number;
  coveragePct: number | null;
  device?: { hostname: string; status: Device["status"]; agentVersion: string; lastSeen?: string };
}

export interface ScreenshotView {
  screenshot: Screenshot;
  employeeName: string;
  /** Deterministic seed for the abstract placeholder render. Real API streams via /media/{id}/content. */
  seed: number;
}
