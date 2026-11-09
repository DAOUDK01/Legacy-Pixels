"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { useApiMutation, useLookups, useMe } from "@/lib/api/hooks";
import { can, PRIVILEGED_ROLES, ROLE_LABELS } from "@/lib/rbac";
import type { RoleKey } from "@/lib/types";
import { Button, Dialog, Field, InlineError, Input, Select } from "@/components/ui";
import { useToast } from "@/components/ui/toast";

export function InviteButton() {
  const me = useMe();
  const [open, setOpen] = useState(false);
  if (!can(me.data, "user.invite")) return null;
  return (
    <>
      <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setOpen(true)}>Invite</Button>
      <InviteDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe();
  const lookups = useLookups();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<RoleKey>("EMPLOYEE");
  const [teamId, setTeamId] = useState("");
  const m = useApiMutation("POST", "/invitations", {
    invalidate: ["/invitations"],
    onSuccess: () => {
      toast({ tone: "success", title: "Invitation created", body: `${email} has 7 days to accept. Links are single use.` });
      setEmail("");
      onClose();
    },
  });
  const isOwner = me.data?.roles.includes("OWNER");
  const roles = (Object.keys(ROLE_LABELS) as RoleKey[]).filter((r) => isOwner || !(r === "OWNER" || PRIVILEGED_ROLES.includes(r)));
  const fe = m.error?.body.fieldErrors ?? {};
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Invite to Legacy Pixels"
      description="Invitations are tied to an approved organization and role. People sign in with their Google Workspace account."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate({ body: { email, role, teamId: teamId || undefined } })}>Send invitation</Button></>}
    >
      <div className="space-y-4">
        <Field label="Work email" htmlFor="inv-email" required error={fe.email}>
          <Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} invalid={!!fe.email} autoComplete="off" />
        </Field>
        <Field label="Role" htmlFor="inv-role" required error={fe.role} hint={!isOwner ? "Only the owner can invite privileged roles." : undefined}>
          <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as RoleKey)}>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </Select>
        </Field>
        <Field label="Team" htmlFor="inv-team">
          <Select id="inv-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">No team</option>
            {lookups.data?.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        {m.error && !Object.keys(fe).length && <InlineError message={m.error.body.message} />}
      </div>
    </Dialog>
  );
}
