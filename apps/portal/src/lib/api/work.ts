/** Delivery domain DTOs and the chunked upload client (spec sections 7, 18, 24). */
import type * as T from "@/lib/types";
import { api, API_MODE, ApiError, newIdempotencyKey } from "./transport";

export type TaskRow = T.Task & { projectCode: string; projectName: string; dependencyBlocked: boolean };
export type SubmissionView = T.Submission & { media: T.MediaAsset[]; previousMedia?: T.MediaAsset[] };

export interface TaskPermissions {
  isManager: boolean;
  isAssignee: boolean;
  isReviewer: boolean;
  canEdit: boolean;
  canSubmit: boolean;
  canReview: boolean;
  canComment: boolean;
  canLogWork: boolean;
  selfReviewBlocked: boolean;
  dependencyBlocked: boolean;
  transitions: string[];
}

export interface DepRef {
  id: string;
  title: string;
  state: T.TaskState;
  visible: boolean;
}

export interface TaskDetail {
  task: T.Task;
  project: Pick<T.Project, "id" | "code" | "name" | "state" | "managerId" | "memberIds">;
  events: T.TaskEvent[];
  comments: T.TaskComment[];
  submissions: SubmissionView[];
  reviews: T.ReviewDecision[];
  predecessors: DepRef[];
  successors: DepRef[];
  workLogs: T.WorkLog[];
  audit: T.AuditEvent[];
  permissions: TaskPermissions;
}

export interface TaskList extends T.Page<TaskRow> {
  total: number;
}

export interface ProjectActivity {
  id: string;
  at: string;
  actorId?: string;
  actorLabel?: string;
  kind: "task" | "project";
  taskId?: string;
  title: string;
  reason?: string;
}

export interface ProjectDetail {
  project: T.Project;
  tasks: TaskRow[];
  activity: ProjectActivity[];
  deliverables: { review: T.ReviewDecision; submission: SubmissionView; task: TaskRow }[];
  permissions: { canManage: boolean; canCreateTask: boolean; transitions: string[] };
}

export interface ReviewQueue {
  items: { task: TaskRow; submission?: SubmissionView; selfReview: boolean; priorDecisions: number }[];
  recent: { review: T.ReviewDecision; taskTitle: string; sequence: number }[];
  canSeeTeam: boolean;
}

export type WorkLogRow = T.WorkLog & { taskTitle: string };
export interface WorkLogList {
  items: WorkLogRow[];
  assignable: { id: string; title: string }[];
  canReview: boolean;
}

export const TASK_STATES: T.TaskState[] = ["DRAFT", "ASSIGNED", "IN_PROGRESS", "BLOCKED", "SUBMITTED", "REVISION_REQUESTED", "APPROVED", "COMPLETED", "CANCELLED"];
export const PRIORITIES: T.Priority[] = ["URGENT", "HIGH", "MEDIUM", "LOW"];
export const PROJECT_STATES: T.ProjectState[] = ["DRAFT", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED", "CANCELLED"];

export const TRANSITION_LABELS: Record<string, string> = {
  assign: "Assign",
  start: "Start work",
  block: "Mark blocked",
  unblock: "Unblock",
  complete: "Close as completed",
  cancel: "Cancel task",
  reopen: "Reopen for revision",
  override_dependencies: "Override dependencies",
  activate: "Activate",
  hold: "Put on hold",
  archive: "Archive",
  unarchive: "Unarchive",
};

/* ------------------------------------------------------------------ uploads */

export interface UploadProgress {
  key: string;
  name: string;
  size: number;
  state: T.MediaState | "QUEUED";
  progress: number;
  mediaId?: string;
  error?: string;
}

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/v1";

async function withRetry<X>(fn: () => Promise<X>, attempts = 4): Promise<X> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!(e instanceof ApiError) || !e.body.retryable || i === attempts - 1) throw e;
      // Exponential backoff with jitter (section 18).
      await new Promise((r) => setTimeout(r, 2 ** i * 400 + Math.random() * 250));
    }
  }
  throw last;
}

/**
 * Upload intent -> chunks -> complete. Chunks go to the application broker, never directly to Drive.
 * In mock mode no bytes leave the browser; chunk calls are coalesced to at most 6 progress steps.
 */
export async function uploadFile(
  file: File,
  ctx: { taskId: string; submissionDraftId: string; category?: T.MediaCategory },
  onUpdate: (p: Partial<UploadProgress>) => void,
): Promise<string> {
  const intent = await api.post<{ uploadId: string; mediaId: string; chunkBytes: number; expiresAt: string }>(
    "/uploads",
    { taskId: ctx.taskId, submissionDraftId: ctx.submissionDraftId, category: ctx.category ?? "PROJECT_OUTPUT", name: file.name, sizeBytes: file.size, mimeType: file.type || "application/octet-stream" },
    { idempotencyKey: newIdempotencyKey() },
  );
  onUpdate({ mediaId: intent.mediaId, state: "RECEIVING", progress: 0 });
  const step = API_MODE === "mock" ? Math.max(intent.chunkBytes, Math.ceil(file.size / 6)) : intent.chunkBytes;
  let offset = 0;
  while (offset < file.size) {
    const end = Math.min(offset + step, file.size);
    const start = offset;
    if (API_MODE === "mock") {
      await withRetry(() => api.put(`/uploads/${intent.uploadId}/chunks`, { start, end, total: file.size }));
    } else {
      await withRetry(async () => {
        const res = await fetch(`${BASE_URL}/uploads/${intent.uploadId}/chunks`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Range": `bytes ${start}-${end - 1}/${file.size}`, "Content-Type": "application/octet-stream" },
          body: file.slice(start, end),
        });
        if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({ code: "DEPENDENCY_UNAVAILABLE", message: "Upload failed", requestId: "client", retryable: true })));
      });
    }
    offset = end;
    onUpdate({ progress: offset / file.size });
  }
  const done = await api.post<{ mediaId: string; state: T.MediaState }>(`/uploads/${intent.uploadId}/complete`);
  onUpdate({ state: done.state, progress: 1 });
  return done.mediaId;
}

export const ACCEPT_HINT = "Images, PDFs, design sources, video and .zip archives up to 10 GiB. Executables and other archive types are blocked.";
