import {
  LayoutDashboard, FolderKanban, ListChecks, ClipboardCheck, Clock, CalendarDays, CalendarClock, Timer, MonitorDot,
  Gauge, Wallet, Receipt, Users, Laptop, BarChart3, ScrollText, Settings, NotebookPen, ShieldCheck, type LucideIcon,
} from "lucide-react";
import { can } from "@/lib/rbac";
import type { Me } from "@/lib/types";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  visible: (me: Me) => boolean;
  /** Exact match only (otherwise prefix match marks it active). */
  exact?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

const hasEmployee = (me: Me) => !!me.employee;

/** Role-filtered navigation. Visibility is convenience only; the API enforces access. */
export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard, visible: () => true, exact: true }],
  },
  {
    label: "Delivery",
    items: [
      { href: "/tasks", label: "Tasks", icon: ListChecks, visible: (me) => can(me, "task.read") },
      { href: "/projects", label: "Projects", icon: FolderKanban, visible: (me) => can(me, "project.read") },
      { href: "/reviews", label: "Review queue", icon: ClipboardCheck, visible: (me) => can(me, "submission.review") || can(me, "task.manage") },
      { href: "/worklogs", label: "Work logs", icon: NotebookPen, visible: (me) => can(me, "task.work") || can(me, "worklog.review") },
    ],
  },
  {
    label: "Workforce",
    items: [
      { href: "/attendance", label: "Attendance", icon: Clock, visible: (me) => can(me, "attendance.read") },
      { href: "/leave", label: "Leave", icon: CalendarDays, visible: (me) => can(me, "leave.read") },
      { href: "/overtime", label: "Overtime", icon: Timer, visible: (me) => can(me, "overtime.request") || can(me, "overtime.read") },
      { href: "/shifts", label: "Shifts & holidays", icon: CalendarClock, visible: (me) => can(me, "shift.manage") || can(me, "attendance.read:team") || can(me, "attendance.read:organization") },
    ],
  },
  {
    label: "Tracking & performance",
    items: [
      { href: "/tracking", label: "Tracking", icon: MonitorDot, visible: (me) => can(me, "monitoring.summary.read") },
      { href: "/scores", label: "Scores", icon: Gauge, visible: (me) => can(me, "score.read") },
    ],
  },
  {
    label: "Pay",
    items: [
      { href: "/payroll", label: "Payroll", icon: Wallet, visible: (me) => can(me, "payroll.read") },
      { href: "/payslips", label: "My payslips", icon: Receipt, visible: (me) => hasEmployee(me) && can(me, "payslip.read") },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/people", label: "Directory", icon: Users, visible: (me) => can(me, "employee.read:organization") || can(me, "employee.read:team") },
      { href: "/assets", label: "Assets", icon: Laptop, visible: (me) => can(me, "asset.read") },
    ],
  },
  {
    label: "Oversight",
    items: [
      { href: "/reports", label: "Reports", icon: BarChart3, visible: (me) => can(me, "report.read") },
      { href: "/audit", label: "Audit log", icon: ScrollText, visible: (me) => can(me, "audit.read") },
      { href: "/admin", label: "Administration", icon: Settings, visible: (me) => can(me, "admin.settings") || can(me, "policy.read") || can(me, "role.assign") },
      { href: "/privacy", label: "Privacy & notices", icon: ShieldCheck, visible: () => true },
    ],
  },
];

export function visibleNav(me: Me): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.visible(me)) })).filter((g) => g.items.length > 0);
}
