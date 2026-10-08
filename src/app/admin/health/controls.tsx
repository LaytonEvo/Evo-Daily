"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

async function post(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as { error?: string; href?: string };
  return { ok: response.ok, ...json };
}

export function AutomationSwitch({ module, label, enabled }: { module: string; label: string; enabled: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`${label} automation`}
      disabled={pending}
      onClick={async () => {
        const reason = window.prompt(
          enabled ? `Why are you pausing ${label} automation?` : `Turning ${label} automation back on. Any note?`,
        );
        if (reason === null) return;
        setPending(true);
        const r = await post("/api/admin/hub/automation", { module, enabled: !enabled, reason });
        setPending(false);
        if (!r.ok) toast(r.error ?? "Could not change it.", { tone: "error" });
        router.refresh();
      }}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? "bg-success" : "bg-muted-foreground/40"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "left-[22px]" : "left-0.5"}`}
      />
    </button>
  );
}

export function OwnerPicker({ people, current }: { people: { id: string; name: string }[]; current: string | null }) {
  const router = useRouter();
  const { toast } = useToast();
  return (
    <select
      defaultValue={current ?? ""}
      onChange={async (e) => {
        const r = await post("/api/admin/hub/owner", { userId: e.target.value });
        toast(r.ok ? "Hub owner updated." : (r.error ?? "Could not change it."), r.ok ? undefined : { tone: "error" });
        router.refresh();
      }}
      className="rounded-md border bg-background px-3 py-2 text-sm"
    >
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

export function TestButtons() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const run = async (kind: "approval" | "task") => {
    setPending(kind);
    const r = await post("/api/admin/hub/test", { kind });
    setPending(null);
    if (!r.ok) toast(r.error ?? "That failed.", { tone: "error" });
    else if (r.href) router.push(r.href);
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" disabled={!!pending} onClick={() => run("approval")}>
        {pending === "approval" ? "Sending…" : "Send me a test approval"}
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={!!pending} onClick={() => run("task")}>
        {pending === "task" ? "Raising…" : "Raise a test task for me"}
      </Button>
    </div>
  );
}
