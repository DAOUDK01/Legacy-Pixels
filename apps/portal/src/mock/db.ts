/**
 * In-browser mock datastore standing in for the NestJS API + PostgreSQL during frontend development.
 * Persisted to localStorage so the demo survives reloads. Never used when NEXT_PUBLIC_API_MODE=http.
 */
import type * as T from "@/lib/types";
import { buildSeed } from "./seed";

export interface EnrollmentCode {
  code: string;
  employeeId: string;
  expiresAt: string;
  used: boolean;
}

export interface MockDb {
  schema: number;
  organization: T.Organization;
  users: T.User[];
  employees: T.Employee[];
  privateProfiles: T.EmployeePrivateProfile[];
  teams: T.Team[];
  roleAssignments: T.RoleAssignment[];
  invitations: T.Invitation[];
  projects: T.Project[];
  tasks: T.Task[];
  taskEvents: T.TaskEvent[];
  comments: T.TaskComment[];
  submissions: T.Submission[];
  reviews: T.ReviewDecision[];
  media: T.MediaAsset[];
  workLogs: T.WorkLog[];
  shiftTemplates: T.ShiftTemplate[];
  holidays: T.Holiday[];
  attendanceEvents: T.AttendanceEvent[];
  corrections: T.AttendanceCorrection[];
  leaveTypes: T.LeaveType[];
  leaveRequests: T.LeaveRequest[];
  leaveLedger: T.LeaveLedgerEntry[];
  overtime: T.OvertimeRequest[];
  devices: T.Device[];
  sessions: T.TrackingSession[];
  activity: Record<string, T.ActivitySummaryRow[]>;
  gaps: T.CoverageGap[];
  screenshots: T.Screenshot[];
  idleLabels: T.IdleLabelRequest[];
  enrollmentCodes: EnrollmentCode[];
  scores: T.ScoreSnapshot[];
  disputes: T.ScoreDispute[];
  compensation: T.CompensationProfile[];
  payrollPeriods: T.PayrollPeriod[];
  payrollRuns: T.PayrollRun[];
  payrollLines: T.PayrollLine[];
  payslips: T.Payslip[];
  assets: T.Asset[];
  assetAssignments: T.AssetAssignment[];
  policies: T.PolicyVersion[];
  notifications: T.Notification[];
  audit: T.AuditEvent[];
  sim: { driveUnavailable: boolean; latencyMs: number };
}

export const DB_SCHEMA = 3;
const KEY = "lp.mockdb.v3";

let current: MockDb | null = null;

export function getDb(): MockDb {
  if (current) return current;
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as MockDb;
        if (parsed.schema === DB_SCHEMA) {
          current = parsed;
          return current;
        }
      }
    } catch {
      /* storage unavailable or corrupt: fall back to seed */
    }
  }
  current = buildSeed();
  persist();
  return current;
}

export function persist(): void {
  if (!current || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* quota or private mode: keep in memory only */
  }
}

export function resetDb(): void {
  current = buildSeed();
  persist();
}
