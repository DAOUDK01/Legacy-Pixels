"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Circle, FileText, Lock, MinusCircle, Pencil } from "lucide-react";
import { useApiMutation, useApiQuery } from "@/lib/api/hooks";
import type { AssetRow, EmployeeDetail, OffboardingChecklist, PrivateProfile } from "@/lib/api/people";
import { ROLE_LABELS } from "@/lib/rbac";
import { fmtDate, fmtDateTime } from "@/lib/time";
import {
  Avatar, Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, DL, EmptyState, ErrorState, Field, InlineError, Input,
  LoadingState, Notice, PageHeader, QueryState, Table, TBody, TD, TH, THead, TR, Tabs,
} from "@/components/ui";
import { StateBadge, VersionConflictDialog, humanize } from "@/components/domain";
import { useToast } from "@/components/ui/toast";

type Tab = "overview" | "private" | "assets" | "offboarding";

export default function ProfilePage() {
  const { id } = useParams<{ id: string }>();
  const q = useApiQuery<EmployeeDetail>(`/employees/${id}`);
  const [tab, setTab] = useState<Tab>("overview");

  if (q.isLoading) return <Card><LoadingState rows={6} /></Card>;
  if (q.error || !q.data) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>;
  const e = q.data;
  const tabs: { value: Tab; label: string }[] = [
    { value: "overview", label: "Overview" },
    { value: "private", label: "Private HR" },
    { value: "assets", label: "Assets" },
    ...(e.canManage ? [{ value: "offboarding" as Tab, label: "Status & offboarding" }] : []),
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Directory", href: "/people" }, { label: e.displayName }]}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={e.displayName} color={e.avatarColor} size={44} />
            <span>
              {e.displayName}
              <span className="block text-sm font-normal text-slate-500">{e.title} · {e.employeeCode}</span>
            </span>
          </span>
        }
        actions={<StateBadge state={e.employmentStatus} />}
      />
      <Tabs className="mb-6" tabs={tabs} value={tab} onChange={setTab} />
      {tab === "overview" && <Overview e={e} />}
      {tab === "private" && <PrivateTab e={e} />}
      {tab === "assets" && <AssetsTab id={e.id} />}
      {tab === "offboarding" && e.canManage && <OffboardingTab e={e} />}
    </>
  );
}

function Overview({ e }: { e: EmployeeDetail }) {
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState(e.workPhone ?? "");
  const toast = useToast();
  const m = useApiMutation("PATCH", `/employees/${e.id}`, {
    invalidate: ["/employees"],
    onSuccess: () => {
      toast({ tone: "success", title: "Contact updated" });
      setEditing(false);
    },
  });
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Employment" description="Visible to colleagues with directory access." />
        <CardBody>
          <DL
            items={[
              { label: "Employee code", value: <span className="font-mono">{e.employeeCode}</span> },
              { label: "Status", value: <StateBadge state={e.employmentStatus} /> },
              { label: "Team", value: e.teamName ?? "—" },
              { label: "Manager", value: e.managerId ? <Link className="text-brand-700 hover:underline" href={`/people/${e.managerId}`}>{e.managerName}</Link> : "—" },
              { label: "Start date", value: fmtDate(e.startDate) },
              { label: "End date", value: fmtDate(e.endDate) },
              { label: "Timezone", value: e.timezone },
              { label: "Roles", value: <span className="flex flex-wrap gap-1">{e.roles.map((r) => <Badge key={r} tone={r === "EMPLOYEE" ? "slate" : "blue"}>{ROLE_LABELS[r]}</Badge>)}{!e.roles.length && "—"}</span> },
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Work contact" actions={e.canEditContact && !editing && <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(true)}>Edit</Button>} />
        <CardBody className="space-y-4">
          <DL cols={1} items={[{ label: "Email", value: <a className="hover:underline" href={`mailto:${e.workEmail}`}>{e.workEmail}</a> }, ...(!editing ? [{ label: "Phone", value: e.workPhone ?? "—" }] : [])]} />
          {editing && (
            <form
              className="space-y-3"
              onSubmit={(ev) => {
                ev.preventDefault();
                m.mutate({ body: { workPhone: phone }, ifMatch: e.version });
              }}
            >
              <Field label="Work phone" htmlFor="phone" error={m.error?.body.fieldErrors?.workPhone}>
                <Input id="phone" value={phone} onChange={(x) => setPhone(x.target.value)} invalid={!!m.error?.body.fieldErrors?.workPhone} />
              </Field>
              {m.error && !m.error.body.fieldErrors && m.error.code !== "VERSION_CONFLICT" && <InlineError message={m.error.body.message} />}
              <div className="flex gap-2">
                <Button type="submit" size="sm" loading={m.isPending}>Save</Button>
                <Button size="sm" variant="outline" onClick={() => { setEditing(false); m.reset(); }}>Cancel</Button>
              </div>
              <p className="text-xs text-slate-500">Legal name, payment reference and other controlled fields are changed through HR.</p>
            </form>
          )}
        </CardBody>
      </Card>
      <VersionConflictDialog error={m.error} mine={{ ...e, workPhone: phone }} fields={["workPhone", "title", "teamId", "version"]} onClose={() => m.reset()} onReload={() => { m.reset(); setEditing(false); }} />
    </div>
  );
}

function PrivateTab({ e }: { e: EmployeeDetail }) {
  const q = useApiQuery<PrivateProfile>(e.canReadPrivate ? `/employees/${e.id}/private` : null);
  if (!e.canReadPrivate) {
    return (
      <Card>
        <EmptyState icon={<Lock className="h-6 w-6" />} title="Restricted HR record" description="Private HR details are visible only to HR, the owner and the employee. Access is audited." />
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {!e.isSelf && <Notice tone="amber" icon={<Lock className="h-4 w-4" />}>This view is a sensitive read and has been recorded in the audit log.</Notice>}
      <QueryState query={q} rows={5}>
        {(p) => (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Personal & emergency" />
              <CardBody>
                <DL
                  items={[
                    { label: "Legal name", value: p.legalName },
                    { label: "Payment reference", value: <span className="font-mono">{p.paymentReferenceMasked ?? "—"}</span> },
                    { label: "Emergency contact", value: p.emergencyContactName },
                    { label: "Emergency phone", value: p.emergencyContactPhone },
                  ]}
                />
                <p className="mt-4 text-xs text-slate-500">Compensation is held in a separate permission boundary and isn't shown here.</p>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Policy acknowledgements" />
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {p.acknowledgements.map((a) => (
                  <li key={`${a.policyType}-${a.version}`} className="flex items-center justify-between px-5 py-3 text-sm">
                    <span>{humanize(a.policyType)} policy v{a.version}</span>
                    <span className="text-xs text-slate-500">{fmtDateTime(a.acknowledgedAt)}</span>
                  </li>
                ))}
                {!p.acknowledgements.length && <li className="px-5 py-4 text-sm text-slate-500">No acknowledgements recorded.</li>}
              </ul>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader title="Restricted documents" description="Stored in the HR Shared Drive; downloads stream through the portal with access checks." />
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {p.documents.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                    <FileText className="h-4 w-4 text-slate-400" />
                    <span className="flex-1">{d.name}</span>
                    <Badge>{d.category}</Badge>
                    <span className="text-xs text-slate-500">{fmtDate(d.uploadedAt)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}
      </QueryState>
    </div>
  );
}

function AssetsTab({ id }: { id: string }) {
  const q = useApiQuery<{ items: AssetRow[] }>("/assets", { employeeId: id });
  return (
    <Card>
      <CardHeader title="Assets in custody" actions={<Link href="/assets" className="text-sm text-brand-700 hover:underline">Asset register</Link>} />
      <QueryState query={q} empty={(d) => d.items.length === 0} emptyTitle="No assets assigned">
        {(d) => (
          <Table>
            <THead><tr><TH>Tag</TH><TH>Model</TH><TH>State</TH><TH>Issued</TH><TH>Acknowledged</TH></tr></THead>
            <TBody>
              {d.items.map((a) => (
                <TR key={a.id}>
                  <TD className="font-mono text-xs">{a.assetTag}</TD>
                  <TD>{a.model}<span className="block text-xs text-slate-500">{a.type}</span></TD>
                  <TD><StateBadge state={a.state} /></TD>
                  <TD>{fmtDate(a.activeAssignment?.issuedAt)}</TD>
                  <TD>{a.activeAssignment?.acknowledgedAt ? fmtDate(a.activeAssignment.acknowledgedAt) : <Badge tone="amber">Pending</Badge>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </QueryState>
    </Card>
  );
}

function OffboardingTab({ e }: { e: EmployeeDetail }) {
  const q = useApiQuery<OffboardingChecklist>(`/employees/${e.id}/offboarding`);
  const toast = useToast();
  const [action, setAction] = useState<null | "SUSPEND" | "REACTIVATE" | "OFFBOARD">(null);
  const m = useApiMutation("POST", `/employees/${e.id}/status`, {
    invalidate: ["/employees", "/assets", "/lookups"],
    onSuccess: () => {
      toast({ tone: "success", title: "Employment status updated" });
      setAction(null);
    },
  });
  const copy = {
    SUSPEND: { title: `Suspend ${e.displayName}?`, desc: "Revokes portal sessions and device keys immediately and stops tracking sessions. Employment records are kept.", label: "Suspend", tone: "danger" as const },
    REACTIVATE: { title: `Reactivate ${e.displayName}?`, desc: "Restores portal access. Device enrollment must be repeated.", label: "Reactivate", tone: "success" as const },
    OFFBOARD: { title: `Offboard ${e.displayName}?`, desc: "Revokes access and device keys, requests asset return and flags the final payroll review. History, submissions and payroll records are preserved.", label: "Offboard", tone: "danger" as const },
  };
  const icon = { DONE: <CheckCircle2 className="h-5 w-5 text-emerald-500" />, PENDING: <Circle className="h-5 w-5 text-amber-500" />, "N/A": <MinusCircle className="h-5 w-5 text-slate-300" /> };
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Offboarding checklist" description="Computed live from tasks, reviews, attendance, payroll, assets and device access." />
        <QueryState query={q}>
          {(c) => (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {c.items.map((it) => (
                <li key={it.key} className="flex items-start gap-3 px-5 py-3">
                  <span className="mt-0.5" aria-label={it.status}>{icon[it.status]}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{it.label}</p>
                    <p className="text-xs text-slate-500">{it.detail}</p>
                  </div>
                  {it.href && it.status === "PENDING" && <Link href={it.href} className="text-xs font-medium text-brand-700 hover:underline">Open</Link>}
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </Card>
      <Card>
        <CardHeader title="Employment status" />
        <CardBody className="space-y-3">
          <p className="text-sm">Current: <StateBadge state={e.employmentStatus} /></p>
          {e.isSelf ? (
            <p className="text-sm text-slate-500">You can't change your own status.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {e.employmentStatus === "ACTIVE" && <Button variant="outline" onClick={() => setAction("SUSPEND")}>Suspend access</Button>}
              {e.employmentStatus === "SUSPENDED" && <Button variant="outline" onClick={() => setAction("REACTIVATE")}>Reactivate</Button>}
              {["ACTIVE", "SUSPENDED"].includes(e.employmentStatus) && <Button variant="danger" onClick={() => setAction("OFFBOARD")}>Offboard employee</Button>}
              {e.employmentStatus === "OFFBOARDED" && <p className="text-sm text-slate-500">Offboarded on {fmtDate(e.endDate)}. Records are retained under the approved schedule.</p>}
            </div>
          )}
        </CardBody>
      </Card>
      {action && (
        <ConfirmDialog
          open
          onClose={() => { setAction(null); m.reset(); }}
          title={copy[action].title}
          description={copy[action].desc}
          confirmLabel={copy[action].label}
          tone={copy[action].tone}
          requireReason
          loading={m.isPending}
          error={m.error?.body.message}
          onConfirm={(reason) => m.mutate({ body: { action, reason }, ifMatch: e.version })}
        />
      )}
    </div>
  );
}
