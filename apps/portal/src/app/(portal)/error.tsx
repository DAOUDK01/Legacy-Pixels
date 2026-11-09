"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button, ButtonLink, Card } from "@/components/ui";

/** Route-level error boundary: never shows stack traces or internal details to the user. */
export default function PortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Card className="mx-auto mt-10 max-w-lg p-8 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-red-500" />
      <h1 className="mt-3 text-lg font-semibold">This screen couldn't load</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Your data is safe. Try again, or go back to the dashboard.</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-slate-400">Reference {error.digest}</p>}
      <div className="mt-5 flex justify-center gap-2">
        <Button icon={<RefreshCw className="h-4 w-4" />} onClick={reset}>Try again</Button>
        <ButtonLink href="/">Dashboard</ButtonLink>
      </div>
    </Card>
  );
}
