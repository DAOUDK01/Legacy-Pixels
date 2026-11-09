/** DTOs for workforce endpoints (attendance, shifts, leave, overtime). */
import type {
  AttendanceCorrection, AttendanceEvent, DailyAttendance, Holiday, LeaveLedgerEntry, LeaveRequest, LeaveType,
  OvertimeRequest, ShiftTemplate,
} from "@/lib/types";

export type AttendanceNowStatus = "NOT_CHECKED_IN" | "WORKING" | "ON_BREAK" | "CHECKED_OUT";

export interface AttendanceResponse {
  employeeId: string;
  from: string;
  to: string;
  timezone: string;
  days: DailyAttendance[];
  today: {
    status: AttendanceNowStatus;
    events: AttendanceEvent[];
    shift?: { name: string; start?: string; end?: string };
    nextActions: ("CHECK_IN" | "BREAK_START" | "BREAK_END" | "CHECK_OUT")[];
  };
  totals: { scheduledMinutes: number; creditedMinutes: number; trackedMinutes: number; overtimeMinutes: number; late: number; absent: number; incomplete: number };
}

export interface TeamAttendanceRow {
  employeeId: string;
  days: DailyAttendance[];
  totals: AttendanceResponse["totals"];
}

export interface CorrectionRow extends AttendanceCorrection {
  employeeName: string;
  canValidate: boolean;
  canApprove: boolean;
}

export interface ShiftsResponse {
  templates: ShiftTemplate[];
  holidays: Holiday[];
}

export interface LeaveBalance {
  type: LeaveType;
  entitledMinutes: number;
  usedMinutes: number;
  reservedMinutes: number;
  adjustmentMinutes: number;
  availableMinutes: number;
  pendingMinutes: number;
}

export interface LeaveRequestRow extends LeaveRequest {
  employeeName: string;
  typeName: string;
  canRecommend: boolean;
  canDecide: boolean;
  canWithdraw: boolean;
  canCancel: boolean;
  noteHidden: boolean;
}

export interface LeaveLedgerResponse {
  entries: (LeaveLedgerEntry & { typeName: string })[];
}

export interface OvertimeRow extends OvertimeRequest {
  employeeName: string;
  taskTitle?: string;
  canRecommend: boolean;
  canValidate: boolean;
}

export const MINUTES_PER_DAY = 480;

export function fmtDays(minutes: number): string {
  const d = minutes / MINUTES_PER_DAY;
  return `${Number.isInteger(d) ? d : d.toFixed(1)} d`;
}
