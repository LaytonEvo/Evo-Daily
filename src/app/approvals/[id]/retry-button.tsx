"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function RetryButton({ id }: { id: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const response = await fetch(`/api/approvals/${id}/retry`, { method: "POST" });
        const body = (await response.json().catch(() => ({}))) as { error?: string; executionStatus?: string };
        setPending(false);
        if (!response.ok) toast(body.error ?? "Retry failed.", { tone: "error" });
        else toast(body.executionStatus === "success" ? "Carried out." : "It failed again.", { tone: body.executionStatus === "success" ? "default" : "error" });
        router.refresh();
      }}
    >
      {pending ? "Retrying…" : "Try the action again"}
    </Button>
  );
}
