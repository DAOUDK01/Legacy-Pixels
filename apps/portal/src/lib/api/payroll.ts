import type { CompensationProfile, Employee, PayrollLine, PayrollPeriod, PayrollRun, Payslip } from "@/lib/types";

export interface OwnerException {
  employeeId: string;
  reason: string;
  by: string;
  at: string;
}

export type RunWithExtras = PayrollRun & { ownerExceptions?: OwnerException[]; reopenedFrom?: string; reopenReason?: string; supersededBy?: string };

export interface PeriodSummary extends PayrollPeriod {
  runs: RunWithExtras[];
}

export interface RunDetail {
  run: RunWithExtras;
  period: PayrollPeriod;
  lines: (PayrollLine & { basis?: CompensationProfile["basis"]; employeeName: string; employeeCode: string })[];
  exceptionCount: number;
  permissions: {
    canPrepare: boolean;
    canApprove: boolean;
    canExport: boolean;
    canReopen: boolean;
    canDecideComponents: boolean;
    isPreparer: boolean;
  };
  reauthValidUntil?: string;
}

export interface LineDetail {
  line: PayrollLine;
  run: RunWithExtras;
  profile?: CompensationProfile;
  employee?: Pick<Employee, "id" | "displayName" | "employeeCode" | "title">;
}

export interface ExportResponse {
  export: PayrollRun["exports"][number];
  filename: string;
  csv: string;
}

export interface CompensationRow extends CompensationProfile {
  employeeName: string;
  employeeCode: string;
  current: boolean;
}

export type PayslipSummary = Payslip;

export const RUN_STEPS: { state: string; label: string }[] = [
  { state: "OPEN", label: "Open period" },
  { state: "DRAFT", label: "Draft" },
  { state: "UNDER_REVIEW", label: "Under review" },
  { state: "LOCKED", label: "Owner approved & locked" },
  { state: "EXPORTED", label: "Exported" },
  { state: "PAID", label: "Marked paid" },
];
