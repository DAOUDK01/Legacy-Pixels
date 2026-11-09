"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMe } from "@/lib/api/hooks";
import { API_MODE } from "@/lib/api/transport";
import { can } from "@/lib/rbac";
import type { Me } from "@/lib/types";
import { Card, EmptyState, LoadingState, PageHeader, Tabs } from "@/components/ui";
import {
  ChecklistPanel, DemoControls, DevicesPanel, OrganizationPanel, PoliciesPanel, RetentionPanel, RolesPanel, StoragePanel, TeamsPanel,
} from "@/components/admin/panels";

const TABS: { value: string; label: string; visible: (me: Me) => boolean }[] = [
  { value: "organization", label: "Organization", visible: (me) => can(me, "admin.settings") || can(me, "policy.read") },
  { value: "teams", label: "Teams", visible: (me) => can(me, "team.manage") },
  { value: "roles", label: "Roles & invitations", visible: (me) => can(me, "role.assign") || can(me, "user.invite") },
  { value: "policies", label: "Policies", visible: (me) => can(me, "policy.read") },
  { value: "devices", label: "Devices & agents", visible: (me) => can(me, "device.read") },
  { value: "storage", label: "Storage & media", visible: (me) => can(me, "media.health.read") || can(me, "admin.settings") },
  { value: "retention", label: "Retention", visible: (me) => can(me, "admin.settings") },
  { value: "release", label: "Release checklist", visible: (me) => can(me, "admin.settings") },
  { value: "demo", label: "Demo controls", visible: () => API_MODE === "mock" },
];

export default function AdminPage() {
  return (
    <Suspense fallback={<Card><LoadingState /></Card>}>
      <Admin />
    </Suspense>
  );
}

function Admin() {
  const me = useMe();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  if (!me.data) return <Card><LoadingState /></Card>;
  const tabs = TABS.filter((t) => t.visible(me.data!));
  const tab = tabs.find((t) => t.value === params.get("tab"))?.value ?? tabs[0]?.value;
  return (
    <>
      <PageHeader title="Administration" description="Organization settings, access, policies, devices, storage health and release readiness. Service account keys and raw tokens are never shown here." />
      {tabs.length === 0 ? (
        <Card><EmptyState title="No administration access" /></Card>
      ) : (
        <>
          <Tabs className="mb-6" tabs={tabs.map(({ value, label }) => ({ value, label }))} value={tab!} onChange={(v) => router.replace(`${pathname}?tab=${v}`)} />
          {tab === "organization" && <OrganizationPanel />}
          {tab === "teams" && <TeamsPanel />}
          {tab === "roles" && <RolesPanel />}
          {tab === "policies" && <PoliciesPanel />}
          {tab === "devices" && <DevicesPanel />}
          {tab === "storage" && <StoragePanel />}
          {tab === "retention" && <RetentionPanel />}
          {tab === "release" && <ChecklistPanel />}
          {tab === "demo" && <DemoControls />}
        </>
      )}
    </>
  );
}
