/** DTOs for administration, audit and reports. */
import type { MediaCategory, ReportMeta } from "@/lib/types";

export interface MediaHealthDto {
  poolBytes: number;
  usedBytes: number;
  usedPct: number;
  thresholds: number[];
  level: "OK" | "WARN_70" | "HIGH_85" | "CRITICAL_95";
  byCategory: { category: MediaCategory | "OTHER_WORKSPACE"; bytes: number }[];
  pendingTransfers: number;
  failedScans: number;
  quarantined: number;
  outboxBacklog: number;
  lastBackupAt: string;
  driveUnavailable: boolean;
  screenshotForecastBytesPerMonth: number;
}

export interface AgentVersionsDto {
  versions: { version: string; active: number; pending: number; revoked: number }[];
  devices: { id: string; employeeId: string; employeeName: string; hostname: string; agentVersion: string; status: string; lastSeen?: string }[];
}

export interface RetentionDto {
  policyApproved: boolean;
  policyStatus: string;
  rules: { category: string; period: string; eligible: number; held: number }[];
  lastRunAt?: string;
  blockedReason?: string;
}

export interface ChecklistDto {
  items: { key: string; label: string; status: "PASS" | "FAIL" | "MANUAL"; detail: string }[];
}

export interface ReportColumn {
  key: string;
  label: string;
  align?: "left" | "right";
}

export interface ReportResult {
  key: string;
  title: string;
  meta: ReportMeta;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  notes?: string[];
}

export interface ExportResult {
  id: string;
  filename: string;
  csv: string;
  expiresAt: string;
}

export const REPORT_CATALOG: { key: string; title: string; description: string; group: string; requires?: string }[] = [
  { key: "task-status-aging", title: "Task status & aging", description: "Open tasks by state with days in state and overdue flags.", group: "Delivery" },
  { key: "project-progress", title: "Project progress", description: "Completion counts and planned dates per project.", group: "Delivery" },
  { key: "output-accepted", title: "Output accepted by period", description: "Accepted baseline points per employee in the period.", group: "Delivery" },
  { key: "review-turnaround", title: "Review turnaround", description: "Hours from submission to decision per reviewer.", group: "Delivery" },
  { key: "revision-reasons", title: "Revision reasons", description: "Revision requests with failed checklist items (diagnostic, not a pay penalty).", group: "Delivery" },
  { key: "workload", title: "Employee workload", description: "Open tasks, points and blocked work per employee.", group: "Delivery" },
  { key: "attendance-summary", title: "Attendance, late & incomplete days", description: "Present, late, incomplete and unknown days per employee.", group: "Workforce" },
  { key: "leave-ledger", title: "Leave ledger", description: "Entitlement, carryover, use and balance per employee and type.", group: "Workforce" },
  { key: "overtime-vs-actual", title: "Overtime requested vs actual", description: "Requested, actual and approved minutes.", group: "Workforce" },
  { key: "monitoring-coverage", title: "Monitoring coverage & gaps", description: "Active, idle, paused and unknown minutes per session.", group: "Tracking" },
  { key: "score-components", title: "Score components & coverage", description: "A/O/Q/D/L with coverage weight and status.", group: "Performance" },
  { key: "payroll-register", title: "Payroll register & adjustments", description: "Lines per run with approved adjustments.", group: "Payroll", requires: "payroll.read" },
  { key: "asset-custody", title: "Asset custody", description: "Who holds which asset and acknowledgement status.", group: "People" },
  { key: "storage-utilization", title: "Storage utilization", description: "Media bytes by category and state.", group: "Platform" },
];
