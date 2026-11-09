/**
 * Deterministic demo dataset for the mock API. Dates are relative to "now" so the demo stays current.
 * All people and values are fictional test data; monetary values are calculation examples (spec preface).
 */
import type * as T from "@/lib/types";
import type { MockDb } from "./db";
import { addDays, businessDate, weekday, zonedToUtc } from "@/lib/time";
import { computeLine, inputHash } from "@/lib/calc/payroll";

const TZ = "Asia/Karachi";
const ORG = "org-legacy-pixels";

function prng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function buildSeed(): MockDb {
  const rand = prng(42);
  const now = new Date();
  const nowIso = now.toISOString();
  const today = businessDate(now, TZ);
  const at = (dayOffset: number, hhmm: string) => zonedToUtc(addDays(today, dayOffset), hhmm, TZ);
  const d = (dayOffset: number) => addDays(today, dayOffset);
  const base = { organizationId: ORG, createdAt: at(-120, "09:00"), updatedAt: at(-1, "09:00"), version: 1 };

  /* ---------------------------------------------------------------- organization & people */
  const organization: T.Organization = {
    id: ORG,
    name: "Legacy Pixels",
    timezone: TZ,
    payrollCurrency: "PKR",
    status: "ACTIVE",
    activePolicyVersion: 3,
  };

  const people: {
    key: string; name: string; title: string; team?: string; manager?: string; roles: T.RoleKey[];
    status?: T.EmploymentStatus; color: string; noEmployee?: boolean; start: string;
  }[] = [
    { key: "ayesha", name: "Ayesha Raza", title: "Founder & Owner", team: "ops", roles: ["OWNER", "EMPLOYEE"], color: "#7c3aed", start: "2019-03-01" },
    { key: "bilal", name: "Bilal Ahmed", title: "Systems Administrator", team: "ops", manager: "ayesha", roles: ["ADMIN", "EMPLOYEE"], color: "#0891b2", start: "2021-06-14" },
    { key: "sana", name: "Sana Malik", title: "HR Lead", team: "ops", manager: "ayesha", roles: ["HR", "EMPLOYEE"], color: "#db2777", start: "2020-09-01" },
    { key: "omar", name: "Omar Farooq", title: "Payroll Officer", team: "ops", manager: "ayesha", roles: ["PAYROLL", "EMPLOYEE"], color: "#ca8a04", start: "2022-01-10" },
    { key: "hamza", name: "Hamza Qureshi", title: "Creative Manager", team: "design", manager: "ayesha", roles: ["MANAGER", "EMPLOYEE"], color: "#2563eb", start: "2020-02-03" },
    { key: "zara", name: "Zara Khan", title: "Design Lead", team: "design", manager: "hamza", roles: ["REVIEWER", "EMPLOYEE"], color: "#059669", start: "2021-04-19" },
    { key: "ali", name: "Ali Hassan", title: "Graphic Designer", team: "design", manager: "hamza", roles: ["EMPLOYEE"], color: "#ea580c", start: "2023-07-03" },
    { key: "fatima", name: "Fatima Noor", title: "UI Designer", team: "design", manager: "hamza", roles: ["EMPLOYEE"], color: "#9333ea", start: "2022-11-21" },
    { key: "usman", name: "Usman Tariq", title: "Video Editor", team: "video", manager: "hamza", roles: ["EMPLOYEE"], color: "#dc2626", start: "2023-02-13" },
    { key: "hira", name: "Hira Aslam", title: "Motion Designer", team: "video", manager: "hamza", roles: ["EMPLOYEE"], color: "#0d9488", start: "2024-05-06" },
    { key: "kamran", name: "Kamran Shah", title: "Junior Designer", team: "design", manager: "hamza", roles: ["EMPLOYEE"], status: "SUSPENDED", color: "#64748b", start: "2024-09-02" },
    { key: "nadia", name: "Nadia Iqbal", title: "External Auditor", roles: ["AUDITOR"], color: "#475569", noEmployee: true, start: "2026-10-01" },
  ];

  const users: T.User[] = people.map((p) => ({
    id: `usr-${p.key}`,
    email: `${p.key}@legacypixels.test`,
    status: p.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
    lastLogin: at(-1, "09:02"),
    mfaEnrolled: p.roles.some((r) => ["OWNER", "ADMIN", "HR", "PAYROLL"].includes(r)),
    employeeId: p.noEmployee ? undefined : `emp-${p.key}`,
  }));
  users.push({ id: "usr-maryam", email: "maryam@legacypixels.test", status: "INVITED", mfaEnrolled: false, employeeId: "emp-maryam" });

  const employees: T.Employee[] = people
    .filter((p) => !p.noEmployee)
    .map((p, i) => ({
      ...base,
      id: `emp-${p.key}`,
      userId: `usr-${p.key}`,
      employeeCode: `LP-${String(i + 1).padStart(3, "0")}`,
      displayName: p.name,
      title: p.title,
      teamId: p.team ? `team-${p.team}` : undefined,
      managerId: p.manager ? `emp-${p.manager}` : undefined,
      workEmail: `${p.key}@legacypixels.test`,
      workPhone: `+92 300 55${String(10 + i).padStart(2, "0")} ${String(100 + i * 7).slice(-3)}`,
      startDate: p.start,
      employmentStatus: p.status ?? "ACTIVE",
      timezone: TZ,
      avatarColor: p.color,
    }));
  employees.push({
    ...base, id: "emp-maryam", userId: "usr-maryam", employeeCode: "LP-012", displayName: "Maryam Siddiqui",
    title: "Illustrator", teamId: "team-design", managerId: "emp-hamza", workEmail: "maryam@legacypixels.test",
    startDate: d(7), employmentStatus: "INVITED", timezone: TZ, avatarColor: "#be185d",
  });

  const roleAssignments: T.RoleAssignment[] = people.flatMap((p) =>
    p.roles.map((role) => ({
      ...base,
      id: `ra-${p.key}-${role.toLowerCase()}`,
      userId: `usr-${p.key}`,
      role,
      scopeType: (role === "MANAGER" ? "team" : role === "REVIEWER" ? "project" : role === "EMPLOYEE" ? "self" : "organization") as T.ScopeType,
      scopeId: role === "MANAGER" ? "team-design" : undefined,
      validFrom: role === "AUDITOR" ? d(-10) : p.start,
      validTo: role === "AUDITOR" ? d(50) : undefined,
      approvedBy: "usr-ayesha",
    })),
  );

  const teams: T.Team[] = [
    { ...base, id: "team-design", name: "Design", managerEmployeeId: "emp-hamza", memberIds: ["emp-zara", "emp-ali", "emp-fatima", "emp-kamran", "emp-maryam"] },
    { ...base, id: "team-video", name: "Video & Motion", managerEmployeeId: "emp-hamza", memberIds: ["emp-usman", "emp-hira"] },
    { ...base, id: "team-ops", name: "Operations", managerEmployeeId: "emp-ayesha", memberIds: ["emp-bilal", "emp-sana", "emp-omar", "emp-hamza"] },
  ];

  const privateProfiles: T.EmployeePrivateProfile[] = employees.map((e, i) => ({
    employeeId: e.id,
    legalName: e.displayName,
    emergencyContactName: ["Rashid", "Amna", "Tariq", "Saima", "Imran", "Nida"][i % 6] + " " + e.displayName.split(" ")[1],
    emergencyContactPhone: `+92 321 40${String(10 + i)} ${String(300 + i * 11).slice(-3)}`,
    paymentReferenceMasked: `PK** **** **** ${String(1000 + i * 137).slice(-4)}`,
    documents: [
      { id: `doc-${e.id}-1`, name: "Employment agreement.pdf", category: "Contract", uploadedAt: at(-200, "10:00") },
      { id: `doc-${e.id}-2`, name: "Monitoring notice acknowledgement.pdf", category: "Policy", uploadedAt: at(-40, "10:00") },
    ],
    acknowledgements: [
      { policyType: "MONITORING", version: 3, acknowledgedAt: at(-40, "10:12") },
      { policyType: "ATTENDANCE", version: 2, acknowledgedAt: at(-90, "09:30") },
    ],
  }));

  const invitations: T.Invitation[] = [
    { id: "inv-maryam", email: "maryam@legacypixels.test", role: "EMPLOYEE", teamId: "team-design", expiresAt: at(5, "23:59"), status: "PENDING", createdAt: at(-2, "11:00") },
    { id: "inv-old", email: "contractor@legacypixels.test", role: "EMPLOYEE", expiresAt: at(-3, "23:59"), status: "EXPIRED", createdAt: at(-10, "11:00") },
  ];

  /* ---------------------------------------------------------------- projects & tasks */
  const projects: T.Project[] = [
    { ...base, id: "prj-brand", code: "BRAND-REFRESH", name: "Brand Refresh 2026", brief: "Refresh the Legacy Pixels visual identity: logo, palette, guidelines and stationery.", externalReference: "Brief BR-118", managerId: "emp-hamza", state: "ACTIVE", plannedStart: d(-30), plannedEnd: d(25), memberIds: ["emp-zara", "emp-ali", "emp-fatima"], taskCounts: { total: 0, completed: 0 } },
    { ...base, id: "prj-web", code: "WEB-2026", name: "Website Redesign", brief: "Responsive marketing website with new design system.", managerId: "emp-hamza", state: "ACTIVE", plannedStart: d(-20), plannedEnd: d(40), memberIds: ["emp-zara", "emp-ali", "emp-fatima"], taskCounts: { total: 0, completed: 0 } },
    { ...base, id: "prj-video", code: "VID-Q4", name: "Q4 Explainer Series", brief: "Three 90-second explainer videos with motion graphics.", externalReference: "Ref VX-31", managerId: "emp-hamza", state: "ON_HOLD", plannedStart: d(-25), plannedEnd: d(35), memberIds: ["emp-usman", "emp-hira", "emp-zara"], taskCounts: { total: 0, completed: 0 } },
    { ...base, id: "prj-social", code: "SOC-DEC", name: "December Social Pack", brief: "Seasonal social media templates.", managerId: "emp-hamza", state: "DRAFT", plannedStart: d(10), plannedEnd: d(30), memberIds: ["emp-ali", "emp-hira"], taskCounts: { total: 0, completed: 0 } },
    { ...base, id: "prj-catalog", code: "CAT-2026", name: "Product Catalog 2026", brief: "Print and digital product catalogue.", managerId: "emp-hamza", state: "COMPLETED", plannedStart: d(-90), plannedEnd: d(-35), memberIds: ["emp-fatima", "emp-ali", "emp-zara"], taskCounts: { total: 0, completed: 0 } },
  ];

  const cl = (...labels: string[]): T.ChecklistItem[] => labels.map((label, i) => ({ id: `c${i + 1}`, label }));
  type TaskSeed = Partial<T.Task> & Pick<T.Task, "id" | "projectId" | "title" | "state"> & { due: number; pts: string };
  const taskSeeds: TaskSeed[] = [
    { id: "tsk-logo", projectId: "prj-brand", title: "Primary logo refinement", state: "APPROVED", assigneeId: "emp-ali", due: -5, pts: "8.00", priority: "HIGH", estimateMinutes: 960, brief: "Refine the primary wordmark and symbol for small sizes and single-colour use.", acceptanceChecklist: cl("Source AI file with outlined type", "SVG + PNG exports at 3 sizes", "Single-colour variant") },
    { id: "tsk-palette", projectId: "prj-brand", title: "Colour palette & tokens", state: "SUBMITTED", assigneeId: "emp-fatima", due: 2, pts: "5.00", priority: "MEDIUM", estimateMinutes: 480, brief: "Define primary, secondary and neutral palettes with accessible contrast pairs and design tokens.", acceptanceChecklist: cl("Palette swatches", "Contrast table (WCAG AA)", "Token JSON") },
    { id: "tsk-guidelines", projectId: "prj-brand", title: "Brand guidelines PDF", state: "IN_PROGRESS", assigneeId: "emp-ali", due: 6, pts: "13.00", priority: "HIGH", estimateMinutes: 1920, brief: "Compile a 24-page brand guideline document covering logo usage, colour, typography and imagery.", acceptanceChecklist: cl("InDesign source package", "Print-ready PDF", "Web PDF under 20 MB"), dependencyIds: ["tsk-logo"] },
    { id: "tsk-stationery", projectId: "prj-brand", title: "Stationery set", state: "ASSIGNED", assigneeId: "emp-ali", due: 10, pts: "5.00", priority: "LOW", estimateMinutes: 600, brief: "Business card, letterhead and email signature using the refreshed identity.", acceptanceChecklist: cl("Print-ready business card", "Letterhead DOCX + PDF", "HTML email signature"), dependencyIds: ["tsk-guidelines"] },
    { id: "tsk-icons", projectId: "prj-brand", title: "Icon set (48 icons)", state: "REVISION_REQUESTED", assigneeId: "emp-fatima", due: 1, pts: "8.00", priority: "MEDIUM", estimateMinutes: 960, brief: "Line icon set on a 24px grid matching the new brand stroke weight.", acceptanceChecklist: cl("48 icons on 24px grid", "SVG sprite", "Figma component library") },
    { id: "tsk-wire", projectId: "prj-web", title: "Homepage wireframes", state: "COMPLETED", assigneeId: "emp-fatima", due: -12, pts: "5.00", priority: "MEDIUM", estimateMinutes: 480, brief: "Low-fidelity wireframes for the homepage at desktop and mobile breakpoints.", acceptanceChecklist: cl("Desktop wireframe", "Mobile wireframe") },
    { id: "tsk-home", projectId: "prj-web", title: "Homepage design", state: "SUBMITTED", assigneeId: "emp-ali", due: -1, pts: "8.00", priority: "URGENT", estimateMinutes: 240, brief: "Deliver desktop and mobile layouts", acceptanceChecklist: cl("Source file", "Approved export"), dependencyIds: ["tsk-wire"] },
    { id: "tsk-mobile", projectId: "prj-web", title: "Mobile layouts for inner pages", state: "BLOCKED", assigneeId: "emp-ali", due: 4, pts: "8.00", priority: "MEDIUM", estimateMinutes: 960, brief: "Mobile layouts for About, Services and Contact pages.", acceptanceChecklist: cl("Three mobile layouts", "Annotated spacing"), resumeState: "IN_PROGRESS", blocker: { reason: "Waiting for final page copy", responsibleParty: "Content (Hamza Qureshi)" } },
    { id: "tsk-hero", projectId: "prj-web", title: "Hero illustration", state: "ASSIGNED", assigneeId: "emp-ali", due: -1, pts: "5.00", priority: "HIGH", estimateMinutes: 720, brief: "Custom hero illustration in brand style, 2 colour variants.", acceptanceChecklist: cl("Layered source", "Desktop + mobile crops") },
    { id: "tsk-a11y", projectId: "prj-web", title: "Accessibility review of components", state: "DRAFT", due: 14, pts: "3.00", priority: "LOW", brief: "Review component designs against WCAG 2.2 AA.", acceptanceChecklist: cl("Checklist per component", "Issue list"), noEstimateReason: "Scope depends on component count" },
    { id: "tsk-storyboard", projectId: "prj-video", title: "Episode 1 storyboard", state: "COMPLETED", assigneeId: "emp-usman", due: -15, pts: "5.00", priority: "MEDIUM", estimateMinutes: 600, brief: "Storyboard for episode 1 (90s).", acceptanceChecklist: cl("Storyboard PDF", "Shot list") },
    { id: "tsk-ep1", projectId: "prj-video", title: "Episode 1 edit", state: "IN_PROGRESS", assigneeId: "emp-usman", due: 3, pts: "13.00", priority: "HIGH", estimateMinutes: 1440, brief: "Rough cut and final edit for episode 1 with captions.", acceptanceChecklist: cl("Project file", "1080p master", "SRT captions"), dependencyIds: ["tsk-storyboard"] },
    { id: "tsk-motion", projectId: "prj-video", title: "Motion graphics kit", state: "IN_PROGRESS", assigneeId: "emp-hira", due: 8, pts: "8.00", priority: "MEDIUM", estimateMinutes: 1200, brief: "Reusable lower thirds, transitions and title cards.", acceptanceChecklist: cl("AE project", "MOGRT exports") },
    { id: "tsk-social-1", projectId: "prj-social", title: "Template set: Instagram", state: "DRAFT", due: 18, pts: "5.00", priority: "MEDIUM", brief: "Seasonal Instagram post and story templates.", acceptanceChecklist: cl("6 post templates", "4 story templates"), estimateMinutes: 600 },
    { id: "tsk-cat-layout", projectId: "prj-catalog", title: "Catalogue page layouts", state: "COMPLETED", assigneeId: "emp-fatima", due: -40, pts: "13.00", priority: "HIGH", estimateMinutes: 1800, brief: "48-page catalogue layout.", acceptanceChecklist: cl("InDesign package", "Print PDF") },
    { id: "tsk-cat-cover", projectId: "prj-catalog", title: "Catalogue cover", state: "COMPLETED", assigneeId: "emp-ali", due: -42, pts: "3.00", priority: "MEDIUM", estimateMinutes: 360, brief: "Front and back cover.", acceptanceChecklist: cl("Cover PDF") },
  ];

  const tasks: T.Task[] = taskSeeds.map(({ due, pts, ...t }) => ({
    ...base,
    brief: "",
    acceptanceChecklist: [],
    reviewerId: t.projectId === "prj-video" ? "emp-zara" : t.state === "DRAFT" && !t.assigneeId ? undefined : "emp-zara",
    priority: "MEDIUM",
    baselinePoints: pts,
    baselineDueAt: at(due, "18:00"),
    dueAt: at(due, "18:00"),
    baselineVersion: 1,
    rubricVersion: 1,
    dependencyIds: [],
    actualStartAt: ["DRAFT", "ASSIGNED"].includes(t.state) ? undefined : at(due - 6, "10:00"),
    version: ({ DRAFT: 1, ASSIGNED: 2, IN_PROGRESS: 3, BLOCKED: 4, SUBMITTED: 4, REVISION_REQUESTED: 5, APPROVED: 7, COMPLETED: 8, CANCELLED: 3 } as Record<T.TaskState, number>)[t.state],
    ...t,
  }));
  // Palette review is assigned to the Design Lead; the Hamza manager reviews video when Zara is busy.
  tasks.find((t) => t.id === "tsk-motion")!.reviewerId = "emp-zara";

  for (const p of projects) {
    const pts = tasks.filter((t) => t.projectId === p.id);
    p.taskCounts = { total: pts.length, completed: pts.filter((t) => ["COMPLETED", "APPROVED"].includes(t.state)).length };
  }

  /* ---------------------------------------------------------------- task events */
  const taskEvents: T.TaskEvent[] = [];
  const chain: Record<T.TaskState, T.TaskState[]> = {
    DRAFT: [], ASSIGNED: ["ASSIGNED"], IN_PROGRESS: ["ASSIGNED", "IN_PROGRESS"],
    BLOCKED: ["ASSIGNED", "IN_PROGRESS", "BLOCKED"], SUBMITTED: ["ASSIGNED", "IN_PROGRESS", "SUBMITTED"],
    REVISION_REQUESTED: ["ASSIGNED", "IN_PROGRESS", "SUBMITTED", "REVISION_REQUESTED"],
    APPROVED: ["ASSIGNED", "IN_PROGRESS", "SUBMITTED", "REVISION_REQUESTED", "SUBMITTED", "APPROVED"],
    COMPLETED: ["ASSIGNED", "IN_PROGRESS", "SUBMITTED", "APPROVED", "COMPLETED"], CANCELLED: ["CANCELLED"],
  };
  for (const t of tasks) {
    const seed = taskSeeds.find((s) => s.id === t.id)!;
    const steps = chain[t.state];
    let prev: T.TaskState = "DRAFT";
    taskEvents.push({ id: `te-${t.id}-0`, taskId: t.id, transition: "create", actorId: "emp-hamza", toState: "DRAFT", occurredAt: at(seed.due - 12, "10:00"), resultingVersion: 1 });
    steps.forEach((s, i) => {
      const actor = ["IN_PROGRESS", "SUBMITTED", "BLOCKED"].includes(s) ? t.assigneeId! : ["APPROVED", "REVISION_REQUESTED"].includes(s) ? t.reviewerId! : "emp-hamza";
      taskEvents.push({
        id: `te-${t.id}-${i + 1}`, taskId: t.id, transition: s.toLowerCase(), actorId: actor, fromState: prev, toState: s,
        reason: s === "BLOCKED" ? t.blocker?.reason : s === "REVISION_REQUESTED" ? "Checklist items not met" : undefined,
        occurredAt: at(seed.due - 10 + i * 2 - (t.state === "SUBMITTED" && s === "SUBMITTED" ? 1 : 0), "11:30"), resultingVersion: i + 2,
      });
      prev = s;
    });
  }

  /* ---------------------------------------------------------------- media, submissions, reviews */
  const media: T.MediaAsset[] = [];
  const mk = (id: string, name: string, mime: string, size: number, uploader: string, day: number, state: T.MediaState = "AVAILABLE", category: T.MediaCategory = "PROJECT_OUTPUT"): string => {
    media.push({ id, category, name, mimeType: mime, sizeBytes: size, sha256: state === "AVAILABLE" ? `${id.replace(/[^a-z0-9]/g, "").padEnd(16, "0").slice(0, 16)}e3b0c44298fc1c14` : undefined, state, scanResult: state === "AVAILABLE" ? "CLEAN" : state === "QUARANTINED" ? "INFECTED" : "PENDING", uploaderId: uploader, createdAt: at(day, "15:00") });
    return id;
  };
  const MB = 1024 * 1024;
  const submissions: T.Submission[] = [
    { id: "sub-logo-1", taskId: "tsk-logo", sequence: 1, authorId: "emp-ali", summary: "First pass at the refined wordmark with tightened kerning and a simplified symbol.", state: "SUPERSEDED", mediaIds: [mk("med-logo-1a", "logo-v1.ai", "application/postscript", 18 * MB, "emp-ali", -10), mk("med-logo-1b", "logo-v1-exports.zip", "application/zip", 6 * MB, "emp-ali", -10)], workLogIds: [], submittedAt: at(-9, "16:40"), frozenAt: at(-9, "16:40") },
    { id: "sub-logo-2", taskId: "tsk-logo", sequence: 2, authorId: "emp-ali", summary: "Addressed feedback: added single-colour variant, exported SVG/PNG at 3 sizes, outlined type.", state: "SUBMITTED", mediaIds: ["med-logo-1a", mk("med-logo-2b", "logo-v2-exports.zip", "application/zip", 7 * MB, "emp-ali", -6), mk("med-logo-2c", "logo-mono.svg", "image/svg+xml", 48 * 1024, "emp-ali", -6)], workLogIds: [], submittedAt: at(-6, "17:10"), frozenAt: at(-6, "17:10") },
    { id: "sub-palette-1", taskId: "tsk-palette", sequence: 1, authorId: "emp-fatima", summary: "Palette with 6 primaries, 4 neutrals, contrast table and tokens exported as JSON.", state: "SUBMITTED", mediaIds: [mk("med-pal-1", "palette.fig", "application/octet-stream", 12 * MB, "emp-fatima", -1), mk("med-pal-2", "contrast-table.pdf", "application/pdf", 900 * 1024, "emp-fatima", -1), mk("med-pal-3", "tokens.json", "application/json", 14 * 1024, "emp-fatima", -1)], workLogIds: [], submittedAt: at(-1, "15:20"), frozenAt: at(-1, "15:20") },
    { id: "sub-icons-1", taskId: "tsk-icons", sequence: 1, authorId: "emp-fatima", summary: "Initial 48-icon set on 24px grid.", state: "SUBMITTED", mediaIds: [mk("med-ico-1", "icons-v1.svg", "image/svg+xml", 320 * 1024, "emp-fatima", -3)], workLogIds: [], submittedAt: at(-3, "17:00"), frozenAt: at(-3, "17:00") },
    { id: "sub-icons-2", taskId: "tsk-icons", sequence: 2, authorId: "emp-fatima", summary: "", state: "DRAFT", mediaIds: [mk("med-ico-2", "icons-v2.svg", "image/svg+xml", 340 * 1024, "emp-fatima", 0, "SCANNING")], workLogIds: [] },
    { id: "sub-home-1", taskId: "tsk-home", sequence: 1, authorId: "emp-ali", summary: "Desktop and mobile homepage layouts with component annotations. Exports attached.", state: "SUBMITTED", mediaIds: [mk("med-home-1", "layout.zip", "application/zip", 8 * MB, "emp-ali", -2), mk("med-home-2", "homepage-desktop.png", "image/png", 3 * MB, "emp-ali", -2), mk("med-home-3", "homepage-mobile.png", "image/png", 2 * MB, "emp-ali", -2)], workLogIds: [], submittedAt: at(-2, "16:05"), frozenAt: at(-2, "16:05") },
    { id: "sub-wire-1", taskId: "tsk-wire", sequence: 1, authorId: "emp-fatima", summary: "Wireframes for desktop and mobile.", state: "SUBMITTED", mediaIds: [mk("med-wire-1", "wireframes.pdf", "application/pdf", 2 * MB, "emp-fatima", -13)], workLogIds: [], submittedAt: at(-13, "14:00"), frozenAt: at(-13, "14:00") },
    { id: "sub-story-1", taskId: "tsk-storyboard", sequence: 1, authorId: "emp-usman", summary: "Storyboard and shot list.", state: "SUBMITTED", mediaIds: [mk("med-story-1", "ep1-storyboard.pdf", "application/pdf", 5 * MB, "emp-usman", -16)], workLogIds: [], submittedAt: at(-16, "12:00"), frozenAt: at(-16, "12:00") },
    { id: "sub-cat-1", taskId: "tsk-cat-layout", sequence: 1, authorId: "emp-fatima", summary: "Full layout package.", state: "SUBMITTED", mediaIds: [mk("med-cat-1", "catalog-package.zip", "application/zip", 1.2 * 1024 * MB, "emp-fatima", -41)], workLogIds: [], submittedAt: at(-41, "12:00"), frozenAt: at(-41, "12:00") },
    { id: "sub-cov-1", taskId: "tsk-cat-cover", sequence: 1, authorId: "emp-ali", summary: "Cover PDF.", state: "SUBMITTED", mediaIds: [mk("med-cov-1", "cover.pdf", "application/pdf", 22 * MB, "emp-ali", -43)], workLogIds: [], submittedAt: at(-43, "12:00"), frozenAt: at(-43, "12:00") },
  ];
  mk("med-ep1-draft", "ep1-roughcut.mp4", "video/mp4", 2.4 * 1024 * MB, "emp-usman", 0, "TRANSFERRING");
  mk("med-bad", "plugin-installer.exe", "application/x-msdownload", 4 * MB, "emp-hira", -4, "QUARANTINED");
  media.find((m) => m.id === "med-ep1-draft")!.progress = 0.62;
  submissions.push({ id: "sub-ep1-draft", taskId: "tsk-ep1", sequence: 1, authorId: "emp-usman", summary: "", state: "DRAFT", mediaIds: ["med-ep1-draft"], workLogIds: [] });

  const allChecks = (task: string, v: boolean) => Object.fromEntries((tasks.find((t) => t.id === task)?.acceptanceChecklist ?? []).map((c) => [c.id, v]));
  const reviews: T.ReviewDecision[] = [
    { id: "rev-logo-1", submissionId: "sub-logo-1", taskId: "tsk-logo", reviewerId: "emp-zara", decision: "REQUEST_REVISION", checklist: { c1: true, c2: false, c3: false }, rubricVersion: 1, feedback: "Good direction. Please add the single-colour variant and export SVG/PNG at 16, 32 and 512px. Type must be outlined in the source.", decidedAt: at(-8, "11:20") },
    { id: "rev-logo-2", submissionId: "sub-logo-2", taskId: "tsk-logo", reviewerId: "emp-zara", decision: "APPROVE", checklist: allChecks("tsk-logo", true), rubricScores: { brief: 90, technical: 85, presentation: 80, organization: 100 }, rubricVersion: 1, weightedQuality: "87.50", feedback: "Acceptance checklist satisfied", decidedAt: at(-5, "10:45") },
    { id: "rev-icons-1", submissionId: "sub-icons-1", taskId: "tsk-icons", reviewerId: "emp-zara", decision: "REQUEST_REVISION", checklist: { c1: true, c2: false, c3: false }, rubricVersion: 1, feedback: "Stroke weight is inconsistent on 9 icons (list in comments). SVG sprite and Figma library are missing.", decidedAt: at(-2, "12:10") },
    { id: "rev-wire-1", submissionId: "sub-wire-1", taskId: "tsk-wire", reviewerId: "emp-zara", decision: "APPROVE", checklist: allChecks("tsk-wire", true), rubricScores: { brief: 85, technical: 90, presentation: 80, organization: 90 }, rubricVersion: 1, weightedQuality: "86.00", feedback: "Clear and complete.", decidedAt: at(-12, "10:00") },
    { id: "rev-story-1", submissionId: "sub-story-1", taskId: "tsk-storyboard", reviewerId: "emp-zara", decision: "APPROVE", checklist: allChecks("tsk-storyboard", true), rubricScores: { brief: 90, technical: 80, presentation: 85, organization: 80 }, rubricVersion: 1, weightedQuality: "85.00", feedback: "Approved.", decidedAt: at(-15, "10:00") },
    { id: "rev-cat-1", submissionId: "sub-cat-1", taskId: "tsk-cat-layout", reviewerId: "emp-zara", decision: "APPROVE", checklist: allChecks("tsk-cat-layout", true), rubricScores: { brief: 95, technical: 90, presentation: 90, organization: 85 }, rubricVersion: 1, weightedQuality: "91.50", feedback: "Excellent.", decidedAt: at(-40, "10:00") },
    { id: "rev-cov-1", submissionId: "sub-cov-1", taskId: "tsk-cat-cover", reviewerId: "emp-zara", decision: "APPROVE", checklist: allChecks("tsk-cat-cover", true), rubricScores: { brief: 80, technical: 85, presentation: 90, organization: 70 }, rubricVersion: 1, weightedQuality: "82.50", feedback: "Approved.", decidedAt: at(-42, "10:00") },
  ];

  const comments: T.TaskComment[] = [
    { id: "cm-1", taskId: "tsk-home", authorId: "emp-hamza", body: "Please make sure the hero CTA matches the new button tokens.", createdAt: at(-4, "10:15") },
    { id: "cm-2", taskId: "tsk-home", authorId: "emp-ali", body: "Done — using the primary/600 token. Mobile export attached in the submission.", createdAt: at(-2, "16:10") },
    { id: "cm-3", taskId: "tsk-icons", authorId: "emp-zara", body: "Inconsistent stroke: calendar, cart, chat, cloud, flag, gift, home, lock, user.", createdAt: at(-2, "12:12"), anchor: { submissionId: "sub-icons-1", mediaId: "med-ico-1" } },
    { id: "cm-4", taskId: "tsk-mobile", authorId: "emp-ali", body: "Blocked until the final About/Services copy is approved.", createdAt: at(-1, "11:00") },
    { id: "cm-5", taskId: "tsk-guidelines", authorId: "emp-zara", body: "Use the approved logo v2 exports from the logo task.", createdAt: at(-3, "09:40") },
  ];

  /* ---------------------------------------------------------------- work logs */
  const workLogs: T.WorkLog[] = [];
  const logTasks: Record<string, string[]> = {
    "emp-ali": ["tsk-guidelines", "tsk-home", "tsk-logo"],
    "emp-fatima": ["tsk-palette", "tsk-icons"],
    "emp-usman": ["tsk-ep1"],
    "emp-hira": ["tsk-motion"],
  };
  for (let off = -9; off <= -1; off++) {
    if ([0, 6].includes(weekday(d(off)))) continue;
    for (const [emp, tids] of Object.entries(logTasks)) {
      tids.slice(0, 2).forEach((tid, i) => {
        const mins = i === 0 ? 240 + Math.round(rand() * 6) * 10 : 150 + Math.round(rand() * 6) * 10;
        workLogs.push({
          id: `wl-${emp}-${off}-${i}`, employeeId: emp, taskId: tid, businessDate: d(off), durationMinutes: mins,
          description: i === 0 ? "Production work on deliverable" : "Revisions and exports",
          source: "MANUAL", status: off < -2 ? "APPROVED" : "SUBMITTED", approvedMinutes: off < -2 ? mins : undefined, reviewerId: off < -2 ? "emp-hamza" : undefined,
        });
      });
    }
  }

  /* ---------------------------------------------------------------- shifts & attendance */
  const shiftTemplates: T.ShiftTemplate[] = [
    { ...base, id: "shift-day", name: "Standard day", timezone: TZ, localStart: "09:00", localEnd: "18:00", weekdays: [1, 2, 3, 4, 5], paidBreakMinutes: 0, unpaidBreakMinutes: 60, graceMinutes: 10, policyVersion: 2, effectiveFrom: "2026-01-01", assignedTeamIds: ["team-design", "team-ops"] },
    { ...base, id: "shift-late", name: "Video late shift", timezone: TZ, localStart: "12:00", localEnd: "21:00", weekdays: [1, 2, 3, 4, 5], paidBreakMinutes: 15, unpaidBreakMinutes: 45, graceMinutes: 10, policyVersion: 2, effectiveFrom: "2026-01-01", assignedTeamIds: ["team-video"] },
    { ...base, id: "shift-night", name: "Overnight render support", timezone: TZ, localStart: "22:00", localEnd: "06:00", weekdays: [5], paidBreakMinutes: 30, unpaidBreakMinutes: 0, graceMinutes: 15, policyVersion: 2, effectiveFrom: "2026-06-01", assignedTeamIds: [] },
  ];
  const holidays: T.Holiday[] = [
    { id: "hol-1", date: "2026-08-14", name: "Independence Day" },
    { id: "hol-2", date: "2026-12-25", name: "Quaid-e-Azam Day" },
    { id: "hol-3", date: d(-11 - ((weekday(d(-11)) + 6) % 7) + 2), name: "Company wellbeing day" },
  ];

  const attendanceEvents: T.AttendanceEvent[] = [];
  const shiftFor = (empId: string) => {
    const team = employees.find((e) => e.id === empId)?.teamId;
    return shiftTemplates.find((s) => team && s.assignedTeamIds.includes(team)) ?? shiftTemplates[0];
  };
  const worker = ["ayesha", "bilal", "sana", "omar", "hamza", "zara", "ali", "fatima", "usman", "hira"];
  const nowLocalMinutes = (() => {
    const t = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  })();
  const addMin = (hhmm: string, mins: number) => {
    const [h, m] = hhmm.split(":").map(Number);
    const t = h * 60 + m + mins;
    return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  };
  const leaveDay = { "emp-usman": d(-6) } as Record<string, string>;
  for (let off = -20; off <= 0; off++) {
    const date = d(off);
    if (![1, 2, 3, 4, 5].includes(weekday(date))) continue;
    if (holidays.some((h) => h.date === date)) continue;
    for (const k of worker) {
      const emp = `emp-${k}`;
      if (leaveDay[emp] === date) continue;
      if (k === "hira" && off === -4) continue; // absent without record
      const sh = shiftFor(emp);
      const lateBy = k === "fatima" && off % 5 === 0 ? 22 : Math.round(rand() * 12) - 4;
      const inT = addMin(sh.localStart, lateBy);
      const brkS = addMin(sh.localStart, 240);
      const brkE = addMin(brkS, sh.unpaidBreakMinutes);
      const outT = addMin(sh.localEnd, Math.round(rand() * 25) + (k === "ali" && off === -7 ? 120 : 0));
      const ev = (kind: T.AttendanceEventKind, hhmm: string, src: T.AttendanceEvent["source"] = k === "ali" || k === "fatima" || k === "usman" ? "AGENT" : "WEB") => {
        const occ = zonedToUtc(date, hhmm, TZ);
        attendanceEvents.push({ id: `ae-${emp}-${off}-${kind}`, employeeId: emp, kind, occurredAt: occ, receivedAt: occ, source: src, deviceId: src === "AGENT" ? `dev-${k}` : undefined, flags: [] });
      };
      const [ih, im] = inT.split(":").map(Number);
      if (off === 0 && nowLocalMinutes < ih * 60 + im) continue;
      ev("CHECK_IN", inT);
      const [bh, bm] = brkS.split(":").map(Number);
      if (off === 0 && nowLocalMinutes < bh * 60 + bm) continue;
      ev("BREAK_START", brkS);
      const [eh, em] = brkE.split(":").map(Number);
      if (off === 0 && nowLocalMinutes < eh * 60 + em) continue;
      ev("BREAK_END", brkE);
      if (off === 0) continue; // still working today
      if (k === "ali" && off === -3) continue; // missing checkout -> incomplete day
      ev("CHECK_OUT", outT);
    }
  }

  const corrections: T.AttendanceCorrection[] = [
    { id: "cor-1", employeeId: "emp-ali", businessDate: d(-3), proposedCheckOut: at(-3, "18:12"), reason: "Forgot to check out; was working on guideline exports until 18:10 (see work log).", status: "PROPOSED", affectsLockedPayroll: false, createdAt: at(-2, "09:15") },
    { id: "cor-2", employeeId: "emp-fatima", businessDate: d(-5), proposedCheckIn: at(-5, "09:02"), reason: "Check-in delayed by network outage at office; arrived 09:00.", status: "MANAGER_VALIDATED", managerDecisionBy: "emp-hamza", affectsLockedPayroll: false, createdAt: at(-4, "10:00") },
  ];

  /* ---------------------------------------------------------------- leave & overtime */
  const leaveTypes: T.LeaveType[] = [
    { id: "lt-annual", name: "Annual leave", allowNegative: false, requiresDocument: false },
    { id: "lt-sick", name: "Sick leave", allowNegative: false, requiresDocument: true },
    { id: "lt-unpaid", name: "Unpaid leave", allowNegative: true, requiresDocument: false },
    { id: "lt-comp", name: "Compassionate leave", allowNegative: false, requiresDocument: false },
  ];
  const leaveRequests: T.LeaveRequest[] = [
    { id: "lv-1", employeeId: "emp-usman", typeId: "lt-annual", startDate: d(-6), endDate: d(-6), requestedMinutes: 480, note: "Family event", hasDocument: false, status: "APPROVED", managerDecision: { by: "emp-hamza", decision: "RECOMMEND", at: at(-12, "10:00") }, hrDecision: { by: "emp-sana", decision: "APPROVED", at: at(-11, "10:00") }, createdAt: at(-13, "10:00") },
    { id: "lv-2", employeeId: "emp-ali", typeId: "lt-annual", startDate: d(8), endDate: d(9), requestedMinutes: 960, note: "Travel", hasDocument: false, status: "PENDING", createdAt: at(-1, "12:00") },
    { id: "lv-3", employeeId: "emp-fatima", typeId: "lt-annual", startDate: d(15), endDate: d(19), requestedMinutes: 2400, hasDocument: false, status: "APPROVED", managerDecision: { by: "emp-hamza", decision: "RECOMMEND", at: at(-5, "10:00") }, hrDecision: { by: "emp-sana", decision: "APPROVED", at: at(-4, "10:00") }, createdAt: at(-6, "10:00") },
    { id: "lv-4", employeeId: "emp-hira", typeId: "lt-sick", startDate: d(-4), endDate: d(-4), requestedMinutes: 480, note: "Medical appointment (certificate attached)", hasDocument: true, status: "PENDING", managerDecision: { by: "emp-hamza", decision: "RECOMMEND", at: at(-3, "10:00") }, createdAt: at(-3, "09:00") },
    { id: "lv-5", employeeId: "emp-zara", typeId: "lt-annual", startDate: d(22), endDate: d(22), partialMinutes: 240, requestedMinutes: 240, hasDocument: false, status: "DRAFT", createdAt: at(0, "08:00") },
  ];
  const leaveLedger: T.LeaveLedgerEntry[] = [];
  for (const e of employees.filter((x) => x.employmentStatus === "ACTIVE")) {
    leaveLedger.push({ id: `ll-${e.id}-ent`, employeeId: e.id, typeId: "lt-annual", deltaMinutes: 20 * 480, entryType: "ENTITLEMENT", effectiveDate: "2026-01-01", policyVersion: 1, note: "2026 annual entitlement" });
    leaveLedger.push({ id: `ll-${e.id}-co`, employeeId: e.id, typeId: "lt-annual", deltaMinutes: 2 * 480, entryType: "CARRYOVER", effectiveDate: "2026-01-01", policyVersion: 1, note: "Carryover from 2025" });
    leaveLedger.push({ id: `ll-${e.id}-sick`, employeeId: e.id, typeId: "lt-sick", deltaMinutes: 8 * 480, entryType: "ENTITLEMENT", effectiveDate: "2026-01-01", policyVersion: 1 });
    leaveLedger.push({ id: `ll-${e.id}-used`, employeeId: e.id, typeId: "lt-annual", deltaMinutes: -Math.round(3 + rand() * 6) * 480, entryType: "USE", effectiveDate: "2026-06-15", policyVersion: 1, note: "Leave taken earlier this year" });
  }
  leaveLedger.push({ id: "ll-usman-lv1", employeeId: "emp-usman", typeId: "lt-annual", requestId: "lv-1", deltaMinutes: -480, entryType: "USE", effectiveDate: d(-6), policyVersion: 1 });
  leaveLedger.push({ id: "ll-fatima-lv3", employeeId: "emp-fatima", typeId: "lt-annual", requestId: "lv-3", deltaMinutes: -2400, entryType: "RESERVE", effectiveDate: d(15), policyVersion: 1 });

  const overtime: T.OvertimeRequest[] = [
    { id: "ot-1", employeeId: "emp-ali", date: d(-7), taskId: "tsk-logo", requestedMinutes: 120, actualMinutes: 125, approvedMinutes: 120, reason: "Logo revision deadline", status: "PAYROLL_VALIDATED", approvalToWork: true, rateBasis: "FULL_RATE", multiplier: "1.5", unscheduled: false, createdAt: at(-8, "15:00") },
    { id: "ot-2", employeeId: "emp-usman", date: d(-2), taskId: "tsk-ep1", requestedMinutes: 0, actualMinutes: 95, reason: "Render queue ran late; stayed to verify export.", status: "FLAGGED", unscheduled: true, createdAt: at(-1, "09:00") },
    { id: "ot-3", employeeId: "emp-fatima", date: d(-4), taskId: "tsk-palette", requestedMinutes: 90, actualMinutes: 90, reason: "Contrast table rework", status: "MANAGER_RECOMMENDED", approvalToWork: true, unscheduled: false, createdAt: at(-5, "14:00") },
    { id: "ot-4", employeeId: "emp-ali", date: d(2), taskId: "tsk-guidelines", requestedMinutes: 180, reason: "Guidelines print deadline", status: "PENDING", unscheduled: false, createdAt: at(0, "10:00") },
  ];

  /* ---------------------------------------------------------------- devices & monitoring */
  const devices: T.Device[] = [
    { id: "dev-ali", employeeId: "emp-ali", hostname: "LP-WS-07", agentVersion: "1.0.3", status: "ACTIVE", enrolledAt: at(-40, "10:05"), lastSeen: nowIso, policyVersion: 3 },
    { id: "dev-fatima", employeeId: "emp-fatima", hostname: "LP-WS-08", agentVersion: "1.0.3", status: "ACTIVE", enrolledAt: at(-40, "10:30"), lastSeen: at(-1, "18:05"), policyVersion: 3 },
    { id: "dev-usman", employeeId: "emp-usman", hostname: "LP-EDIT-02", agentVersion: "1.0.2", status: "ACTIVE", enrolledAt: at(-38, "12:30"), lastSeen: at(0, "12:10"), policyVersion: 3 },
    { id: "dev-kamran", employeeId: "emp-kamran", hostname: "LP-WS-11", agentVersion: "1.0.2", status: "REVOKED", enrolledAt: at(-60, "10:00"), revokedAt: at(-14, "17:00"), lastSeen: at(-14, "16:58"), policyVersion: 2 },
    { id: "dev-hira", employeeId: "emp-hira", hostname: "LP-MO-01", agentVersion: "1.0.3", status: "PENDING", policyVersion: 3 },
  ];

  const sessions: T.TrackingSession[] = [];
  const activity: Record<string, T.ActivitySummaryRow[]> = {};
  const screenshots: T.Screenshot[] = [];
  const gaps: T.CoverageGap[] = [];
  const apps = {
    "emp-ali": ["Illustrator.exe", "InDesign.exe", "Photoshop.exe", "figma.exe", "explorer.exe"],
    "emp-fatima": ["figma.exe", "Illustrator.exe", "chrome.exe"],
    "emp-usman": ["Premiere Pro.exe", "AfterFX.exe", "Media Encoder.exe"],
  } as Record<string, string[]>;
  const domains = ["figma.com", "drive.google.com", "fonts.google.com", "unsplash.com", "portal.legacypixels.test"];
  for (const [emp, appList] of Object.entries(apps)) {
    const dev = devices.find((x) => x.employeeId === emp)!;
    for (let off = -6; off <= 0; off++) {
      const date = d(off);
      if (![1, 2, 3, 4, 5].includes(weekday(date))) continue;
      if (emp === "emp-usman" && date === leaveDay["emp-usman"]) continue;
      const live = off === 0;
      if (live && emp !== "emp-ali") continue;
      if (live && nowLocalMinutes < 9 * 60 + 15) continue;
      const id = `ses-${emp}-${off}`;
      const sh = shiftFor(emp);
      const start = zonedToUtc(date, addMin(sh.localStart, 6), TZ);
      const spanMin = live ? Math.max(20, Math.min(nowLocalMinutes - (9 * 60 + 6), 540)) : 470 + Math.round(rand() * 30);
      const idle = Math.round(spanMin * (0.06 + rand() * 0.06));
      const paused = live ? 0 : 60;
      const unknown = emp === "emp-ali" && off === -1 ? 18 : 0;
      const active = spanMin - idle - paused - unknown;
      sessions.push({
        id, employeeId: emp, deviceId: dev.id, taskId: live ? "tsk-guidelines" : undefined, state: live ? "ACTIVE" : "STOPPED",
        offline: false, startedAt: start, endedAt: live ? undefined : new Date(new Date(start).getTime() + spanMin * 60000).toISOString(),
        authorizationExpiresAt: live ? new Date(now.getTime() + 5 * 60000).toISOString() : start, policyVersion: 3,
        activeMinutes: active, idleMinutes: idle, pausedMinutes: paused, unknownMinutes: unknown,
        screenshotCount: Math.floor((active + idle) / 10), pendingUploads: live ? 1 : 0,
      });
      let remaining = active;
      activity[id] = appList.map((a, i) => {
        const share = i === appList.length - 1 ? remaining : Math.round(remaining * (0.45 - i * 0.07));
        remaining -= share;
        return { label: a, kind: "APP" as const, minutes: Math.max(share, 0) };
      });
      activity[id].push(...domains.slice(0, 3 + (off % 2 === 0 ? 1 : 0)).map((dm, i) => ({ label: dm, kind: "DOMAIN" as const, minutes: Math.round(active * (0.18 - i * 0.04)) })));
      if (emp === "emp-ali" && off >= -1) {
        const count = Math.min(Math.floor(spanMin / 10), live ? 40 : 14);
        for (let i = 0; i < count; i++) {
          const cap = new Date(new Date(start).getTime() + (i + 1) * 10 * 60000).toISOString();
          screenshots.push({
            id: `shot-${id}-${i}`, sessionId: id, employeeId: emp, captureAt: cap, monitor: "Display 1 (2560x1440)",
            suppressionReason: i === 4 ? "Excluded application in foreground (password manager)" : undefined,
            mediaId: i === 4 ? undefined : `med-shot-${id}-${i}`, restricted: off === -1 && i === 7,
          });
        }
      }
      if (emp === "emp-ali" && off === -1) {
        gaps.push({ id: "gap-1", sessionId: id, start: zonedToUtc(date, "15:12", TZ), end: zonedToUtc(date, "15:30", TZ), reason: "HEARTBEAT_TIMEOUT" });
      }
    }
  }
  const idleLabels: T.IdleLabelRequest[] = [
    { id: "idle-1", sessionId: `ses-emp-ali-${-1}`, start: at(-1, "11:00"), end: at(-1, "11:32"), label: "MEETING", note: "Design review with Zara" },
    { id: "idle-2", sessionId: `ses-emp-ali-${-1}`, start: at(-1, "16:40"), end: at(-1, "16:52") },
  ];

  /* ---------------------------------------------------------------- scores */
  const monthStart = (offsetMonths: number) => {
    const dt = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
    dt.setUTCMonth(dt.getUTCMonth() + offsetMonths);
    return dt.toISOString().slice(0, 10);
  };
  const prevStart = monthStart(-1);
  const prevEnd = addDays(monthStart(0), -1);
  const comp = (key: T.ScoreComponentKey, label: string, weight: number, num: number | null, den: number | null, value: number | null, explanation: string, provisional = false): T.ScoreComponent => ({
    key, label, weight, numerator: num, denominator: den, value, provisional, explanation, sources: [],
  });
  const mkScore = (emp: string, vals: [number | null, number | null, number | null, number | null, number | null], period: "prev" | "cur", status: T.ScoreStatus, nd: [number, number][]): T.ScoreSnapshot => {
    const [A, O, Q, D, L] = vals;
    const weights = [25, 30, 20, 15, 10];
    let w = 0;
    let cov = 0;
    vals.forEach((v, i) => {
      if (v !== null) {
        w += v * weights[i];
        cov += weights[i];
      }
    });
    const prov = period === "cur";
    return {
      id: `score-${emp}-${period}`, employeeId: emp,
      periodStart: period === "prev" ? prevStart : monthStart(0), periodEnd: period === "prev" ? prevEnd : today,
      components: [
        comp("A", "Attendance", 0.25, A === null ? null : nd[0][0], A === null ? null : nd[0][1], A, "Credited eligible presence minutes over eligible scheduled minutes, excluding approved leave and holidays.", prov),
        comp("O", "Approved output", 0.3, O === null ? null : nd[1][0], O === null ? null : nd[1][1], O, O === null ? "No committed output points in this period." : "Accepted baseline output points over committed points.", prov),
        comp("Q", "Quality", 0.2, Q === null ? null : nd[2][0], Q === null ? null : nd[2][1], Q, Q === null ? "No accepted tasks with output points." : "Points-weighted average rubric score of accepted work.", prov),
        comp("D", "Deadlines", 0.15, D === null ? null : nd[3][0], D === null ? null : nd[3][1], D, D === null ? "No output points were due." : "On-time accepted points over all due points.", prov),
        comp("L", "Work-log accuracy", 0.1, L === null ? null : nd[4][0], L === null ? null : nd[4][1], L, "Accepted reconciled logged minutes over submitted logged minutes.", prov),
      ],
      coverageWeight: cov / 100,
      weightedScore: cov ? Math.round((w / cov) * 10) / 10 : null,
      status, formulaVersion: 1, computedAt: period === "prev" ? at(-8, "02:00") : at(0, "02:00"),
    };
  };
  const scores: T.ScoreSnapshot[] = [
    mkScore("emp-ali", [90, 80, 85, 100, 95], "prev", "FINAL", [[9072, 10080], [16, 20], [1360, 16], [16, 16], [8550, 9000]]),
    mkScore("emp-fatima", [96, 100, 88.5, 81.25, 92], "prev", "DISPUTED", [[9677, 10080], [21, 21], [1858.5, 21], [13, 16], [8280, 9000]]),
    mkScore("emp-usman", [93, 72, 85, 100, 88], "prev", "FINAL", [[8928, 9600], [13, 18], [425, 5], [5, 5], [7920, 9000]]),
    mkScore("emp-hira", [91, null, null, null, 97], "prev", "FINAL", [[8736, 9600], [0, 0], [0, 0], [0, 0], [8730, 9000]]),
    mkScore("emp-zara", [98, 100, 90, 100, 99], "prev", "FINAL", [[9878, 10080], [10, 10], [900, 10], [10, 10], [8910, 9000]]),
    mkScore("emp-ali", [94, 62, 87.5, 100, 90], "cur", "PROVISIONAL", [[2256, 2400], [8, 13], [700, 8], [8, 8], [2160, 2400]]),
    mkScore("emp-fatima", [91, 50, 86, 100, 94], "cur", "PROVISIONAL", [[2184, 2400], [5, 10], [430, 5], [5, 5], [2256, 2400]]),
    mkScore("emp-usman", [88, null, null, null, 92], "cur", "PROVISIONAL", [[2112, 2400], [0, 0], [0, 0], [0, 0], [2208, 2400]]),
  ];
  scores[0].components[1].sources = [{ type: "task", id: "tsk-logo", label: "Primary logo refinement (8 pts)" }, { type: "task", id: "tsk-cat-cover", label: "Catalogue cover (3 pts)" }];
  const disputes: T.ScoreDispute[] = [
    { id: "dsp-1", snapshotId: "score-emp-fatima-prev", employeeId: "emp-fatima", component: "D", reason: "Icon set due date moved by the manager after the client changed scope; the late flag should use the revised baseline.", status: "OPEN", createdAt: at(-5, "11:00") },
  ];

  /* ---------------------------------------------------------------- compensation & payroll */
  const rates: Record<string, [T.CompensationProfile["basis"], string]> = {
    "emp-ayesha": ["MONTHLY", "300000"], "emp-bilal": ["MONTHLY", "170000"], "emp-sana": ["MONTHLY", "160000"], "emp-omar": ["MONTHLY", "140000"],
    "emp-hamza": ["MONTHLY", "220000"], "emp-zara": ["MONTHLY", "150000"], "emp-ali": ["MONTHLY", "100000"], "emp-fatima": ["MONTHLY", "110000"],
    "emp-usman": ["MONTHLY", "95000"], "emp-hira": ["HOURLY", "600"], "emp-kamran": ["MONTHLY", "70000"],
  };
  const compensation: T.CompensationProfile[] = Object.entries(rates).map(([emp, [basis, rate]]) => ({
    id: `cp-${emp}`, employeeId: emp, effectiveFrom: "2026-01-01", basis, baseRate: rate, currency: "PKR", proration: "CALENDAR_DAY", policyVersion: 1,
  }));
  compensation.push({ id: "cp-emp-ali-old", employeeId: "emp-ali", effectiveFrom: "2025-07-01", effectiveTo: "2025-12-31", basis: "MONTHLY", baseRate: "90000", currency: "PKR", proration: "CALENDAR_DAY", policyVersion: 1 });

  const label = (start: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${start}T12:00:00Z`));
  const twoAgo = monthStart(-2);
  const payrollPeriods: T.PayrollPeriod[] = [
    { id: "pp-2", label: label(twoAgo), start: twoAgo, end: addDays(prevStart, -1), timezone: TZ, currency: "PKR", state: "CLOSED" },
    { id: "pp-1", label: label(prevStart), start: prevStart, end: prevEnd, timezone: TZ, currency: "PKR", state: "OPEN" },
    { id: "pp-0", label: label(monthStart(0)), start: monthStart(0), end: addDays(monthStart(1), -1), timezone: TZ, currency: "PKR", state: "OPEN" },
  ];
  const payrollEmployees = Object.keys(rates).filter((e) => e !== "emp-kamran");
  const payrollLines: T.PayrollLine[] = [];
  const payrollRuns: T.PayrollRun[] = [];
  const payslips: T.Payslip[] = [];
  const buildRun = (runId: string, periodId: string, state: T.PayrollRunState, current: boolean) => {
    const lines: T.PayrollLine[] = payrollEmployees.map((emp) => {
      const [basis, rate] = rates[emp];
      const lineId = `${runId}-${emp}`;
      const comps: T.PayComponent[] = [];
      const c = (category: T.PayComponentCategory, description: string, amount: string, extra: Partial<T.PayComponent> = {}) =>
        comps.push({ id: `${lineId}-${comps.length}`, lineId, category, description, amount, status: "APPROVED", proposedBy: "emp-omar", approvedBy: "emp-ayesha", ...extra });
      if (basis === "HOURLY") c("BASE", "Approved payable minutes x hourly rate", String(Number(rate) * 160), { quantity: "9600 min", unitRate: rate });
      else c("BASE", "Monthly base (calendar-day proration, full period)", rate);
      if (current && emp === "emp-ali") {
        c("BONUS", "Spot bonus — brand logo delivery", "5000", { evidence: "Owner memo BON-14" });
        c("OVERTIME", "Approved overtime 120 min (OT-1, full rate x1.5)", "2500", { evidence: "ot-1", otRateBasis: "FULL_RATE" });
        c("DEDUCTION", "Salary advance recovery (signed authorization ADV-22)", "1000", { evidence: "ADV-22 signed by employee" });
      }
      if (current && emp === "emp-fatima") c("OVERTIME", "Overtime 90 min (OT-3) — pending payroll validation", "1600", { status: "PROPOSED", approvedBy: undefined, evidence: "ot-3", otRateBasis: "FULL_RATE" });
      if (current && emp === "emp-usman") c("ADJUSTMENT", "Prior-period attendance correction (linked to previous run)", "1200", { status: "PROPOSED", approvedBy: undefined, correctionOf: "run-2-emp-usman-0" });
      const totals = computeLine(comps);
      const exceptions: string[] = [];
      if (comps.some((x) => x.status === "PROPOSED")) exceptions.push("Unapproved component pending");
      if (current && emp === "emp-ayesha") exceptions.push("Owner's own payroll line requires a recorded exception");
      if (totals.negative) exceptions.push("Negative net payable");
      return {
        id: lineId, runId, employeeId: emp, compensationProfileId: `cp-${emp}`, scheduledMinutes: 10080, payableMinutes: basis === "HOURLY" ? 9600 : 10080,
        components: comps, gross: totals.gross, deductions: totals.deductions, net: totals.net, exceptions: current ? exceptions : [],
      };
    });
    payrollLines.push(...lines);
    const sum = (k: "gross" | "deductions" | "net") => lines.reduce((a, l) => a + Number(l[k]), 0).toFixed(2);
    const hash = inputHash(lines.map((l) => [l.employeeId, l.net, l.components.map((x) => [x.amount, x.status])]));
    payrollRuns.push({
      id: runId, periodId, revision: 1, state, preparedBy: "emp-omar", inputHash: hash,
      totals: { gross: sum("gross"), deductions: sum("deductions"), net: sum("net"), currency: "PKR", employees: lines.length },
      lockedAt: state === "PAID" ? at(-38, "16:00") : undefined, exportedAt: state === "PAID" ? at(-37, "10:00") : undefined,
      paidAt: state === "PAID" ? at(-36, "12:00") : undefined, paymentReference: state === "PAID" ? "BANK-BATCH-0925" : undefined,
      version: state === "PAID" ? 6 : 3,
      approvals: state === "PAID" ? [{ id: "appr-2", ownerId: "emp-ayesha", inputHash: hash, approvedAt: at(-38, "16:00"), reason: "Reviewed register and exceptions" }] : [],
      exports: state === "PAID" ? [{ id: "exp-2", at: at(-37, "10:00"), by: "emp-omar", format: "CSV", expiresAt: at(-36, "10:00") }] : [],
      createdAt: current ? at(-6, "10:00") : at(-40, "10:00"),
    });
    if (state === "PAID") {
      for (const l of lines) {
        payslips.push({
          id: `ps-${runId}-${l.employeeId}`, runId, employeeId: l.employeeId, periodLabel: payrollPeriods.find((p) => p.id === periodId)!.label, currency: "PKR",
          lines: l.components.map((x) => ({ category: x.category, description: x.description, amount: x.amount })),
          gross: l.gross, deductions: l.deductions, net: l.net, approvalId: "appr-2", publishedAt: at(-37, "10:00"),
        });
      }
    }
  };
  buildRun("run-2", "pp-2", "PAID", false);
  buildRun("run-1", "pp-1", "UNDER_REVIEW", true);

  /* ---------------------------------------------------------------- assets */
  const assetRows: [string, string, string, string, T.Asset["condition"], T.AssetState, string?][] = [
    ["LP-LAP-001", "C02XK1", "Laptop", "MacBook Pro 14 M3", "GOOD", "ASSIGNED", "emp-ali"],
    ["LP-LAP-002", "C02XK2", "Laptop", "MacBook Pro 14 M3", "GOOD", "ASSIGNED", "emp-fatima"],
    ["LP-LAP-003", "5CG31A", "Laptop", "HP ZBook Studio G10", "GOOD", "ASSIGNED", "emp-usman"],
    ["LP-LAP-004", "5CG31B", "Laptop", "HP ZBook Studio G10", "FAIR", "RETURN_REQUESTED", "emp-kamran"],
    ["LP-MON-010", "CN0K7X", "Monitor", "Dell U2723QE 27\"", "GOOD", "ASSIGNED", "emp-ali"],
    ["LP-MON-011", "CN0K7Y", "Monitor", "Dell U2723QE 27\"", "NEW", "AVAILABLE"],
    ["LP-TAB-020", "8QA1120", "Pen tablet", "Wacom Intuos Pro M", "GOOD", "ASSIGNED", "emp-zara"],
    ["LP-TAB-021", "8QA1121", "Pen tablet", "Wacom Intuos Pro M", "DAMAGED", "MAINTENANCE"],
    ["LP-CAM-030", "SN77812", "Camera", "Sony A7 IV", "GOOD", "AVAILABLE"],
    ["LP-LAP-000", "OLD0001", "Laptop", "Dell Latitude 5490", "FAIR", "RETIRED"],
  ];
  const assets: T.Asset[] = assetRows.map(([tag, serial, type, model, condition, state, emp], i) => ({
    ...base, id: `ast-${i + 1}`, assetTag: tag, serial, type, model, condition, state, assignedEmployeeId: emp, referenceDate: "2025-01-15",
  }));
  const assetAssignments: T.AssetAssignment[] = assets
    .filter((a) => a.assignedEmployeeId)
    .map((a, i) => ({
      id: `aa-${i + 1}`, assetId: a.id, employeeId: a.assignedEmployeeId!, issuedAt: at(-100 + i * 3, "10:00"), issueCondition: "Good, no visible marks",
      acknowledgedAt: a.assignedEmployeeId === "emp-usman" ? undefined : at(-100 + i * 3, "10:30"),
    }));

  /* ---------------------------------------------------------------- policies */
  const policies: T.PolicyVersion[] = [
    { id: "pol-mon-3", type: "MONITORING", version: 3, title: "Authorized activity tracking v3", summary: "Screenshots every 10 minutes during active sessions; idle threshold 5 minutes; offline continuation 15 minutes; domain-only URLs.", config: { screenshotCadenceMinutes: 10, idleThresholdMinutes: 5, offlineAllowanceMinutes: 15, leaseMinutes: 5, domainOnly: true, screenshotsEnabled: true }, effectiveFrom: d(-45), status: "APPROVED", approvedBy: "emp-ayesha", approvedAt: at(-46, "12:00") },
    { id: "pol-mon-4", type: "MONITORING", version: 4, title: "Authorized activity tracking v4 (proposed)", summary: "Reduce screenshot cadence to every 15 minutes and add Slack to the exclusion list. Requires new employee acknowledgement.", config: { screenshotCadenceMinutes: 15, idleThresholdMinutes: 5, offlineAllowanceMinutes: 15, leaseMinutes: 5, domainOnly: true, screenshotsEnabled: true }, effectiveFrom: d(14), status: "PENDING_APPROVAL" },
    { id: "pol-att-2", type: "ATTENDANCE", version: 2, title: "Attendance & shifts v2", summary: "Explicit check-in/out; grace 10 minutes; auto-close at shift end + 2h creates provisional end for review.", config: { graceMinutes: 10, autoCloseHours: 2, webCheckInAllowed: true }, effectiveFrom: "2026-01-01", status: "APPROVED", approvedBy: "emp-ayesha", approvedAt: "2025-12-20T07:00:00Z" },
    { id: "pol-leave-1", type: "LEAVE", version: 1, title: "Leave policy v1", summary: "20 days annual, 8 days sick, carryover up to 5 days; negative balances not permitted except unpaid leave.", config: { annualDays: 20, sickDays: 8, maxCarryoverDays: 5 }, effectiveFrom: "2026-01-01", status: "APPROVED", approvedBy: "emp-ayesha", approvedAt: "2025-12-20T07:00:00Z" },
    { id: "pol-ot-1", type: "OVERTIME", version: 1, title: "Overtime v1 (test-only example)", summary: "Manager recommendation, payroll validation, owner approves final payroll. Multiplier is an organization-configured example, not a statutory rate.", config: { multiplier: "1.5", requiresPreApproval: true }, effectiveFrom: "2026-01-01", status: "APPROVED", approvedBy: "emp-ayesha", approvedAt: "2025-12-20T07:00:00Z" },
    { id: "pol-comp-1", type: "COMPENSATION", version: 1, title: "Compensation & payroll v1", summary: "Calendar-day proration for monthly basis; half-up rounding to minor units; OT stored as full-rate.", config: { proration: "CALENDAR_DAY", rounding: "HALF_UP", currency: "PKR" }, effectiveFrom: "2026-01-01", status: "APPROVED", approvedBy: "emp-ayesha", approvedAt: "2025-12-20T07:00:00Z" },
    { id: "pol-score-1", type: "SCORING", version: 1, title: "Productivity scoring v1", summary: "P = 0.25A + 0.30O + 0.20Q + 0.15D + 0.10L; dispute window 7 days; coaching use only.", config: { disputeWindowDays: 7 }, effectiveFrom: "2026-01-01", status: "APPROVED", approvedBy: "emp-ayesha", approvedAt: "2025-12-20T07:00:00Z" },
    { id: "pol-ret-1", type: "RETENTION", version: 1, title: "Records retention v1 (draft)", summary: "Screenshots 30 days; raw activity 90 days; temporary exports 24 hours. Production release is blocked until approved.", config: { screenshotsDays: 30, rawEventsDays: 90, exportsHours: 24 }, effectiveFrom: d(30), status: "DRAFT" },
  ];

  /* ---------------------------------------------------------------- notifications */
  const notifications: T.Notification[] = [];
  const n = (userKey: string, kind: T.NotificationKind, title: string, body: string, href: string, dayOff: number, read = false, mandatory = false) =>
    notifications.push({ id: `ntf-${notifications.length + 1}`, userId: `usr-${userKey}`, kind, title, body, href, mandatory, readAt: read ? at(dayOff, "12:00") : undefined, createdAt: at(dayOff, "10:00") });
  n("ali", "REVIEW_APPROVED", "Primary logo refinement approved", "Zara Khan approved submission v2 (quality 87.50).", "/tasks/tsk-logo", -5, true);
  n("ali", "ASSIGNMENT", "New task: Hero illustration", "Hamza Qureshi assigned you a task due soon.", "/tasks/tsk-hero", -3);
  n("ali", "DUE_REMINDER", "Hero illustration is overdue", "The agreed due date has passed. Submit or ask your manager about the deadline.", "/tasks/tsk-hero", 0);
  n("ali", "CORRECTION", "Attendance correction received", "Your correction for a missing checkout is awaiting manager validation.", "/attendance", -2, true);
  n("ali", "POLICY_ACK", "Monitoring policy v4 proposed", "A new monitoring policy may require your acknowledgement once approved.", "/tracking", -1, false, true);
  n("fatima", "REVISION", "Revision requested: Icon set", "Zara Khan requested changes on submission v1.", "/tasks/tsk-icons", -2);
  n("zara", "ASSIGNMENT", "Review waiting: Homepage design", "Ali Hassan submitted v1.", "/reviews", -2);
  n("zara", "ASSIGNMENT", "Review waiting: Colour palette & tokens", "Fatima Noor submitted v1.", "/reviews", -1);
  n("hamza", "CORRECTION", "Correction to validate", "Ali Hassan proposed an attendance correction.", "/attendance/approvals", -2);
  n("hamza", "SYNC_FAILURE", "Agent heartbeat gap", "LP-WS-07 had an 18-minute heartbeat gap yesterday (unknown coverage).", "/tracking/team", -1);
  n("sana", "LEAVE_DECISION", "Leave awaiting HR", "Hira Aslam's sick leave was recommended by her manager.", "/leave/approvals", -3);
  n("sana", "CORRECTION", "Correction awaiting HR approval", "Fatima Noor's check-in correction was validated by her manager.", "/attendance/approvals", -3);
  n("omar", "PAYROLL_PUBLISHED", "Run under review", `${label(prevStart)} payroll run is under review with 3 exceptions.`, "/payroll", -1);
  n("ayesha", "PAYROLL_PUBLISHED", "Payroll approval pending", `${label(prevStart)} payroll is ready for owner review.`, "/payroll", -1);
  n("ayesha", "POLICY_ACK", "Policy awaiting approval", "Monitoring policy v4 requires owner approval.", "/admin/policies", -2, false, true);
  n("bilal", "SECURITY", "Device revoked", "LP-WS-11 credential revoked during offboarding.", "/admin?tab=devices", -14, true, true);

  /* ---------------------------------------------------------------- audit */
  const audit: T.AuditEvent[] = [];
  const au = (actor: string, action: string, targetType: string, targetId: string, dayOff: number, hhmm: string, reason?: string, result: T.AuditEvent["result"] = "SUCCESS") =>
    audit.push({ id: `aud-${audit.length + 1}`, actorType: "USER", actorId: `usr-${actor}`, actorLabel: people.find((p) => p.key === actor)?.name ?? actor, action, targetType, targetId, occurredAt: at(dayOff, hhmm), requestId: `req_${(audit.length + 1).toString(36).padStart(6, "0")}`, reason, result });
  au("zara", "submission.review.approve", "Submission", "sub-logo-2", -5, "10:45");
  au("zara", "submission.review.request_revision", "Submission", "sub-icons-1", -2, "12:10");
  au("hamza", "task.transition.assign", "Task", "tsk-hero", -3, "10:00");
  au("sana", "leave.approve", "LeaveRequest", "lv-3", -4, "10:00");
  au("ayesha", "monitoring.evidence.read", "Screenshot", "shot-ses-emp-ali--1-3", -1, "17:20", "Investigating heartbeat gap report");
  au("bilal", "device.revoke", "Device", "dev-kamran", -14, "17:00", "Employee suspended");
  au("bilal", "user.suspend", "User", "usr-kamran", -14, "16:55", "HR instruction #HR-31");
  au("omar", "payroll.run.submit_review", "PayrollRun", "run-1", -1, "16:00");
  au("ali", "auth.login", "Session", "usr-ali", 0, "09:01");
  au("kamran", "auth.login", "Session", "usr-kamran", -2, "09:03", "Account suspended", "DENIED");
  au("hamza", "attendance.correction.validate", "AttendanceCorrection", "cor-2", -4, "11:00");
  au("ayesha", "policy.approve", "PolicyVersion", "pol-mon-3", -46, "12:00");
  au("ayesha", "payroll.run.approve", "PayrollRun", "run-2", -38, "16:00");
  au("omar", "payroll.export", "PayrollRun", "run-2", -37, "10:00");
  au("sana", "asset.assign", "Asset", "ast-3", -90, "10:00");
  audit.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  return {
    schema: 3,
    organization, users, employees, privateProfiles, teams, roleAssignments, invitations,
    projects, tasks, taskEvents, comments, submissions, reviews, media, workLogs,
    shiftTemplates, holidays, attendanceEvents, corrections, leaveTypes, leaveRequests, leaveLedger, overtime,
    devices, sessions, activity, gaps, screenshots, idleLabels, enrollmentCodes: [],
    scores, disputes, compensation, payrollPeriods, payrollRuns, payrollLines, payslips,
    assets, assetAssignments, policies, notifications, audit,
    sim: { driveUnavailable: false, latencyMs: 150 },
  };
}
