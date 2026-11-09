/** DTOs for people operations and assets (mock + real API share these shapes). */
import type { Asset, AssetAssignment, Employee, EmployeePrivateProfile, RoleKey } from "@/lib/types";

export interface DirectoryRow extends Employee {
  teamName?: string;
  managerName?: string;
  roles: RoleKey[];
}

export interface EmployeeDetail extends DirectoryRow {
  canEditContact: boolean;
  canManage: boolean;
  canReadPrivate: boolean;
  isSelf: boolean;
}

export type PrivateProfile = EmployeePrivateProfile;

export interface OffboardingItem {
  key: string;
  label: string;
  status: "DONE" | "PENDING" | "N/A";
  detail: string;
  href?: string;
}

export interface OffboardingChecklist {
  employeeId: string;
  employmentStatus: Employee["employmentStatus"];
  items: OffboardingItem[];
}

export interface AssetRow extends Asset {
  assignedName?: string;
  activeAssignment?: AssetAssignment;
  canManage: boolean;
  canAcknowledge: boolean;
}

export interface AssetHistoryEntry {
  id: string;
  at: string;
  kind: "ISSUED" | "RETURNED" | "ACKNOWLEDGED" | "STATE" | "RETURN_REQUESTED" | "DAMAGE_CASE";
  text: string;
}
