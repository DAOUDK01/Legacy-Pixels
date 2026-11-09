"use client";

import { useMutation, useQuery, useQueryClient, type QueryKey, type UseQueryOptions } from "@tanstack/react-query";
import { api, ApiError, newIdempotencyKey, request, type HttpMethod, type RequestOptions } from "./transport";
import type { Me, Employee, LeaveType, Holiday, ProjectState } from "@/lib/types";

/** GET a path; the query key is [path, query]. */
export function useApiQuery<T>(
  path: string | null,
  query?: RequestOptions["query"],
  options: Omit<UseQueryOptions<T, ApiError>, "queryKey" | "queryFn"> = {},
) {
  return useQuery<T, ApiError>({
    queryKey: [path, query ?? {}],
    queryFn: () => api.get<T>(path!, query),
    enabled: path !== null && (options.enabled ?? true),
    ...options,
  });
}

export interface MutationVars {
  body?: unknown;
  ifMatch?: number;
  path?: string; // override path per call
}

/**
 * Mutation with a stable Idempotency-Key per attempt (retries of the same attempt reuse it)
 * and invalidation of affected query prefixes after commit.
 */
export function useApiMutation<T = unknown>(
  method: HttpMethod,
  path: string,
  opts: { invalidate?: string[]; onSuccess?: (data: T) => void } = {},
) {
  const qc = useQueryClient();
  return useMutation<T, ApiError, MutationVars | void>({
    mutationFn: async (vars) => {
      const v = (vars ?? {}) as MutationVars;
      return request<T>(method, v.path ?? path, { body: v.body, ifMatch: v.ifMatch, idempotencyKey: newIdempotencyKey() });
    },
    onSuccess: async (data) => {
      const prefixes = opts.invalidate ?? [];
      await qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return typeof k === "string" && (prefixes.length === 0 || prefixes.some((p) => k.startsWith(p)));
        },
      });
      opts.onSuccess?.(data);
    },
  });
}

export function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries();
}

export const ME_KEY: QueryKey = ["/me", {}];

export function useMe() {
  return useQuery<Me, ApiError>({ queryKey: ME_KEY, queryFn: () => api.get<Me>("/me"), retry: false, staleTime: 60_000 });
}

export interface Lookups {
  employees: Pick<Employee, "id" | "displayName" | "title" | "teamId" | "employmentStatus" | "avatarColor" | "employeeCode">[];
  teams: { id: string; name: string }[];
  projects: { id: string; code: string; name: string; state: ProjectState }[];
  leaveTypes: LeaveType[];
  holidays: Holiday[];
}

export function useLookups() {
  return useApiQuery<Lookups>("/lookups", undefined, { staleTime: 60_000 });
}

/** Resolve an employee name from lookups. */
export function useEmployeeName() {
  const { data } = useLookups();
  return (id?: string) => (id ? data?.employees.find((e) => e.id === id)?.displayName ?? "Restricted" : "—");
}
