"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteClient } from "@/lib/server-actions/clients";

export function DeleteClientButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button
        variant="destructive"
        size="sm"
        onClick={() => setConfirming(true)}
      >
        🗑 Delete client
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
      <span className="text-sm text-destructive font-medium">
        Delete <code className="font-mono">{clientId}</code> and all their sessions/files? This cannot be undone.
      </span>
      <Button
        variant="destructive"
        size="sm"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            const res = await deleteClient(clientId);
            if (res.ok) {
              toast.success(`Deleted ${clientId}`);
              router.push("/clients");
            } else {
              toast.error(res.error);
              setConfirming(false);
            }
          });
        }}
      >
        {pending ? "Deleting…" : "Yes, delete"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => setConfirming(false)}
      >
        Cancel
      </Button>
    </div>
  );
}
