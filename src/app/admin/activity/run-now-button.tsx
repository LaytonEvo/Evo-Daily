"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function RunNowButton({ job }: { job: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);

  async function run() {
    setPending(true);
    const response = await fetch(`/api/admin/jobs/${encodeURIComponent(job)}/run`, { method: "POST" });
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setPending(false);
    if (!response.ok || !body.ok) {
      toast(body.error ?? "The run failed. It's in the log below.", { tone: "error" });
    } else {
      toast("Done. The run is in the log below.");
    }
    router.refresh();
  }

  return (
    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={run}>
      {pending ? "Running…" : "Run now"}
    </Button>
  );
}
