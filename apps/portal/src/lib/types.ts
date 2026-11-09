/**
 * Domain types for the Legacy Pixels Workforce Portal.
 * Mirrors the entity definitions in spec sections 21-22 and the API conventions in section 23
 * (camelCase JSON, RFC 3339 UTC timestamps, YYYY-MM-DD business dates, money as decimal strings).
 */

export type UUID = string;
export type ISODateTime = string; // RFC 3339 UTC
export type ISODate = string; // YYYY-MM-DD business date
export type Money = string; // decimal string, e.g. "106500.00"

export interface Versioned {
  id: UUID;
  organizationId: UUID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version: number;
}

/* ---------------------------------------------------------------- identity */

export type RoleKey =
  | "OWNER"
  | "ADMIN"
  | "HR"
  | "PAYROLL"
  | "MANAGER"
  | "REVIEWER"
  | "EMPLOYEE"
  | "AUDITOR";

export type ScopeType = "organization" | "team" | "project" | "self";

/** action.resource:scope, e.g. "submission.review:project" (section 3). */
export type Permission = string;

export interface Organization {
  id: UUID;
  name: string;
  timezone: string; // IANA, default Asia/Karachi
  payrollCurrency: string; // ISO 4217
  status: "ACTIVE" | "SUSPENDED";
  activePolicyVersion: number;
}

export type UserStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "OFFBOARDED";

export interface User {
  id: UUID;
  email: string;
  status: UserStatus;
  lastLogin?: ISODateTime;
  mfaEnrolled: boolean;
  employeeId?: UUID;
}

export interface RoleAssignment extends Versioned {
  userId: UUID;
  role: RoleKey;
  scopeType: ScopeType;
  scopeId?: UUID;
  validFrom: ISODate;
  validTo?: ISODate;
  approvedBy: UUID;
}

export interface Me {
  user: User;
  employee?: Employee;
  roles: RoleKey[];
  permissions: Permission[];
  organization: Organization;
  authTime: ISODateTime;
  sessionExpiresAt: ISODateTime;
}

export interface Invitation {
  id: UUID;
  email: string;
  role: RoleKey;
  teamId?: UUID;
  expiresAt: ISODateTime;
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
  createdAt: ISODateTime;
}

/* ---------------------------------------------------------------- people */

export type EmploymentStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "OFFBOARDED";

export interface Employee extends Versioned {
  userId?: UUID;
  employeeCode: string;
  displayName: string;
  title: string;
  teamId?: UUID;
  managerId?: UUID;
  workEmail: string;
  workPhone?: string;
  startDate: ISODate;
  endDate?: ISODate;
  employmentStatus: EmploymentStatus;
  timezone: string;
  avatarColor: string;
}

export interface EmployeePrivateProfile {
  employeeId: UUID;
  legalName: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  paymentReferenceMasked?: string;
  documents: { id: UUID; name: string; category: string; uploadedAt: ISODateTime }[];
  acknowledgements: { policyType: PolicyType; version: number; acknowledgedAt: ISODateTime }[];
}

export interface Team extends Versioned {
  name: string;
  managerEmployeeId?: UUID;
  memberIds: UUID[];
}

/* ---------------------------------------------------------------- work */

export type ProjectState = "DRAFT" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "ARCHIVED" | "CANCELLED";

export interface Project extends Versioned {
  code: string;
  name: string;
  brief?: string;
  externalReference?: string;
  managerId: UUID;
  state: ProjectState;
  plannedStart: ISODate;
  plannedEnd: ISODate;
  archivedAt?: ISODateTime;
  memberIds: UUID[];
  taskCounts: { total: number; completed: number };
}

export type TaskState =
  | "DRAFT"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "REVISION_REQUESTED"
  | "APPROVED"
  | "COMPLETED"
  | "BLOCKED"
  | "CANCELLED";

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface ChecklistItem {
  id: string;
  label: string;
}

export interface Task extends Versioned {
  projectId: UUID;
  title: string;
  brief: string;
  acceptanceChecklist: ChecklistItem[];
  assigneeId?: UUID;
  reviewerId?: UUID;
  state: TaskState;
  resumeState?: TaskState;
  blocker?: { reason: string; responsibleParty: string };
  priority: Priority;
  baselinePoints: string;
  estimateMinutes?: number;
  noEstimateReason?: string;
  baselineDueAt: ISODateTime;
  dueAt: ISODateTime;
  baselineVersion: number;
  rubricVersion: number;
  actualStartAt?: ISODateTime;
  dependencyIds: UUID[]; // predecessors
}

export interface TaskEvent {
  id: UUID;
  taskId: UUID;
  transition: string;
  actorId: UUID;
  fromState?: TaskState;
  toState: TaskState;
  reason?: string;
  occurredAt: ISODateTime;
  resultingVersion: number;
}

export interface TaskComment {
  id: UUID;
  taskId: UUID;
  authorId: UUID;
  body: string;
  createdAt: ISODateTime;
  editedAt?: ISODateTime;
  anchor?: { submissionId: UUID; mediaId?: UUID };
}

export type MediaState =
  | "INITIATED"
  | "RECEIVING"
  | "SCANNING"
  | "TRANSFERRING"
  | "AVAILABLE"
  | "FAILED"
  | "QUARANTINED"
  | "EXPIRED"
  | "DELETED";

export type MediaCategory = "PROJECT_OUTPUT" | "PROJECT_REFERENCE" | "SCREENSHOT" | "HR_DOCUMENT" | "PAYSLIP";

export interface MediaAsset {
  id: UUID;
  category: MediaCategory;
  name: string;
  mimeType: string;
  sizeBytes: number;
  sha256?: string;
  state: MediaState;
  scanResult?: "CLEAN" | "INFECTED" | "PENDING";
  uploaderId: UUID;
  createdAt: ISODateTime;
  progress?: number; // 0..1 while receiving
  lastError?: string;
}

export type SubmissionState = "DRAFT" | "SUBMITTED" | "SUPERSEDED";

export interface Submission {
  id: UUID;
  taskId: UUID;
  sequence: number;
  authorId: UUID;
  summary: string;
  state: SubmissionState;
  mediaIds: UUID[];
  workLogIds: UUID[];
  submittedAt?: ISODateTime;
  frozenAt?: ISODateTime;
}

export type ReviewDecisionKind = "APPROVE" | "REQUEST_REVISION";

export interface RubricScores {
  brief: number;
  technical: number;
  presentation: number;
  organization: number;
}

export interface ReviewDecision {
  id: UUID;
  submissionId: UUID;
  taskId: UUID;
  reviewerId: UUID;
  decision: ReviewDecisionKind;
  rejected?: boolean;
  checklist: Record<string, boolean>;
  rubricScores?: RubricScores;
  rubricComments?: Partial<Record<keyof RubricScores, string>>;
  rubricVersion: number;
  weightedQuality?: string;
  feedback: string;
  decidedAt: ISODateTime;
}

export type WorkLogStatus = "SUBMITTED" | "APPROVED" | "REJECTED";

export interface WorkLog {
  id: UUID;
  employeeId: UUID;
  taskId: UUID;
  businessDate: ISODate;
  durationMinutes: number;
  description: string;
  source: "MANUAL" | "AGENT_LINKED" | "MEETING" | "OFFLINE_WORK";
  status: WorkLogStatus;
  approvedMinutes?: number;
  reviewerId?: UUID;
}

/* ---------------------------------------------------------------- attendance */

export interface ShiftTemplate extends Versioned {
  name: string;
  timezone: string;
  localStart: string; // HH:mm
  localEnd: string; // HH:mm (may cross midnight)
  weekdays: number[]; // 0=Sun..6=Sat
  paidBreakMinutes: number;
  unpaidBreakMinutes: number;
  graceMinutes: number;
  policyVersion: number;
  effectiveFrom: ISODate;
  effectiveTo?: ISODate;
  assignedTeamIds: UUID[];
}

export interface Holiday {
  id: UUID;
  date: ISODate;
  name: string;
}

export type AttendanceEventKind = "CHECK_IN" | "BREAK_START" | "BREAK_END" | "CHECK_OUT";

export interface AttendanceEvent {
  id: UUID;
  employeeId: UUID;
  kind: AttendanceEventKind;
  occurredAt: ISODateTime;
  receivedAt: ISODateTime;
  source: "WEB" | "MANUAL" | "AGENT" | "CORRECTION";
  deviceId?: UUID;
  flags: string[];
}

export type DayStatus = "PRESENT" | "LATE" | "ABSENT" | "LEAVE" | "HOLIDAY" | "INCOMPLETE" | "UNKNOWN" | "OFF";

export interface DailyAttendance {
  employeeId: UUID;
  businessDate: ISODate;
  shiftName?: string;
  scheduledStart?: ISODateTime;
  scheduledEnd?: ISODateTime;
  checkIn?: ISODateTime;
  checkOut?: ISODateTime;
  breakMinutes: number;
  scheduledMinutes: number;
  creditedMinutes: number;
  trackedMinutes: number;
  overtimeMinutes: number;
  status: DayStatus;
  provisional: boolean;
  flags: string[];
}

export type CorrectionStatus = "PROPOSED" | "MANAGER_VALIDATED" | "APPROVED" | "REJECTED";

export interface AttendanceCorrection {
  id: UUID;
  employeeId: UUID;
  businessDate: ISODate;
  proposedCheckIn?: ISODateTime;
  proposedCheckOut?: ISODateTime;
  reason: string;
  status: CorrectionStatus;
  managerDecisionBy?: UUID;
  hrDecisionBy?: UUID;
  decisionReason?: string;
  affectsLockedPayroll: boolean;
  createdAt: ISODateTime;
}

/* ---------------------------------------------------------------- leave & OT */

export interface LeaveType {
  id: UUID;
  name: string;
  allowNegative: boolean;
  requiresDocument: boolean;
}

export type LeaveState = "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN" | "CANCELLED";

export interface LeaveRequest {
  id: UUID;
  employeeId: UUID;
  typeId: UUID;
  startDate: ISODate;
  endDate: ISODate;
  partialMinutes?: number;
  requestedMinutes: number;
  note?: string; // restricted to HR
  hasDocument: boolean;
  status: LeaveState;
  managerDecision?: { by: UUID; decision: "RECOMMEND" | "NOT_RECOMMENDED"; at: ISODateTime; reason?: string };
  hrDecision?: { by: UUID; decision: "APPROVED" | "REJECTED" | "CANCELLED"; at: ISODateTime; reason?: string };
  createdAt: ISODateTime;
}

export interface LeaveLedgerEntry {
  id: UUID;
  employeeId: UUID;
  typeId: UUID;
  requestId?: UUID;
  deltaMinutes: number;
  entryType: "ACCRUAL" | "ENTITLEMENT" | "CARRYOVER" | "USE" | "RESERVE" | "ADJUSTMENT" | "REVERSAL";
  effectiveDate: ISODate;
  policyVersion: number;
  note?: string;
}

export type OvertimeState = "PENDING" | "MANAGER_RECOMMENDED" | "PAYROLL_VALIDATED" | "REJECTED" | "FLAGGED";

export interface OvertimeRequest {
  id: UUID;
  employeeId: UUID;
  date: ISODate;
  taskId?: UUID;
  requestedMinutes: number;
  actualMinutes?: number;
  approvedMinutes?: number;
  reason: string;
  status: OvertimeState;
  approvalToWork?: boolean;
  rateBasis?: "FULL_RATE" | "PREMIUM_ONLY";
  multiplier?: string;
  unscheduled: boolean;
  createdAt: ISODateTime;
}

/* ---------------------------------------------------------------- monitoring */

export type DeviceStatus = "PENDING" | "ACTIVE" | "REVOKED";

export interface Device {
  id: UUID;
  employeeId: UUID;
  hostname: string;
  agentVersion: string;
  status: DeviceStatus;
  enrolledAt?: ISODateTime;
  revokedAt?: ISODateTime;
  lastSeen?: ISODateTime;
  policyVersion: number;
}

export type SessionState = "STOPPED" | "STARTING" | "ACTIVE" | "PAUSED" | "IDLE";

export interface TrackingSession {
  id: UUID;
  employeeId: UUID;
  deviceId: UUID;
  taskId?: UUID;
  state: SessionState;
  offline: boolean;
  startedAt: ISODateTime;
  endedAt?: ISODateTime;
  authorizationExpiresAt: ISODateTime;
  policyVersion: number;
  activeMinutes: number;
  idleMinutes: number;
  pausedMinutes: number;
  unknownMinutes: number;
  screenshotCount: number;
  pendingUploads: number;
}

export interface ActivitySummaryRow {
  label: string; // app executable or domain
  kind: "APP" | "DOMAIN";
  minutes: number;
}

export interface CoverageGap {
  id: UUID;
  sessionId: UUID;
  start: ISODateTime;
  end: ISODateTime;
  reason: "HEARTBEAT_TIMEOUT" | "SEQUENCE_GAP" | "CLOCK_SKEW" | "SPOOL_FULL" | "LEASE_EXPIRED";
}

export interface Screenshot {
  id: UUID;
  sessionId: UUID;
  employeeId: UUID;
  captureAt: ISODateTime;
  mediaId?: UUID;
  suppressionReason?: string;
  monitor: string;
  restricted: boolean;
}

export interface IdleLabelRequest {
  id: UUID;
  sessionId: UUID;
  start: ISODateTime;
  end: ISODateTime;
  label?: "MEETING" | "OFFLINE_WORK" | "BREAK" | "OTHER";
  note?: string;
}

/* ---------------------------------------------------------------- performance */

export type ScoreComponentKey = "A" | "O" | "Q" | "D" | "L";

export interface ScoreComponent {
  key: ScoreComponentKey;
  label: string;
  weight: number;
  numerator: number | null;
  denominator: number | null;
  value: number | null; // null = N/A
  provisional: boolean;
  explanation: string;
  sources: { type: string; id: UUID; label: string }[];
}

export type ScoreStatus = "PROVISIONAL" | "FINAL" | "DISPUTED" | "OVERRIDDEN";

export interface ScoreSnapshot {
  id: UUID;
  employeeId: UUID;
  periodStart: ISODate;
  periodEnd: ISODate;
  components: ScoreComponent[];
  coverageWeight: number;
  weightedScore: number | null;
  status: ScoreStatus;
  formulaVersion: number;
  computedAt: ISODateTime;
  override?: { score: number; reason: string; by: UUID; at: ISODateTime };
}

export interface ScoreDispute {
  id: UUID;
  snapshotId: UUID;
  employeeId: UUID;
  component?: ScoreComponentKey;
  reason: string;
  status: "OPEN" | "UNDER_REVIEW" | "UPHELD" | "REJECTED";
  resolution?: string;
  createdAt: ISODateTime;
}

/* ---------------------------------------------------------------- payroll */

export interface CompensationProfile {
  id: UUID;
  employeeId: UUID;
  effectiveFrom: ISODate;
  effectiveTo?: ISODate;
  basis: "MONTHLY" | "HOURLY";
  baseRate: Money;
  currency: string;
  proration: "CALENDAR_DAY" | "SCHEDULED_PAID_MINUTE";
  policyVersion: number;
}

export type PayrollPeriodState = "OPEN" | "CLOSED";

export interface PayrollPeriod {
  id: UUID;
  label: string;
  start: ISODate;
  end: ISODate;
  timezone: string;
  currency: string;
  state: PayrollPeriodState;
}

export type PayrollRunState = "DRAFT" | "UNDER_REVIEW" | "LOCKED" | "EXPORTED" | "PAID";

export type PayComponentCategory = "BASE" | "BONUS" | "OVERTIME" | "DEDUCTION" | "ADJUSTMENT";

export interface PayComponent {
  id: UUID;
  lineId: UUID;
  category: PayComponentCategory;
  description: string;
  quantity?: string;
  unitRate?: Money;
  amount: Money; // positive; sign derived from category
  status: "PROPOSED" | "APPROVED" | "REJECTED";
  proposedBy: UUID;
  approvedBy?: UUID;
  evidence?: string;
  correctionOf?: UUID;
  otRateBasis?: "FULL_RATE" | "PREMIUM_ONLY";
}

export interface PayrollLine {
  id: UUID;
  runId: UUID;
  employeeId: UUID;
  compensationProfileId?: UUID;
  scheduledMinutes: number;
  payableMinutes: number;
  components: PayComponent[];
  gross: Money;
  deductions: Money;
  net: Money;
  exceptions: string[];
}

export interface PayrollRun {
  id: UUID;
  periodId: UUID;
  revision: number;
  state: PayrollRunState;
  preparedBy: UUID;
  inputHash: string;
  totals: { gross: Money; deductions: Money; net: Money; currency: string; employees: number };
  lockedAt?: ISODateTime;
  exportedAt?: ISODateTime;
  paidAt?: ISODateTime;
  paymentReference?: string;
  version: number;
  approvals: { id: UUID; ownerId: UUID; inputHash: string; approvedAt: ISODateTime; reason: string }[];
  exports: { id: UUID; at: ISODateTime; by: UUID; format: "CSV" | "PDF"; expiresAt: ISODateTime }[];
  createdAt: ISODateTime;
}

export interface Payslip {
  id: UUID;
  runId: UUID;
  employeeId: UUID;
  periodLabel: string;
  currency: string;
  lines: { category: PayComponentCategory; description: string; amount: Money }[];
  gross: Money;
  deductions: Money;
  net: Money;
  approvalId: UUID;
  publishedAt: ISODateTime;
}

/* ---------------------------------------------------------------- assets */

export type AssetState = "AVAILABLE" | "ASSIGNED" | "RETURN_REQUESTED" | "RETURNED" | "MAINTENANCE" | "RETIRED";

export interface Asset extends Versioned {
  assetTag: string;
  serial: string;
  type: string;
  model: string;
  referenceDate?: ISODate;
  condition: "NEW" | "GOOD" | "FAIR" | "DAMAGED";
  state: AssetState;
  assignedEmployeeId?: UUID;
}

export interface AssetAssignment {
  id: UUID;
  assetId: UUID;
  employeeId: UUID;
  issuedAt: ISODateTime;
  returnedAt?: ISODateTime;
  issueCondition: string;
  returnCondition?: string;
  acknowledgedAt?: ISODateTime;
}

/* ---------------------------------------------------------------- policy, notifications, audit */

export type PolicyType = "MONITORING" | "ATTENDANCE" | "LEAVE" | "OVERTIME" | "COMPENSATION" | "RETENTION" | "SCORING";

export interface PolicyVersion {
  id: UUID;
  type: PolicyType;
  version: number;
  title: string;
  summary: string;
  config: Record<string, string | number | boolean>;
  effectiveFrom: ISODate;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "SUPERSEDED";
  approvedBy?: UUID;
  approvedAt?: ISODateTime;
}

export type NotificationKind =
  | "ASSIGNMENT"
  | "REVISION"
  | "REVIEW_APPROVED"
  | "DUE_REMINDER"
  | "LEAVE_DECISION"
  | "CORRECTION"
  | "PAYROLL_PUBLISHED"
  | "ASSET_ACTION"
  | "POLICY_ACK"
  | "SYNC_FAILURE"
  | "SECURITY";

export interface Notification {
  id: UUID;
  userId: UUID;
  kind: NotificationKind;
  title: string;
  body: string;
  href?: string;
  mandatory: boolean;
  readAt?: ISODateTime;
  createdAt: ISODateTime;
}

export interface AuditEvent {
  id: UUID;
  actorType: "USER" | "DEVICE" | "SERVICE";
  actorId: UUID;
  actorLabel: string;
  action: string;
  targetType: string;
  targetId: UUID;
  occurredAt: ISODateTime;
  requestId: string;
  reason?: string;
  result: "SUCCESS" | "DENIED" | "FAILED";
  change?: { before?: Record<string, unknown>; after?: Record<string, unknown> };
}

export interface ReportMeta {
  timezone: string;
  generatedAt: ISODateTime;
  dataCutoff: ISODateTime;
  policyVersion: number;
  state: "PROVISIONAL" | "FINAL";
}

export interface MediaHealth {
  poolBytes: number;
  usedBytes: number;
  byCategory: { category: MediaCategory; bytes: number }[];
  pendingTransfers: number;
  failedScans: number;
  quarantined: number;
  outboxBacklog: number;
  lastBackupAt: ISODateTime;
}

/* ---------------------------------------------------------------- API envelope */

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "INVALID_TRANSITION"
  | "FILE_TOO_LARGE"
  | "POLICY_BLOCKED"
  | "RATE_LIMITED"
  | "DEPENDENCY_UNAVAILABLE"
  | "REAUTH_REQUIRED";

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  fieldErrors?: Record<string, string>;
  requestId: string;
  retryable: boolean;
  latest?: unknown; // latest record on VERSION_CONFLICT
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}
