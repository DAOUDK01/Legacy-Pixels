"use client";

import Link from "next/link";
import { ArrowRight, BarChart3 } from "lucide-react";
import { useApiQuery } from "@/lib/api/hooks";
import type { REPORT_CATALOG } from "@/lib/api/admin";
import { Card, Notice, PageHeader, QueryState } from "@/components/ui";

export default function ReportsPage() {
  const q = useApiQuery<{ items: typeof REPORT_CATALOG }>("/reports");
  return (
    <>
      <PageHeader title="Reports" description="Operational delivery and workforce reports, scoped to what you're authorized to see. Every report shows its timezone, generation time, data cutoff, policy version and whether it is provisional." />
      <div className="mb-6">
        <Notice tone="slate">Revenue, sales, profitability and client financial metrics are out of scope and not reported here.</Notice>
      </div>
      <QueryState query={q} empty={(d) => d.items.length === 0} emptyTitle="No reports available">
        {(d) => {
          const groups = Array.from(new Set(d.items.map((r) => r.group)));
          return (
            <div className="space-y-8">
              {groups.map((g) => (
                <section key={g}>
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">{g}</h2>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {d.items.filter((r) => r.group === g).map((r) => (
                      <Link key={r.key} href={`/reports/${r.key}`} className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                        <Card className="h-full p-5 transition-shadow group-hover:shadow-md">
                          <div className="flex items-start gap-3">
                            <span className="rounded-md bg-brand-50 p-2 text-brand-600 dark:bg-brand-950"><BarChart3 className="h-4 w-4" /></span>
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-slate-900 dark:text-slate-100">{r.title}</p>
                              <p className="mt-1 text-sm text-slate-500">{r.description}</p>
                            </div>
                            <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-brand-600" />
                          </div>
                        </Card>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          );
        }}
      </QueryState>
    </>
  );
}
