"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bell, ChevronDown, Globe2, LogOut, Menu, Moon, Search, ShieldCheck, Sun, UserRound, WifiOff, X, Hexagon,
} from "lucide-react";
import { useApiQuery, useMe } from "@/lib/api/hooks";
import { api, API_MODE } from "@/lib/api/transport";
import { ROLE_LABELS } from "@/lib/rbac";
import type { Me, Notification } from "@/lib/types";
import { relativeTime } from "@/lib/time";
import { Avatar, Button, Kbd, LoadingState, cn } from "@/components/ui";
import { visibleNav } from "./nav";

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    if (me.error?.code === "AUTH_REQUIRED") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [me.error, router, pathname]);

  if (me.isLoading || !me.data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-80"><LoadingState rows={3} /></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:shadow">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:block">
        <Sidebar me={me.data} />
      </aside>
      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl dark:bg-slate-900">
            <button aria-label="Close navigation" className="absolute right-3 top-4 rounded p-1 text-slate-500" onClick={() => setMobileOpen(false)}>
              <X className="h-5 w-5" />
            </button>
            <Sidebar me={me.data} />
          </aside>
        </div>
      )}
      <div className="lg:pl-64">
        <Topbar me={me.data} onMenu={() => setMobileOpen(true)} />
        <ConnectivityBanner />
        <main id="main" className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
      <IdleTimeout />
    </div>
  );
}

function Sidebar({ me }: { me: Me }) {
  const pathname = usePathname();
  const groups = visibleNav(me);
  return (
    <div className="flex h-full flex-col">
      <Link href="/" className="flex h-16 items-center gap-2.5 border-b border-slate-100 px-5 dark:border-slate-800">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-600 text-white">
          <Hexagon className="h-4 w-4" />
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-semibold text-slate-900 dark:text-white">Legacy Pixels</span>
          <span className="block text-[11px] text-slate-500">Workforce Portal</span>
        </span>
      </Link>
      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 py-4">
        {groups.map((g) => (
          <div key={g.label} className="mb-5">
            <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.label}</p>
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors",
                        active ? "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-200" : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
                      )}
                    >
                      <Icon className={cn("h-4 w-4", active ? "text-brand-600 dark:text-brand-300" : "text-slate-400")} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      {API_MODE === "mock" && (
        <div className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-500 dark:border-slate-800">
          Demo mode — data is simulated in your browser.
        </div>
      )}
    </div>
  );
}

function Topbar({ me, onMenu }: { me: Me; onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 sm:px-6">
      <button aria-label="Open navigation" onClick={onMenu} className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden">
        <Menu className="h-5 w-5" />
      </button>
      <GlobalSearch />
      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <span className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-500 md:flex" title="Organization timezone">
          <Globe2 className="h-3.5 w-3.5" />
          {me.organization.timezone}
        </span>
        <ThemeToggle />
        <NotificationsMenu />
        <UserMenu me={me} />
      </div>
    </header>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const results = useApiQuery<{ results: { type: string; id: string; title: string; subtitle: string; href: string }[] }>(
    debounced.length >= 2 ? "/search" : null,
    { q: debounced },
  );
  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        type="search"
        aria-label="Search projects, tasks and people"
        placeholder="Search projects, tasks, people…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-14 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
      />
      <span className="absolute right-2 top-1/2 hidden -translate-y-1/2 sm:block"><Kbd>Ctrl K</Kbd></span>
      {open && debounced.length >= 2 && (
        <div className="absolute left-0 right-0 top-11 z-30 max-h-96 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {results.isLoading && <p className="px-3 py-2 text-sm text-slate-500">Searching…</p>}
          {results.data?.results.length === 0 && <p className="px-3 py-2 text-sm text-slate-500">No visible matches.</p>}
          {results.data?.results.map((r) => (
            <button
              key={`${r.type}-${r.id}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false);
                setQ("");
                router.push(r.href);
              }}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <span className="w-14 shrink-0 text-[10px] font-semibold uppercase text-slate-400">{r.type}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-slate-900 dark:text-slate-100">{r.title}</span>
                <span className="block truncate text-xs text-slate-500">{r.subtitle}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  return (
    <button
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.classList.toggle("dark", next);
        try {
          localStorage.setItem("lp.theme", next ? "dark" : "light");
        } catch {}
      }}
      className="rounded-md p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
    >
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}

function useClickOutside(onOut: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOut();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onOut]);
  return ref;
}

function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  const router = useRouter();
  const qc = useQueryClient();
  const q = useApiQuery<{ items: Notification[]; unread: number }>("/notifications", undefined, { refetchInterval: 30_000 });
  const markRead = async (id: string) => {
    await api.post(`/notifications/${id}/read`);
    qc.invalidateQueries({ queryKey: ["/notifications"] });
  };
  return (
    <div className="relative" ref={ref}>
      <button aria-label={`Notifications${q.data?.unread ? `, ${q.data.unread} unread` : ""}`} aria-expanded={open} onClick={() => setOpen((v) => !v)} className="relative rounded-md p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
        <Bell className="h-5 w-5" />
        {!!q.data?.unread && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">{q.data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-30 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
            <p className="text-sm font-semibold">Notifications</p>
            <Link href="/notifications" onClick={() => setOpen(false)} className="text-xs font-medium text-brand-600 hover:underline">View all</Link>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {q.data?.items.slice(0, 8).map((n) => (
              <li key={n.id}>
                <button
                  onClick={async () => {
                    setOpen(false);
                    await markRead(n.id);
                    if (n.href) router.push(n.href);
                  }}
                  className={cn("flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800", !n.readAt && "bg-brand-50/50 dark:bg-brand-950/30")}
                >
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-brand-600")} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                      {n.mandatory && <ShieldCheck className="h-3.5 w-3.5 text-amber-600" aria-label="Mandatory notice" />}
                      {n.title}
                    </span>
                    <span className="block text-xs text-slate-600 dark:text-slate-400">{n.body}</span>
                    <span className="mt-0.5 block text-[11px] text-slate-400">{relativeTime(n.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
            {q.data?.items.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">You're all caught up.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function UserMenu({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  const qc = useQueryClient();
  const router = useRouter();
  const name = me.employee?.displayName ?? me.user.email;
  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      qc.clear();
      router.replace("/login");
    }
  };
  return (
    <div className="relative" ref={ref}>
      <button aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 hover:bg-slate-100 dark:hover:bg-slate-800">
        <Avatar name={name} color={me.employee?.avatarColor} size={30} />
        <span className="hidden text-left leading-tight md:block">
          <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">{name}</span>
          <span className="block text-[11px] text-slate-500">{me.roles.filter((r) => r !== "EMPLOYEE").map((r) => ROLE_LABELS[r]).join(", ") || "Employee"}</span>
        </span>
        <ChevronDown className="hidden h-4 w-4 text-slate-400 md:block" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-12 z-30 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-xs text-slate-500">{me.user.email}</p>
            <p className="mt-1 text-[11px] text-slate-400">Session ends {relativeTime(me.sessionExpiresAt)}{me.user.mfaEnrolled ? " · MFA" : ""}</p>
          </div>
          {me.employee && (
            <Link role="menuitem" href={`/people/${me.employee.id}`} onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
              <UserRound className="h-4 w-4 text-slate-400" /> My profile
            </Link>
          )}
          <Link role="menuitem" href="/notifications" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
            <Bell className="h-4 w-4 text-slate-400" /> Notifications
          </Link>
          <button role="menuitem" onClick={logout} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-700 hover:bg-red-50 dark:hover:bg-red-950">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function ConnectivityBanner() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  if (online) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <WifiOff className="h-4 w-4" /> You're offline. Data shown may be out of date and changes can't be saved until you reconnect.
    </div>
  );
}

/** Warns at 28 minutes of inactivity; the server expires the session at 30 (section 4). */
function IdleTimeout() {
  const [warn, setWarn] = useState(false);
  const last = useRef(Date.now());
  const router = useRouter();
  useEffect(() => {
    const bump = () => {
      last.current = Date.now();
      setWarn(false);
    };
    const events = ["mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => {
      const idle = Date.now() - last.current;
      if (idle > 30 * 60_000) router.replace("/login?reason=idle");
      else if (idle > 28 * 60_000) setWarn(true);
    }, 15_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(t);
    };
  }, [router]);
  if (!warn) return null;
  return (
    <div role="alertdialog" aria-live="assertive" className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-amber-300 bg-white px-4 py-3 shadow-lg dark:bg-slate-900">
      <p className="text-sm">You'll be signed out soon due to inactivity.</p>
      <Button size="sm" onClick={() => setWarn(false)}>Stay signed in</Button>
    </div>
  );
}
