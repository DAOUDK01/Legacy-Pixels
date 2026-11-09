"use client";

import { useState } from "react";
import { History, MoreHorizontal, Plus } from "lucide-react";
import { useApiMutation, useApiQuery, useLookups, useMe } from "@/lib/api/hooks";
import type { AssetHistoryEntry, AssetRow } from "@/lib/api/people";
import { can } from "@/lib/rbac";
import { fmtDate, fmtDateTime } from "@/lib/time";
import {
  Badge, Button, Card, ConfirmDialog, Dialog, Field, FilterBar, InlineError, Input, Notice, PageHeader, QueryState, Select,
  Table, TBody, TD, TH, THead, TR, Textarea, Timeline, type Tone,
} from "@/components/ui";
import { Person, StateBadge } from "@/components/domain";
import { useToast } from "@/components/ui/toast";

type Action = "assign" | "return-request" | "return" | "maintenance" | "retire" | "available" | "damage" | "history";

export default function AssetsPage() {
  const me = useMe();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [state, setState] = useState("");
  const [creating, setCreating] = useState(false);
  const [active, setActive] = useState<{ asset: AssetRow; action: Action } | null>(null);
  const query = useApiQuery<{ items: AssetRow[]; types: string[] }>("/assets", { q, type, state });
  const manage = can(me.data, "asset.manage");
  const toast = useToast();
  const ack = useApiMutation("POST", "/assets/x/acknowledge", { invalidate: ["/assets"], onSuccess: () => toast({ tone: "success", title: "Receipt acknowledged" }) });

  return (
    <>
      <PageHeader
        title="Assets"
        description="Equipment register and custody. Loss or damage opens a review case — it never creates an automatic payroll deduction."
        actions={manage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Add asset</Button>}
      />
      <Card>
        <FilterBar>
          <Field label="Search" htmlFor="as-q" className="w-full sm:w-60"><Input id="as-q" type="search" placeholder="Tag, model, serial" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
          <Field label="Type" htmlFor="as-type" className="w-40">
            <Select id="as-type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All types</option>
              {query.data?.types.map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="State" htmlFor="as-state" className="w-44">
            <Select id="as-state" value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">Any state</option>
              {["AVAILABLE", "ASSIGNED", "RETURN_REQUESTED", "RETURNED", "MAINTENANCE", "RETIRED"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}
            </Select>
          </Field>
        </FilterBar>
        <QueryState query={query} empty={(d) => d.items.length === 0} emptyTitle="No assets" emptyDescription={manage ? "Add equipment to start tracking custody." : "No equipment is assigned to you."}>
          {(d) => (
            <Table>
              <THead><tr><TH>Tag</TH><TH>Asset</TH><TH>Condition</TH><TH>State</TH><TH>Custodian</TH><TH>Acknowledged</TH><TH className="text-right">Actions</TH></tr></THead>
              <TBody>
                {d.items.map((a) => (
                  <TR key={a.id}>
                    <TD className="font-mono text-xs">{a.assetTag}</TD>
                    <TD><span className="font-medium text-slate-900 dark:text-slate-100">{a.model}</span><span className="block text-xs text-slate-500">{a.type} · S/N {a.serial}</span></TD>
                    <TD><Badge tone={({ NEW: "green", GOOD: "green", FAIR: "amber", DAMAGED: "red" } as Record<string, Tone>)[a.condition]}>{a.condition.toLowerCase()}</Badge></TD>
                    <TD><StateBadge state={a.state} /></TD>
                    <TD>{a.assignedEmployeeId ? <Person id={a.assignedEmployeeId} /> : <span className="text-slate-400">—</span>}</TD>
                    <TD>{a.activeAssignment ? (a.activeAssignment.acknowledgedAt ? <span className="text-xs">{fmtDate(a.activeAssignment.acknowledgedAt)}</span> : <Badge tone="amber">Pending</Badge>) : "—"}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        {a.canAcknowledge && <Button size="sm" loading={ack.isPending} onClick={() => ack.mutate({ path: `/assets/${a.id}/acknowledge` })}>Acknowledge receipt</Button>}
                        {manage && <RowMenu asset={a} onPick={(action) => setActive({ asset: a, action })} />}
                        {!manage && <Button size="sm" variant="ghost" icon={<History className="h-4 w-4" />} onClick={() => setActive({ asset: a, action: "history" })}>History</Button>}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </QueryState>
      </Card>
      <CreateAssetDialog open={creating} onClose={() => setCreating(false)} />
      {active && <ActionDialog asset={active.asset} action={active.action} onClose={() => setActive(null)} />}
    </>
  );
}

function RowMenu({ asset, onPick }: { asset: AssetRow; onPick: (a: Action) => void }) {
  const [open, setOpen] = useState(false);
  const items: { action: Action; label: string; show: boolean }[] = [
    { action: "assign", label: "Assign…", show: asset.state === "AVAILABLE" },
    { action: "return-request", label: "Request return", show: asset.state === "ASSIGNED" },
    { action: "return", label: "Record return…", show: ["ASSIGNED", "RETURN_REQUESTED"].includes(asset.state) },
    { action: "available", label: "Make available", show: ["RETURNED", "MAINTENANCE"].includes(asset.state) },
    { action: "maintenance", label: "Send to maintenance", show: ["RETURNED", "AVAILABLE"].includes(asset.state) },
    { action: "retire", label: "Retire", show: ["RETURNED", "AVAILABLE", "MAINTENANCE"].includes(asset.state) },
    { action: "damage", label: "Report loss / damage…", show: asset.state !== "RETIRED" },
    { action: "history", label: "History", show: true },
  ];
  return (
    <div className="relative">
      <Button size="icon" variant="ghost" aria-label={`Actions for ${asset.assetTag}`} aria-expanded={open} onClick={() => setOpen((v) => !v)} onBlur={() => setTimeout(() => setOpen(false), 150)}>
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 top-10 z-20 w-52 rounded-lg border border-slate-200 bg-white py-1 text-left shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {items.filter((i) => i.show).map((i) => (
            <button key={i.action} role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => { setOpen(false); onPick(i.action); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateAssetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ assetTag: "", serial: "", type: "Laptop", model: "", condition: "NEW", referenceDate: "" });
  const toast = useToast();
  const m = useApiMutation("POST", "/assets", { invalidate: ["/assets"], onSuccess: () => { toast({ tone: "success", title: "Asset added" }); onClose(); setF({ ...f, assetTag: "", serial: "", model: "" }); } });
  const fe = m.error?.body.fieldErrors ?? {};
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onClose={onClose} title="Add asset" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate({ body: { ...f, referenceDate: f.referenceDate || undefined } })}>Add asset</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Asset tag" htmlFor="na-tag" required error={fe.assetTag}><Input id="na-tag" value={f.assetTag} onChange={set("assetTag")} placeholder="LP-LAP-005" invalid={!!fe.assetTag} /></Field>
        <Field label="Serial" htmlFor="na-serial" required error={fe.serial}><Input id="na-serial" value={f.serial} onChange={set("serial")} invalid={!!fe.serial} /></Field>
        <Field label="Type" htmlFor="na-type" required error={fe.type}><Input id="na-type" value={f.type} onChange={set("type")} list="asset-types" /></Field>
        <Field label="Model" htmlFor="na-model" required error={fe.model}><Input id="na-model" value={f.model} onChange={set("model")} invalid={!!fe.model} /></Field>
        <Field label="Condition" htmlFor="na-cond"><Select id="na-cond" value={f.condition} onChange={set("condition")}>{["NEW", "GOOD", "FAIR", "DAMAGED"].map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}</Select></Field>
        <Field label="Reference date" htmlFor="na-date" hint="Optional purchase/reference date"><Input id="na-date" type="date" value={f.referenceDate} onChange={set("referenceDate")} /></Field>
      </div>
      <datalist id="asset-types">{["Laptop", "Monitor", "Pen tablet", "Camera", "Phone"].map((t) => <option key={t} value={t} />)}</datalist>
      {m.error && !Object.keys(fe).length && <div className="mt-3"><InlineError message={m.error.body.message} /></div>}
    </Dialog>
  );
}

function ActionDialog({ asset, action, onClose }: { asset: AssetRow; action: Action; onClose: () => void }) {
  const toast = useToast();
  const lookups = useLookups();
  const [employeeId, setEmployeeId] = useState("");
  const [text, setText] = useState("");
  const [condition, setCondition] = useState(asset.condition);
  const done = (title: string) => () => { toast({ tone: "success", title }); onClose(); };
  const assign = useApiMutation("POST", `/assets/${asset.id}/assignments`, { invalidate: ["/assets"], onSuccess: done("Asset assigned") });
  const ret = useApiMutation("POST", `/assets/${asset.id}/return`, { invalidate: ["/assets"], onSuccess: done("Return recorded") });
  const reqRet = useApiMutation("POST", `/assets/${asset.id}/return-request`, { invalidate: ["/assets"], onSuccess: done("Return requested") });
  const stateM = useApiMutation("POST", `/assets/${asset.id}/state`, { invalidate: ["/assets"], onSuccess: done("Asset state updated") });
  const damage = useApiMutation("POST", `/assets/${asset.id}/damage-case`, { invalidate: ["/assets"], onSuccess: done("Review case opened") });
  const history = useApiQuery<{ entries: AssetHistoryEntry[]; cases: { id: string; description: string; openedAt: string; openedBy: string; status: string }[] }>(action === "history" ? `/assets/${asset.id}/history` : null);

  if (action === "history") {
    return (
      <Dialog open onClose={onClose} size="lg" title={`${asset.assetTag} history`} description={`${asset.model} · S/N ${asset.serial}`}>
        <QueryState query={history}>
          {(h) => (
            <div className="space-y-5">
              {h.cases.length > 0 && <Notice tone="amber" title={`${h.cases.length} open review case(s)`}>{h.cases.map((c) => <p key={c.id}>{c.description} — {c.openedBy}, {fmtDate(c.openedAt)}</p>)}</Notice>}
              <Timeline items={h.entries.map((e) => ({ id: e.id, title: e.text, meta: fmtDateTime(e.at), tone: e.kind === "DAMAGE_CASE" ? "red" : e.kind === "ISSUED" ? "blue" : e.kind === "RETURNED" ? "green" : "slate" }))} />
            </div>
          )}
        </QueryState>
      </Dialog>
    );
  }
  if (action === "return-request" || action === "maintenance" || action === "retire" || action === "available") {
    const m = action === "return-request" ? reqRet : stateM;
    const copy = {
      "return-request": { title: `Request return of ${asset.assetTag}?`, label: "Request return", reason: false },
      maintenance: { title: `Send ${asset.assetTag} to maintenance?`, label: "Send to maintenance", reason: true },
      retire: { title: `Retire ${asset.assetTag}?`, label: "Retire asset", reason: true },
      available: { title: `Make ${asset.assetTag} available?`, label: "Make available", reason: false },
    }[action];
    return (
      <ConfirmDialog
        open
        onClose={onClose}
        title={copy.title}
        confirmLabel={copy.label}
        tone={action === "retire" ? "danger" : "primary"}
        requireReason={copy.reason}
        loading={m.isPending}
        error={m.error?.body.message}
        onConfirm={(reason) => m.mutate({ ifMatch: asset.version, body: action === "return-request" ? { reason } : { state: action === "available" ? "AVAILABLE" : action === "retire" ? "RETIRED" : "MAINTENANCE", reason } })}
      />
    );
  }
  const cfg = {
    assign: { title: `Assign ${asset.assetTag}`, label: "Assign", m: assign, body: () => ({ employeeId, issueCondition: text }) },
    return: { title: `Record return of ${asset.assetTag}`, label: "Record return", m: ret, body: () => ({ returnCondition: text, condition }) },
    damage: { title: `Report loss or damage: ${asset.assetTag}`, label: "Open review case", m: damage, body: () => ({ description: text }) },
  }[action as "assign" | "return" | "damage"];
  const fe = cfg.m.error?.body.fieldErrors ?? {};
  return (
    <Dialog open onClose={onClose} title={cfg.title} description={asset.model} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={cfg.m.isPending} variant={action === "damage" ? "danger" : "primary"} onClick={() => cfg.m.mutate({ body: cfg.body(), ifMatch: action === "damage" ? undefined : asset.version })}>{cfg.label}</Button></>}>
      <div className="space-y-4">
        {action === "assign" && (
          <Field label="Employee" htmlFor="asg-emp" required error={fe.employeeId}>
            <Select id="asg-emp" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} invalid={!!fe.employeeId}>
              <option value="">Choose…</option>
              {lookups.data?.employees.filter((e) => e.employmentStatus === "ACTIVE").map((e) => <option key={e.id} value={e.id}>{e.displayName} ({e.employeeCode})</option>)}
            </Select>
          </Field>
        )}
        {action === "return" && (
          <Field label="Condition after return" htmlFor="ret-cond">
            <Select id="ret-cond" value={condition} onChange={(e) => setCondition(e.target.value as AssetRow["condition"])}>{["NEW", "GOOD", "FAIR", "DAMAGED"].map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}</Select>
          </Field>
        )}
        <Field
          label={action === "assign" ? "Condition at issue" : action === "return" ? "Return notes" : "What happened?"}
          htmlFor="asg-text"
          required
          error={fe.issueCondition ?? fe.returnCondition ?? fe.description}
        >
          <Textarea id="asg-text" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        {action === "damage" && <Notice tone="blue">A review case is created for HR. The portal never deducts loss or damage from pay automatically.</Notice>}
        {action === "assign" && <p className="text-xs text-slate-500">The employee is notified and asked to acknowledge receipt. An asset can have only one active custodian.</p>}
        {cfg.m.error && !Object.keys(fe).length && <InlineError message={cfg.m.error.body.message} />}
      </div>
    </Dialog>
  );
}
