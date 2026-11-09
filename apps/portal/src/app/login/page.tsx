"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Hexagon, KeyRound, Lock, RotateCcw, ShieldCheck } from "lucide-react";
import { api, API_MODE, errorMessage } from "@/lib/api/transport";
import { useApiQuery } from "@/lib/api/hooks";
import { Avatar, Badge, Button, InlineError, Notice } from "@/components/ui";
import type { Persona } from "@/mock/handlers/identity";

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const personas = useApiQuery<Persona[]>(API_MODE === "mock" ? "/auth/personas" : null);
  const next = params.get("next") && params.get("next")!.startsWith("/") ? params.get("next")! : "/";
  const reason = params.get("reason");

  const signIn = async (userId: string) => {
    setBusy(userId);
    setError(null);
    try {
      await api.post("/auth/login", { userId });
      qc.clear();
      router.replace(next);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <section className="relative hidden flex-1 overflow-hidden bg-gradient-to-br from-brand-700 via-brand-800 to-violet-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15"><Hexagon className="h-5 w-5" /></span>
          <span className="text-lg font-semibold">Legacy Pixels</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight">One place for assigned work, reviewed deliverables, attendance and pay.</h1>
          <p className="mt-4 text-white/80">Tracking is transparent and employee-visible. You can always see what's collected, pause it, and dispute anything that looks wrong.</p>
        </div>
        <ul className="space-y-2 text-sm text-white/80">
          <li className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> MFA required for owner, admin, HR and payroll roles</li>
          <li className="flex items-center gap-2"><Lock className="h-4 w-4" /> Sessions expire after 30 minutes idle or 12 hours</li>
        </ul>
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -right-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
      </section>

      <section className="flex flex-1 items-center justify-center bg-white px-4 py-10 dark:bg-slate-950 sm:px-8">
        <div className="w-full max-w-lg">
          <div className="mb-8 lg:hidden">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white"><Hexagon className="h-5 w-5" /></span>
          </div>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white">Sign in</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Use your Legacy Pixels Google Workspace account.</p>

          {reason === "idle" && <div className="mt-4"><Notice tone="amber">You were signed out after 30 minutes of inactivity.</Notice></div>}
          {error && <div className="mt-4"><InlineError message={error} /></div>}

          {API_MODE === "http" ? (
            <a href={`${process.env.NEXT_PUBLIC_API_BASE_URL ?? "/v1"}/auth/oidc/start?next=${encodeURIComponent(next)}`} className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50">
              <KeyRound className="h-4 w-4" /> Continue with Google Workspace
            </a>
          ) : (
            <>
              <div className="mt-6">
                <Notice tone="blue" title="Demo sign-in">
                  The identity provider is simulated. Pick a person to see the portal with their role and permissions.
                </Notice>
              </div>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {personas.data?.map((p) => (
                  <li key={p.userId}>
                    <button
                      onClick={() => signIn(p.userId)}
                      disabled={!!busy}
                      className="flex w-full items-center gap-3 rounded-lg border border-slate-200 p-3 text-left transition hover:border-brand-400 hover:bg-brand-50/50 disabled:opacity-60 dark:border-slate-800 dark:hover:bg-slate-900"
                    >
                      <Avatar name={p.name} color={p.color} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">{p.name}</span>
                        <span className="block truncate text-xs text-slate-500">{p.roles.filter((r) => r !== "Employee").join(", ") || "Employee"}</span>
                      </span>
                      {busy === p.userId ? <span className="text-xs text-slate-500">…</span> : p.mfa ? <Badge tone="green">MFA</Badge> : null}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                onClick={async () => {
                  await api.post("/_mock/reset");
                  qc.clear();
                  personas.refetch();
                }}
                className="mt-6 inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset demo data
              </button>
            </>
          )}
          <p className="mt-8 text-xs text-slate-500">
            By signing in you acknowledge the <a className="underline" href="/privacy">workforce privacy notice</a>. Monitoring only happens during sessions you start in the desktop agent.
          </p>
          {!personas.data && API_MODE === "mock" && <Button className="mt-4" variant="ghost" loading>Loading</Button>}
        </div>
      </section>
    </div>
  );
}
