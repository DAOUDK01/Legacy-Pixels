import type { Me, Permission, RoleKey } from "@/lib/types";

/**
 * Role -> permission grants modelled as action.resource:scope (section 3).
 * The server is authoritative and denies by default; the portal uses these only to
 * decide what to show. Navigation visibility is convenience, never security.
 */
export const ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  OWNER: [
    "dashboard.owner:organization",
    "project.read:organization", "project.manage:organization",
    "task.read:organization", "task.manage:organization",
    "submission.read:organization",
    "employee.read:organization", "employee.private.read:organization",
    "attendance.read:organization", "attendance.approve:organization",
    "leave.read:organization", "overtime.read:organization",
    "monitoring.summary.read:organization", "monitoring.evidence.read:organization",
    "monitoring.restrict:organization",
    "score.read:organization", "score.override:organization", "score.dispute.resolve:organization",
    "payroll.read:organization", "payroll.approve:organization", "payroll.reopen:organization",
    "compensation.read:organization",
    "asset.read:organization",
    "policy.read:organization", "policy.approve:organization",
    "role.assign:organization", "team.manage:organization",
    "report.read:organization", "audit.read:organization",
    "admin.settings:organization", "device.read:organization",
  ],
  ADMIN: [
    "project.read:organization",
    "employee.read:organization", "user.invite:organization", "user.deactivate:organization",
    "role.assign:organization", "team.manage:organization",
    "device.read:organization", "device.revoke:organization",
    "policy.read:organization", "policy.draft:organization",
    "admin.settings:organization", "media.health.read:organization",
    "audit.read:organization", "asset.read:organization",
  ],
  HR: [
    "employee.read:organization", "employee.private.read:organization", "employee.manage:organization",
    "user.invite:organization",
    "attendance.read:organization", "attendance.approve:organization",
    "shift.manage:organization",
    "leave.read:organization", "leave.approve:organization",
    "overtime.read:organization",
    "asset.read:organization", "asset.manage:organization",
    "policy.read:organization", "policy.draft:organization",
    "report.read:organization", "monitoring.summary.read:organization",
  ],
  PAYROLL: [
    "employee.read:organization",
    "compensation.read:organization",
    "payroll.read:organization", "payroll.prepare:organization", "payroll.export:organization",
    "overtime.read:organization", "overtime.validate:organization",
    "attendance.read:organization",
    "report.read:organization",
  ],
  MANAGER: [
    "dashboard.manager:team",
    "project.read:team", "project.manage:team",
    "task.read:team", "task.manage:team",
    "submission.read:team",
    "employee.read:team",
    "attendance.read:team", "attendance.recommend:team",
    "leave.read:team", "leave.recommend:team",
    "overtime.read:team", "overtime.recommend:team",
    "worklog.review:team",
    "monitoring.summary.read:team",
    "score.read:team",
    "report.read:team",
  ],
  REVIEWER: [
    "project.read:project", "task.read:project",
    "submission.read:project", "submission.review:project",
  ],
  EMPLOYEE: [
    "project.read:self", "task.read:self", "task.work:self",
    "submission.create:self",
    "attendance.read:self", "attendance.event:self", "attendance.correct:self",
    "leave.read:self", "leave.request:self",
    "overtime.request:self",
    "monitoring.summary.read:self", "monitoring.evidence.read:self",
    "score.read:self", "score.dispute:self",
    "payslip.read:self",
    "asset.read:self",
    "employee.read:self",
  ],
  AUDITOR: [
    "project.read:organization", "task.read:organization",
    "attendance.read:organization", "leave.read:organization",
    "audit.read:organization", "report.read:organization",
    "employee.read:organization",
  ],
};

export const ROLE_LABELS: Record<RoleKey, string> = {
  OWNER: "Owner",
  ADMIN: "Administrator",
  HR: "HR",
  PAYROLL: "Payroll officer",
  MANAGER: "Manager",
  REVIEWER: "Reviewer / team lead",
  EMPLOYEE: "Employee",
  AUDITOR: "Auditor",
};

export const PRIVILEGED_ROLES: RoleKey[] = ["OWNER", "ADMIN", "HR", "PAYROLL"];

export function permissionsFor(roles: RoleKey[]): Permission[] {
  return Array.from(new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? [])));
}

/** `can(me, "payroll.approve")` matches any scope; `can(me, "payroll.approve:organization")` is exact. */
export function can(me: Pick<Me, "permissions"> | null | undefined, permission: string): boolean {
  if (!me) return false;
  if (permission.includes(":")) return me.permissions.includes(permission);
  return me.permissions.some((p) => p.split(":")[0] === permission);
}

export function scopeOf(me: Pick<Me, "permissions"> | null | undefined, action: string): "organization" | "team" | "project" | "self" | null {
  if (!me) return null;
  const order = ["organization", "team", "project", "self"] as const;
  for (const s of order) if (me.permissions.includes(`${action}:${s}`)) return s;
  return null;
}
