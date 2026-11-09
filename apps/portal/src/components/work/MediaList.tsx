"use client";

import { useState } from "react";
import { Download, Eye, FileArchive, FileImage, FileText, FileVideo, File as FileIcon, Trash2, AlertTriangle } from "lucide-react";
import type { MediaAsset } from "@/lib/types";
import { api, errorMessage } from "@/lib/api/transport";
import { fmtBytes } from "@/lib/time";
import { Button, Dialog, Progress, cn } from "@/components/ui";
import { StateBadge } from "@/components/domain";
import { useToast } from "@/components/ui/toast";

export function fileIcon(mime: string) {
  if (mime.startsWith("image/")) return FileImage;
  if (mime.startsWith("video/")) return FileVideo;
  if (mime.includes("zip")) return FileArchive;
  if (mime === "application/pdf" || mime.startsWith("text/") || mime.includes("json")) return FileText;
  return FileIcon;
}

const PENDING = ["INITIATED", "RECEIVING", "SCANNING", "TRANSFERRING"];

export function MediaList({ media, onRemove, compact, highlight }: { media: MediaAsset[]; onRemove?: (id: string) => void; compact?: boolean; highlight?: Set<string> }) {
  const [preview, setPreview] = useState<{ media: MediaAsset; ticket: string; expiresAt: string; disposition: string } | null>(null);
  const toast = useToast();
  if (!media.length) return <p className="text-sm text-slate-500">No files.</p>;
  const open = async (m: MediaAsset) => {
    try {
      const r = await api.get<{ media: MediaAsset; ticket: string; expiresAt: string; disposition: string }>(`/media/${m.id}/content`);
      setPreview(r);
    } catch (e) {
      toast({ tone: "error", title: "Can't open file", body: errorMessage(e) });
    }
  };
  return (
    <>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {media.map((m) => {
          const Icon = fileIcon(m.mimeType);
          const pending = PENDING.includes(m.state);
          return (
            <li key={m.id} className={cn("flex flex-wrap items-center gap-3 px-3", compact ? "py-2" : "py-2.5", highlight?.has(m.id) && "bg-amber-50/60 dark:bg-amber-950/20")}>
              <Icon className="h-5 w-5 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1 basis-40">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{m.name}</p>
                <p className="text-xs text-slate-500">
                  {fmtBytes(m.sizeBytes)}
                  {m.sha256 && <span className="ml-2 font-mono" title="SHA-256 (independently computed)">sha256 {m.sha256.slice(0, 10)}…</span>}
                  {highlight?.has(m.id) && <span className="ml-2 text-amber-700">changed in this version</span>}
                </p>
                {pending && m.progress !== undefined && <div className="mt-1.5 max-w-xs"><Progress value={(m.progress ?? 0) * 100} label={`${m.name} progress`} /></div>}
                {m.lastError && <p className="mt-1 flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="h-3 w-3" /> {m.lastError}</p>}
              </div>
              <StateBadge state={m.state} />
              {m.state === "AVAILABLE" && (
                <Button size="sm" variant="ghost" icon={/^image\/|pdf/.test(m.mimeType) ? <Eye className="h-4 w-4" /> : <Download className="h-4 w-4" />} onClick={() => open(m)}>
                  {/^image\/|pdf/.test(m.mimeType) ? "Preview" : "Download"}
                </Button>
              )}
              {onRemove && (
                <Button size="icon" variant="ghost" aria-label={`Remove ${m.name}`} onClick={() => onRemove(m.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <Dialog open={!!preview} onClose={() => setPreview(null)} title={preview?.media.name ?? ""} description="Streamed through the portal with a short-lived, audience-bound ticket. No public Drive link is ever created." size="lg">
        {preview && (
          <div className="space-y-3">
            {preview.disposition === "inline-sandboxed" ? (
              <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-slate-300 bg-[repeating-linear-gradient(45deg,#f8fafc,#f8fafc_10px,#f1f5f9_10px,#f1f5f9_20px)] text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900">
                Sandboxed preview of {preview.media.name}
              </div>
            ) : (
              <p className="text-sm text-slate-600">This file type is downloaded rather than rendered inline (active content is never previewed).</p>
            )}
            <p className="font-mono text-xs text-slate-500">Ticket {preview.ticket} · expires {new Date(preview.expiresAt).toLocaleTimeString()}</p>
          </div>
        )}
      </Dialog>
    </>
  );
}
