"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail, Phone } from "lucide-react";
import { useApiQuery, useLookups } from "@/lib/api/hooks";
import type { DirectoryRow } from "@/lib/api/people";
import { ROLE_LABELS } from "@/lib/rbac";
import { Avatar, Card, Field, FilterBar, Input, PageHeader, QueryState, Select, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { StateBadge } from "@/components/domain";
import { InviteButton } from "@/components/people/InviteButton";

export default function DirectoryPage() {
  const [q, setQ] = useState("");
  const [team, setTeam] = useState("");
  const [status, setStatus] = useState("");
  const lookups = useLookups();
  const query = useApiQuery<{ items: DirectoryRow[] }>("/employees", { q, team, status });

  return (
    <>
      <PageHeader title="Directory" description="Employees you're permitted to see, with work contact details. Private HR records and pay are behind separate permissions." actions={<InviteButton />} />
      <Card>
        <FilterBar>
          <Field label="Search" htmlFor="dir-q" className="w-full sm:w-64">
            <Input id="dir-q" type="search" placeholder="Name, code, title, email" value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
          <Field label="Team" htmlFor="dir-team" className="w-40">
            <Select id="dir-team" value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">All teams</option>
              {lookups.data?.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Status" htmlFor="dir-status" className="w-40">
            <Select id="dir-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any status</option>
              {["ACTIVE", "INVITED", "SUSPENDED", "OFFBOARDED"].map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
            </Select>
          </Field>
        </FilterBar>
        <QueryState query={query} empty={(d) => d.items.length === 0} emptyTitle="No matching people" emptyDescription="Try a different search or filter.">
          {(d) => (
            <>
              <div className="hidden md:block">
                <Table>
                  <THead>
                    <tr><TH>Name</TH><TH>Code</TH><TH>Team</TH><TH>Role</TH><TH>Manager</TH><TH>Status</TH><TH>Work contact</TH></tr>
                  </THead>
                  <TBody>
                    {d.items.map((e) => (
                      <TR key={e.id}>
                        <TD>
                          <Link href={`/people/${e.id}`} className="flex items-center gap-3 hover:underline">
                            <Avatar name={e.displayName} color={e.avatarColor} />
                            <span><span className="block font-medium text-slate-900 dark:text-slate-100">{e.displayName}</span><span className="block text-xs text-slate-500">{e.title}</span></span>
                          </Link>
                        </TD>
                        <TD className="font-mono text-xs">{e.employeeCode}</TD>
                        <TD>{e.teamName ?? "—"}</TD>
                        <TD className="text-xs">{e.roles.filter((r) => r !== "EMPLOYEE").map((r) => ROLE_LABELS[r]).join(", ") || "Employee"}</TD>
                        <TD>{e.managerName ?? "—"}</TD>
                        <TD><StateBadge state={e.employmentStatus} /></TD>
                        <TD className="text-xs">
                          <a className="block hover:underline" href={`mailto:${e.workEmail}`}>{e.workEmail}</a>
                          {e.workPhone && <span className="text-slate-500">{e.workPhone}</span>}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
              <ul className="grid gap-3 p-4 sm:grid-cols-2 md:hidden">
                {d.items.map((e) => (
                  <li key={e.id}>
                    <Link href={`/people/${e.id}`} className="block rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                      <div className="flex items-center gap-3">
                        <Avatar name={e.displayName} color={e.avatarColor} size={40} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{e.displayName}</p>
                          <p className="truncate text-xs text-slate-500">{e.title} · {e.teamName ?? "No team"}</p>
                        </div>
                        <StateBadge state={e.employmentStatus} />
                      </div>
                      <p className="mt-3 flex items-center gap-1.5 truncate text-xs text-slate-600"><Mail className="h-3.5 w-3.5" />{e.workEmail}</p>
                      {e.workPhone && <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-600"><Phone className="h-3.5 w-3.5" />{e.workPhone}</p>}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </QueryState>
      </Card>
    </>
  );
}
