"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleDashed, HardDrive, Plus, RotateCcw, ServerCrash, ShieldCheck, XCircle } from "lucide-react";
import { useApiMutation, useApiQuery, useLookups, useMe } from "@/lib/api/hooks";
import { api } from "@/lib/api/transport";
import type { AgentVersionsDto, ChecklistDto, MediaHealthDto, RetentionDto } from "@/lib/api/admin";
import { can, PRIVILEGED_ROLES, ROLE_LABELS } from "@/lib/rbac";
import type { Invitation, Organization, PolicyType, PolicyVersion, RoleAssignment, RoleKey, ScopeType, Team, User } from "@/lib/types";
import { fmtBytes, fmtDate, fmtDateTime, relativeTime } from "@/lib/time";
import {
  Badge, Button, Card, CardBody, CardHeader, Checkbox, ConfirmDialog, DL, Dialog, Field, InlineError, Input, Notice,
  Progress, QueryState, Select, Stat, Table, TBody, TD, TH, THead, TR, Textarea, cn,
} from "@/components/ui";
import { Person, StateBadge, humanize } from "@/components/domain";
import { useToast } from "@/components/ui/toast";
import { InviteDialog } from "@/components/people/InviteButton";

/* ------------------------------------------------------------------ Organization */

export function OrganizationPanel() {
  const q = useApiQuery<Organization & { canEdit: boolean }>("/admin/organization");
  const toast = useToast();
  const [f, setF] = useState({ name: "", timezone: "", payrollCurrency: "" });
  useEffect(() => {
    if (q.data) setF({ name: q.data.name, timezone: q.data.timezone, payrollCurrency: q.data.payrollCurrency });
  }, [q.data]);
  const m = useApiMutation("PATCH", "/admin/organization", { invalidate: ["/admin", "/me"], onSuccess: () => toast({ tone: "success", title: "Organization settings saved" }) });
  const fe = m.error?.body.fieldErrors ?? {};
  return (
    <Card>
      <CardHeader title="Organization" description="Timestamps are stored in UTC; business dates and displays use this timezone." />
      <QueryState query={q}>
        {(o) => (
          <form className="grid max-w-2xl gap-4 px-5 py-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); m.mutate({ body: f }); }}>
            <Field label="Organization name" htmlFor="org-name" error={fe.name} className="sm:col-span-2"><Input id="org-name" disabled={!o.canEdit} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Timezone (IANA)" htmlFor="org-tz" error={fe.timezone} hint="Default Asia/Karachi"><Input id="org-tz" disabled={!o.canEdit} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></Field>
            <Field label="Payroll currency" htmlFor="org-cur" error={fe.payrollCurrency} hint="ISO 4217 code"><Input id="org-cur" disabled={!o.canEdit} value={f.payrollCurrency} maxLength={3} onChange={(e) => setF({ ...f, payrollCurrency: e.target.value.toUpperCase() })} /></Field>
            <DL items={[{ label: "Status", value: <StateBadge state={o.status} /> }, { label: "Active monitoring policy", value: `v${o.activePolicyVersion}` }]} />
            {m.error && !Object.keys(fe).length && <div className="sm:col-span-2"><InlineError message={m.error.body.message} /></div>}
            {o.canEdit && <div className="sm:col-span-2"><Button type="submit" loading={m.isPending}>Save changes</Button></div>}
          </form>
        )}
      </QueryState>
    </Card>
  );
}

/* ------------------------------------------------------------------ Teams */

export function TeamsPanel() {
  const q = useApiQuery<{ items: (Team & { managerName?: string })[] }>("/teams");
  const lookups = useLookups();
  const [editing, setEditing] = useState<(Team & { managerName?: string }) | "new" | null>(null);
  return (
    <Card>
      <CardHeader title="Teams" description="Managers see projects, workload and attendance for the teams they manage." actions={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>New team</Button>} />
      <QueryState query={q} empty={(d) => d.items.length === 0} emptyTitle="No teams yet">
        {(d) => (
          <Table>
            <THead><tr><TH>Team</TH><TH>Manager</TH><TH>Members</TH><TH /></tr></THead>
            <TBody>
              {d.items.map((t) => (
                <TR key={t.id}>
                  <TD className="font-medium">{t.name}</TD>
                  <TD>{t.managerEmployeeId ? <Person id={t.managerEmployeeId} /> : "—"}</TD>
                  <TD className="text-xs">{t.memberIds.map((m) => lookups.data?.employees.find((e) => e.id === m)?.displayName ?? "Restricted").join(", ") || "—"}</TD>
                  <TD className="text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(t)}>Edit</Button></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </QueryState>
      {editing && <TeamDialog team={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function TeamDialog({ team, onClose }: { team: Team | null; onClose: () => void }) {
  const lookups = useLookups();
  const toast = useToast();
  const [name, setName] = useState(team?.name ?? "");
  const [manager, setManager] = useState(team?.managerEmployeeId ?? "");
  const [members, setMembers] = useState<string[]>(team?.memberIds ?? []);
  const create = useApiMutation("POST", "/teams", { invalidate: ["/teams", "/lookups"], onSuccess: () => { toast({ tone: "success", title: "Team created" }); onClose(); } });
  const update = useApiMutation("PATCH", `/teams/${team?.id}`, { invalidate: ["/teams", "/lookups"], onSuccess: () => { toast({ tone: "success", title: "Team updated" }); onClose(); } });
  const m = team ? update : create;
  const active = lookups.data?.employees.filter((e) => e.employmentStatus !== "OFFBOARDED") ?? [];
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={team ? `Edit ${team.name}` : "New team"}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => (team ? update.mutate({ body: { name, managerEmployeeId: manager, memberIds: members }, ifMatch: team.version }) : create.mutate({ body: { name, managerEmployeeId: manager } }))}>Save</Button></>}
    >
      <div className="space-y-4">
        <Field label="Name" htmlFor="tm-name" required error={m.error?.body.fieldErrors?.name}><Input id="tm-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Manager" htmlFor="tm-mgr">
          <Select id="tm-mgr" value={manager} onChange={(e) => setManager(e.target.value)}><option value="">None</option>{active.map((e) => <option key={e.id} value={e.id}>{e.displayName}</option>)}</Select>
        </Field>
        {team && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Members</legend>
            <div className="grid max-h-60 gap-2 overflow-y-auto sm:grid-cols-2">
              {active.map((e) => (
                <Checkbox key={e.id} label={e.displayName} description={e.title} checked={members.includes(e.id)} onChange={(v) => setMembers(v ? [...members, e.id] : members.filter((x) => x !== e.id))} />
              ))}
            </div>
          </fieldset>
        )}
        {m.error && !m.error.body.fieldErrors?.name && <InlineError message={m.error.body.message} />}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ Roles & invitations */

type RA = RoleAssignment & { userName: string; scopeName?: string };

export function RolesPanel() {
  const me = useMe();
  const ras = useApiQuery<{ items: RA[] }>(can(me.data, "role.assign") ? "/role-assignments" : null);
  const invs = useApiQuery<{ items: Invitation[] }>(can(me.data, "user.invite") ? "/invitations" : null);
  const users = useApiQuery<{ items: (User & { name: string; roles: RoleKey[] })[] }>(can(me.data, "role.assign") ? "/users" : null);
  const toast = useToast();
  const [assigning, setAssigning] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [ending, setEnding] = useState<RA | null>(null);
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const [deactivating, setDeactivating] = useState<{ id: string; name: string } | null>(null);
  const end = useApiMutation("POST", "/role-assignments/x/end", { invalidate: ["/role-assignments", "/users"], onSuccess: () => { toast({ tone: "success", title: "Role ended" }); setEnding(null); } });
  const revoke = useApiMutation("POST", "/invitations/x/revoke", { invalidate: ["/invitations"], onSuccess: () => { toast({ tone: "success", title: "Invitation revoked" }); setRevoking(null); } });
  const deact = useApiMutation("POST", "/users/x/deactivate", { invalidate: ["/users", "/employees", "/lookups"], onSuccess: () => { toast({ tone: "success", title: "Account deactivated", body: "Sessions and device keys were revoked." }); setDeactivating(null); } });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      {can(me.data, "role.assign") && (
        <Card>
          <CardHeader title="Role assignments" description="Effective-dated grants. Only the owner assigns owner, administrator, HR and payroll roles. Every change is audited." actions={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAssigning(true)}>Assign role</Button>} />
          <QueryState query={ras}>
            {(d) => (
              <Table>
                <THead><tr><TH>Person</TH><TH>Role</TH><TH>Scope</TH><TH>Valid from</TH><TH>Valid to</TH><TH /></tr></THead>
                <TBody>
                  {d.items.map((r) => {
                    const ended = !!r.validTo && r.validTo < today;
                    return (
                      <TR key={r.id} className={ended ? "opacity-50" : ""}>
                        <TD>{r.userName}</TD>
                        <TD><Badge tone={PRIVILEGED_ROLES.includes(r.role) ? "purple" : "slate"}>{ROLE_LABELS[r.role]}</Badge></TD>
                        <TD className="text-xs">{r.scopeType}{r.scopeName ? `: ${r.scopeName}` : ""}</TD>
                        <TD className="text-xs">{fmtDate(r.validFrom)}</TD>
                        <TD className="text-xs">{r.validTo ? fmtDate(r.validTo) : "Open-ended"}</TD>
                        <TD className="text-right">{!ended && <Button size="sm" variant="ghost" onClick={() => setEnding(r)}>End</Button>}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </QueryState>
        </Card>
      )}
      {can(me.data, "user.invite") && (
        <Card>
          <CardHeader title="Invitations" description="Expired or reused links fail. Accounts link by identity-provider subject, not email alone." actions={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setInviting(true)}>Invite</Button>} />
          <QueryState query={invs} empty={(d) => d.items.length === 0} emptyTitle="No invitations">
            {(d) => (
              <Table>
                <THead><tr><TH>Email</TH><TH>Role</TH><TH>Status</TH><TH>Expires</TH><TH /></tr></THead>
                <TBody>
                  {d.items.map((i) => (
                    <TR key={i.id}>
                      <TD>{i.email}</TD>
                      <TD>{ROLE_LABELS[i.role]}</TD>
                      <TD><StateBadge state={i.status} /></TD>
                      <TD className="text-xs">{relativeTime(i.expiresAt)}</TD>
                      <TD className="text-right">{i.status === "PENDING" && <Button size="sm" variant="ghost" onClick={() => setRevoking(i)}>Revoke</Button>}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </QueryState>
        </Card>
      )}
      {can(me.data, "role.assign") && (
        <Card>
          <CardHeader title="Accounts" description="Deactivation revokes portal sessions, refresh tokens and device keys immediately and preserves historical attribution." />
          <QueryState query={users}>
            {(d) => (
              <Table>
                <THead><tr><TH>Account</TH><TH>Status</TH><TH>MFA</TH><TH>Last sign-in</TH><TH /></tr></THead>
                <TBody>
                  {d.items.map((u) => (
                    <TR key={u.id}>
                      <TD>{u.name}<span className="block text-xs text-slate-500">{u.email}</span></TD>
                      <TD><StateBadge state={u.status} /></TD>
                      <TD>{u.mfaEnrolled ? <Badge tone="green">Enrolled</Badge> : u.roles.some((r) => PRIVILEGED_ROLES.includes(r)) ? <Badge tone="red">Required</Badge> : <span className="text-xs text-slate-400">Not required</span>}</TD>
                      <TD className="text-xs">{u.lastLogin ? relativeTime(u.lastLogin) : "—"}</TD>
                      <TD className="text-right">{u.status === "ACTIVE" && u.id !== me.data?.user.id && !u.roles.includes("OWNER") && can(me.data, "user.deactivate") && <Button size="sm" variant="ghost" onClick={() => setDeactivating({ id: u.id, name: u.name })}>Deactivate</Button>}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </QueryState>
        </Card>
      )}
      {assigning && <AssignRoleDialog onClose={() => setAssigning(false)} />}
      <InviteDialog open={inviting} onClose={() => setInviting(false)} />
      <ConfirmDialog open={!!ending} onClose={() => { setEnding(null); end.reset(); }} title={`End ${ending ? ROLE_LABELS[ending.role] : ""} role for ${ending?.userName}?`} description="The grant ends today. Cached tokens are denied on the next request." tone="danger" confirmLabel="End role" requireReason loading={end.isPending} error={end.error?.body.message} onConfirm={(reason) => end.mutate({ path: `/role-assignments/${ending!.id}/end`, body: { reason } })} />
      <ConfirmDialog open={!!revoking} onClose={() => { setRevoking(null); revoke.reset(); }} title={`Revoke invitation for ${revoking?.email}?`} tone="danger" confirmLabel="Revoke" requireReason loading={revoke.isPending} error={revoke.error?.body.message} onConfirm={(reason) => revoke.mutate({ path: `/invitations/${revoking!.id}/revoke`, body: { reason } })} />
      <ConfirmDialog open={!!deactivating} onClose={() => { setDeactivating(null); deact.reset(); }} title={`Deactivate ${deactivating?.name}?`} description="Revokes sessions and device keys and stops tracking. Submissions and payroll records are kept. Direct Drive access must be removed and verified separately." tone="danger" confirmLabel="Deactivate" requireReason loading={deact.isPending} error={deact.error?.body.message} onConfirm={(reason) => deact.mutate({ path: `/users/${deactivating!.id}/deactivate`, body: { reason } })} />
    </div>
  );
}

function AssignRoleDialog({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const users = useApiQuery<{ items: (User & { name: string })[] }>("/users");
  const lookups = useLookups();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ userId: "", role: "REVIEWER" as RoleKey, scopeType: "project" as ScopeType, scopeId: "", validFrom: today, validTo: "", reason: "" });
  const m = useApiMutation("POST", "/role-assignments", { invalidate: ["/role-assignments", "/users"], onSuccess: () => { toast({ tone: "success", title: "Role assigned" }); onClose(); } });
  const fe = m.error?.body.fieldErrors ?? {};
  const isOwner = me.data?.roles.includes("OWNER");
  const roles = (Object.keys(ROLE_LABELS) as RoleKey[]).filter((r) => isOwner || !PRIVILEGED_ROLES.includes(r));
  const scopeOptions = f.scopeType === "team" ? lookups.data?.teams.map((t) => ({ id: t.id, label: t.name })) : f.scopeType === "project" ? lookups.data?.projects.map((p) => ({ id: p.id, label: `${p.code} — ${p.name}` })) : [];
  return (
    <Dialog open onClose={onClose} size="lg" title="Assign role" description="Grants combine role permissions with scope. Screenshot and compensation access are separate capabilities." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate({ body: { ...f, scopeId: f.scopeId || undefined, validTo: f.validTo || undefined } })}>Assign</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Person" htmlFor="ra-user" required error={fe.userId} className="sm:col-span-2">
          <Select id="ra-user" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}><option value="">Choose…</option>{users.data?.items.filter((u) => u.status === "ACTIVE").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
        </Field>
        <Field label="Role" htmlFor="ra-role" required error={fe.role}>
          <Select id="ra-role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as RoleKey })}>{roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select>
        </Field>
        <Field label="Scope" htmlFor="ra-scope">
          <Select id="ra-scope" value={f.scopeType} onChange={(e) => setF({ ...f, scopeType: e.target.value as ScopeType, scopeId: "" })}>
            {["organization", "team", "project", "self"].map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        {(f.scopeType === "team" || f.scopeType === "project") && (
          <Field label={f.scopeType === "team" ? "Team" : "Project"} htmlFor="ra-scope-id" required error={fe.scopeId} className="sm:col-span-2">
            <Select id="ra-scope-id" value={f.scopeId} onChange={(e) => setF({ ...f, scopeId: e.target.value })}><option value="">Choose…</option>{scopeOptions?.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
          </Field>
        )}
        <Field label="Valid from" htmlFor="ra-from" required error={fe.validFrom}><Input id="ra-from" type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} /></Field>
        <Field label="Valid to" htmlFor="ra-to" error={fe.validTo} hint={f.role === "AUDITOR" ? "Required: auditors get access for a defined period." : "Leave empty for open-ended."}><Input id="ra-to" type="date" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} /></Field>
        <Field label="Reason" htmlFor="ra-reason" required error={fe.reason} className="sm:col-span-2"><Textarea id="ra-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        {m.error && !Object.keys(fe).length && <div className="sm:col-span-2"><InlineError message={m.error.body.message} /></div>}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ Policies */

type PolicyRow = PolicyVersion & { impact: string; approverName?: string };
const POLICY_TYPES: PolicyType[] = ["MONITORING", "ATTENDANCE", "LEAVE", "OVERTIME", "COMPENSATION", "RETENTION", "SCORING"];

export function PoliciesPanel() {
  const me = useMe();
  const q = useApiQuery<{ items: PolicyRow[] }>("/policies");
  const toast = useToast();
  const [drafting, setDrafting] = useState<PolicyRow | PolicyType | null>(null);
  const [approving, setApproving] = useState<PolicyRow | null>(null);
  const submit = useApiMutation("POST", "/policies/x/submit", { invalidate: ["/policies"], onSuccess: () => toast({ tone: "success", title: "Submitted for owner approval" }) });
  const approve = useApiMutation("POST", "/policies/x/approve", { invalidate: ["/policies", "/admin", "/notifications"], onSuccess: () => { toast({ tone: "success", title: "Policy approved" }); setApproving(null); } });
  const canDraft = can(me.data, "policy.draft") || can(me.data, "policy.approve");
  return (
    <div className="space-y-4">
      <Notice tone="amber" icon={<ShieldCheck className="h-4 w-4" />} title="Policy values are organization decisions">
        No statutory rates, deduction limits or entitlements are built in. Values here are configured examples until the owner and appropriate advisers approve them. Changes that affect privacy, pay or scoring need owner approval and create a new version; history keeps its original version.
      </Notice>
      <QueryState query={q}>
        {(d) => (
          <div className="grid gap-4 lg:grid-cols-2">
            {POLICY_TYPES.map((type) => {
              const versions = d.items.filter((p) => p.type === type);
              return (
                <Card key={type}>
                  <CardHeader title={`${humanize(type)} policy`} actions={canDraft && <Button size="sm" variant="outline" onClick={() => setDrafting(versions[0] ?? type)}>New version</Button>} />
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {versions.map((p) => (
                      <li key={p.id} className="space-y-2 px-5 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">v{p.version}</span>
                          <StateBadge state={p.status} />
                          <span className="text-xs text-slate-500">Effective {fmtDate(p.effectiveFrom)}</span>
                          {p.approvedAt && <span className="text-xs text-slate-500">· approved by {p.approverName} {fmtDate(p.approvedAt)}</span>}
                        </div>
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{p.title}</p>
                        <p className="text-sm text-slate-600 dark:text-slate-400">{p.summary}</p>
                        <div className="flex flex-wrap gap-1">{Object.entries(p.config).map(([k, v]) => <Badge key={k}>{k}: {String(v)}</Badge>)}</div>
                        {["DRAFT", "PENDING_APPROVAL"].includes(p.status) && (
                          <>
                            <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"><span className="font-semibold">Impact preview:</span> {p.impact}</p>
                            <div className="flex gap-2">
                              {p.status === "DRAFT" && canDraft && <Button size="sm" variant="outline" loading={submit.isPending} onClick={() => submit.mutate({ path: `/policies/${p.id}/submit` })}>Submit for approval</Button>}
                              {can(me.data, "policy.approve") && <Button size="sm" variant="success" onClick={() => setApproving(p)}>Approve…</Button>}
                            </div>
                          </>
                        )}
                      </li>
                    ))}
                    {!versions.length && <li className="px-5 py-4 text-sm text-slate-500">No versions yet.</li>}
                  </ul>
                </Card>
              );
            })}
          </div>
        )}
      </QueryState>
      {drafting && <DraftPolicyDialog base={typeof drafting === "string" ? null : drafting} type={typeof drafting === "string" ? drafting : drafting.type} onClose={() => setDrafting(null)} />}
      <ConfirmDialog
        open={!!approving}
        onClose={() => { setApproving(null); approve.reset(); }}
        title={`Approve ${approving?.title}?`}
        description={`Effective ${fmtDate(approving?.effectiveFrom)}. The current approved version of this type will be superseded.`}
        tone="success"
        confirmLabel="Approve policy"
        requireReason
        reasonLabel="Approval rationale"
        loading={approve.isPending}
        error={approve.error?.body.message}
        onConfirm={(reason) => approve.mutate({ path: `/policies/${approving!.id}/approve`, body: { reason } })}
      >
        <p className="rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-800">{approving?.impact}</p>
      </ConfirmDialog>
    </div>
  );
}

function DraftPolicyDialog({ base, type, onClose }: { base: PolicyRow | null; type: PolicyType; onClose: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(base ? base.title.replace(/v\d+.*$/, "").trim() + ` v${base.version + 1}` : `${humanize(type)} policy v1`);
  const [summary, setSummary] = useState(base?.summary ?? "");
  const [effectiveFrom, setEffective] = useState(new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10));
  const [config, setConfig] = useState<Record<string, string>>(Object.fromEntries(Object.entries(base?.config ?? {}).map(([k, v]) => [k, String(v)])));
  const m = useApiMutation("POST", "/policies", { invalidate: ["/policies"], onSuccess: () => { toast({ tone: "success", title: "Draft created", body: "Review the impact preview, then submit for owner approval." }); onClose(); } });
  const fe = m.error?.body.fieldErrors ?? {};
  const parse = (v: string): string | number | boolean => (v === "true" ? true : v === "false" ? false : v !== "" && !isNaN(Number(v)) && !/^0\d/.test(v) && !v.includes(".") ? Number(v) : v);
  return (
    <Dialog open onClose={onClose} size="lg" title={`Draft ${humanize(type).toLowerCase()} policy`} description={base ? `Starts from v${base.version}.` : undefined} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate({ body: { type, title, summary, effectiveFrom, config: Object.fromEntries(Object.entries(config).map(([k, v]) => [k, parse(v)])) } })}>Create draft</Button></>}>
      <div className="space-y-4">
        <Field label="Title" htmlFor="pd-title" required error={fe.title}><Input id="pd-title" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Summary for employees" htmlFor="pd-sum" required error={fe.summary}><Textarea id="pd-sum" value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>
        <Field label="Effective from" htmlFor="pd-eff" required error={fe.effectiveFrom}><Input id="pd-eff" type="date" value={effectiveFrom} onChange={(e) => setEffective(e.target.value)} /></Field>
        {Object.keys(config).length > 0 && (
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-medium">Configuration</legend>
            {Object.entries(config).map(([k, v]) => (
              <Field key={k} label={k} htmlFor={`pd-${k}`}><Input id={`pd-${k}`} value={v} onChange={(e) => setConfig({ ...config, [k]: e.target.value })} /></Field>
            ))}
          </fieldset>
        )}
        {type === "MONITORING" && <Notice tone="amber">Changing collection scope requires every enrolled employee to acknowledge the new version before tracking resumes.</Notice>}
        {m.error && !Object.keys(fe).length && <InlineError message={m.error.body.message} />}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ Devices */

export function DevicesPanel() {
  const q = useApiQuery<AgentVersionsDto>("/admin/agent-versions");
  const me = useMe();
  const toast = useToast();
  const [target, setTarget] = useState<{ id: string; hostname: string } | null>(null);
  const revoke = useApiMutation("POST", "/devices/x/revoke", { invalidate: ["/admin", "/devices", "/tracking"] });
  const canRevoke = can(me.data, "device.revoke");
  return (
    <>
    <ConfirmDialog
      open={!!target}
      onClose={() => { setTarget(null); revoke.reset(); }}
      title={`Revoke ${target?.hostname ?? "device"}?`}
      description="The device credential stops working at its next lease refresh and any active session is stopped. Historical evidence is kept."
      confirmLabel="Revoke device"
      tone="danger"
      requireReason
      loading={revoke.isPending}
      error={revoke.error?.body.message}
      onConfirm={(reason) =>
        revoke.mutate(
          { path: `/devices/${target!.id}/revoke`, body: { reason } },
          { onSuccess: () => { toast({ tone: "success", title: `${target!.hostname} revoked` }); setTarget(null); } },
        )
      }
    />
    {revokeBody()}
    </>
  );
  function revokeBody() {
  return (
    <QueryState query={q}>
      {(d) => (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {d.versions.map((v) => <Stat key={v.version} label={`Agent ${v.version}`} value={v.active} hint={`${v.pending} pending · ${v.revoked} revoked`} />)}
          </div>
          <Card>
            <CardHeader title="Device inventory" description="Device credentials only ingest for their bound employee. Revocation applies at the next lease refresh (at most 5 minutes online, 15 offline)." />
            <Table>
              <THead><tr><TH>Device</TH><TH>Employee</TH><TH>Agent</TH><TH>Status</TH><TH>Last seen</TH>{canRevoke && <TH><span className="sr-only">Actions</span></TH>}</tr></THead>
              <TBody>
                {d.devices.map((x) => (
                  <TR key={x.id}>
                    <TD className="font-mono text-xs">{x.hostname}</TD>
                    <TD>{x.employeeName}</TD>
                    <TD><Badge tone={x.agentVersion === d.versions[0]?.version ? "green" : "amber"}>{x.agentVersion}</Badge></TD>
                    <TD><StateBadge state={x.status} /></TD>
                    <TD className="text-xs">{x.lastSeen ? relativeTime(x.lastSeen) : "Never"}</TD>
                    {canRevoke && (
                      <TD className="text-right">
                        {x.status !== "REVOKED" && <Button size="sm" variant="outline" onClick={() => setTarget({ id: x.id, hostname: x.hostname })}>Revoke</Button>}
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        </div>
      )}
    </QueryState>
  );
  }
}

/* ------------------------------------------------------------------ Storage */

export function StoragePanel() {
  const q = useApiQuery<MediaHealthDto>("/admin/media-health", undefined, { refetchInterval: 30_000 });
  return (
    <QueryState query={q}>
      {(h) => {
        const tone = h.level === "OK" ? "brand" : h.level === "WARN_70" ? "amber" : "red";
        return (
          <div className="space-y-6">
            {h.driveUnavailable && <Notice tone="red" icon={<ServerCrash className="h-4 w-4" />} title="Google Drive unavailable">Media finalization is paused and uploads stay pending in the encrypted spool. Task metadata remains readable. Don't share public links as a workaround.</Notice>}
            <Card>
              <CardHeader title="Shared Drive pool" description="Workforce Project Media and Workforce Sensitive Evidence drives share the Workspace pooled quota with other usage." />
              <CardBody className="space-y-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-2xl font-semibold tabular-nums">{fmtBytes(h.usedBytes)} <span className="text-base font-normal text-slate-500">of {fmtBytes(h.poolBytes)}</span></p>
                  <Badge tone={h.level === "OK" ? "green" : h.level === "WARN_70" ? "amber" : "red"}>{h.usedPct}% used</Badge>
                </div>
                <div className="relative">
                  <Progress value={h.usedPct} tone={tone} label="Storage used" />
                  {h.thresholds.map((t) => (
                    <span key={t} className="absolute -top-1 h-4 w-px bg-slate-500" style={{ left: `${t}%` }} aria-hidden>
                      <span className="absolute left-1 top-4 text-[10px] text-slate-500">{t}%</span>
                    </span>
                  ))}
                </div>
                <p className="pt-3 text-xs text-slate-500">Alerts at 70%, 85% and 95%. At critical capacity, optional screenshots pause first and oversized upload intents are rejected; accepted work is never deleted automatically.</p>
              </CardBody>
            </Card>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <Stat label="Pending transfers" value={h.pendingTransfers} icon={<HardDrive className="h-4 w-4" />} tone="blue" />
              <Stat label="Failed scans" value={h.failedScans} tone={h.failedScans ? "red" : "slate"} icon={<XCircle className="h-4 w-4" />} />
              <Stat label="Quarantined" value={h.quarantined} tone={h.quarantined ? "amber" : "slate"} icon={<AlertTriangle className="h-4 w-4" />} />
              <Stat label="Outbox backlog" value={h.outboxBacklog} tone={h.outboxBacklog ? "amber" : "slate"} />
              <Stat label="Last backup" value={relativeTime(h.lastBackupAt)} hint={fmtDateTime(h.lastBackupAt)} />
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader title="Usage by category" />
                <ul className="space-y-3 px-5 py-4">
                  {h.byCategory.map((c) => (
                    <li key={c.category}>
                      <div className="mb-1 flex justify-between text-sm"><span>{humanize(c.category)}</span><span className="tabular-nums text-slate-500">{fmtBytes(c.bytes)}</span></div>
                      <Progress value={c.bytes} max={h.usedBytes} label={c.category} />
                    </li>
                  ))}
                </ul>
              </Card>
              <Card>
                <CardHeader title="Capacity planning" description="Section 19 sizing example (proposed)." />
                <CardBody className="space-y-3 text-sm">
                  <p className="rounded-md bg-slate-50 p-3 font-mono text-xs dark:bg-slate-800">50 employees × 8 h × 6 captures/h × 22 days × 0.2 MB ≈ {(h.screenshotForecastBytesPerMonth / 1e9).toFixed(2)} GB / month</p>
                  <p className="text-slate-600 dark:text-slate-400">Monthly forecast = retained evidence + project intake − approved deletions + other Workspace use, plus independent backup capacity and a 20% planning reserve. Multi-monitor and higher-quality captures increase this materially; measure pilot p95 bytes per capture.</p>
                  <p className="text-xs text-slate-500">Reference recurring Workspace cost is N licensed users × USD 14 (annual) or × 16.80 (flexible) — not a quote.</p>
                </CardBody>
              </Card>
            </div>
          </div>
        );
      }}
    </QueryState>
  );
}

/* ------------------------------------------------------------------ Retention */

export function RetentionPanel() {
  const q = useApiQuery<RetentionDto>("/admin/retention");
  return (
    <QueryState query={q}>
      {(r) => (
        <div className="space-y-4">
          {r.blockedReason ? (
            <Notice tone="red" title="Retention jobs blocked" icon={<AlertTriangle className="h-4 w-4" />}>
              {r.blockedReason} <Link href="/admin?tab=policies" className="font-medium underline">Review the retention policy</Link> (status: {humanize(r.policyStatus)}).
            </Notice>
          ) : (
            <Notice tone="green" title="Retention policy approved">Last run {r.lastRunAt ? relativeTime(r.lastRunAt) : "—"}. Jobs check legal/policy holds before deleting media, thumbnails and spools.</Notice>
          )}
          <Card>
            <CardHeader title="Retention rules" description="Deletion covers replicas and backup expiry; a suppression marker keeps capture time and reason without the image." />
            <Table>
              <THead><tr><TH>Category</TH><TH>Period</TH><TH className="text-right">Eligible now</TH><TH className="text-right">Held</TH></tr></THead>
              <TBody>
                {r.rules.map((x) => (
                  <TR key={x.category}><TD>{x.category}</TD><TD>{x.period}</TD><TD className="text-right tabular-nums">{x.eligible}</TD><TD className="text-right tabular-nums">{x.held}</TD></TR>
                ))}
              </TBody>
            </Table>
          </Card>
        </div>
      )}
    </QueryState>
  );
}

/* ------------------------------------------------------------------ Release checklist */

export function ChecklistPanel() {
  const q = useApiQuery<ChecklistDto>("/admin/release-checklist");
  const icon = { PASS: <CheckCircle2 className="h-5 w-5 text-emerald-500" />, FAIL: <XCircle className="h-5 w-5 text-red-500" />, MANUAL: <CircleDashed className="h-5 w-5 text-slate-400" /> };
  return (
    <Card>
      <CardHeader title="Release checklist" description="Section 30. Items marked manual need recorded evidence in the decision register." />
      <QueryState query={q}>
        {(d) => (
          <>
            <div className="flex flex-wrap gap-2 px-5 pt-4">
              <Badge tone="green">{d.items.filter((i) => i.status === "PASS").length} passing</Badge>
              <Badge tone="red">{d.items.filter((i) => i.status === "FAIL").length} blocking</Badge>
              <Badge>{d.items.filter((i) => i.status === "MANUAL").length} need evidence</Badge>
            </div>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {d.items.map((i) => (
                <li key={i.key} className="flex items-start gap-3 px-5 py-3">
                  <span className="mt-0.5" aria-label={i.status}>{icon[i.status]}</span>
                  <div><p className={cn("text-sm font-medium", i.status === "FAIL" && "text-red-700 dark:text-red-400")}>{i.label}</p><p className="text-xs text-slate-500">{i.detail}</p></div>
                </li>
              ))}
            </ul>
          </>
        )}
      </QueryState>
    </Card>
  );
}

/* ------------------------------------------------------------------ Demo controls (mock only) */

export function DemoControls() {
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const sim = useApiQuery<{ driveUnavailable: boolean; latencyMs: number }>("/_mock/sim");
  const [resetting, setResetting] = useState(false);
  const setSim = async (patch: Partial<{ driveUnavailable: boolean; latencyMs: number }>) => {
    await api.post("/_mock/sim", patch);
    await qc.invalidateQueries();
  };
  return (
    <Card>
      <CardHeader title="Demo controls" description="Only available with the in-browser mock API. Not part of the production portal." />
      <CardBody className="space-y-5">
        <QueryState query={sim}>
          {(s) => (
            <div className="space-y-4">
              <Checkbox label="Simulate Google Drive outage" description="Media finalization fails with DEPENDENCY_UNAVAILABLE; existing metadata stays readable." checked={s.driveUnavailable} onChange={(v) => setSim({ driveUnavailable: v })} />
              <Field label={`Simulated API latency: ${s.latencyMs} ms`} htmlFor="sim-lat">
                <input id="sim-lat" type="range" min={0} max={2000} step={50} value={s.latencyMs} onChange={(e) => setSim({ latencyMs: Number(e.target.value) })} className="w-full max-w-sm accent-brand-600" />
              </Field>
            </div>
          )}
        </QueryState>
        <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
          <Button
            variant="danger"
            icon={<RotateCcw className="h-4 w-4" />}
            loading={resetting}
            onClick={async () => {
              setResetting(true);
              await api.post("/_mock/reset");
              qc.clear();
              toast({ tone: "info", title: "Demo data reset", body: "Sign in again to continue." });
              router.replace("/login");
            }}
          >
            Reset demo data
          </Button>
          <p className="mt-2 text-xs text-slate-500">Restores the seed dataset and signs you out.</p>
        </div>
      </CardBody>
    </Card>
  );
}
