"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Frequency } from "@prisma/client";
import { Copy, Plus, Search, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn, formatRate } from "@/lib/utils";
import { TemplateDrawer } from "./template-drawer";

export type TemplateRow = {
  id: string;
  title: string;
  description: string | null;
  assigneeId: string;
  assigneeName: string;
  categoryId: string | null;
  frequency: Frequency;
  daysOfWeek: number[];
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  dueTime: string | null;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  scheduleLabel: string;
  completionRate: number | null;
  assignedLast30: number;
};

export type Person = { id: string; name: string; isActive: boolean };
export type Category = { id: string; name: string; colour: string; isActive: boolean };

export function TemplatesScreen({
  templates,
  users,
  categories,
}: {
  templates: TemplateRow[];
  users: Person[];
  categories: Category[];
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [assignee, setAssignee] = useState("");
  const [frequency, setFrequency] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("active");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(
    () =>
      templates.filter((t) => {
        if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
        if (assignee && t.assigneeId !== assignee) return false;
        if (frequency && t.frequency !== frequency) return false;
        if (category && t.categoryId !== category) return false;
        if (status === "active" && !t.isActive) return false;
        if (status === "inactive" && t.isActive) return false;
        return true;
      }),
    [templates, search, assignee, frequency, category, status],
  );

  async function patch(id: string, body: Record<string, unknown>, message: string) {
    const response = await fetch(`/api/admin/templates/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      toast(error.error ?? "Could not save that.", { tone: "error" });
      return;
    }
    toast(message);
    router.refresh();
  }

  async function bulkReassign(assigneeId: string) {
    if (selected.size === 0 || !assigneeId) return;
    const response = await fetch("/api/admin/templates/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "reassign",
        templateIds: [...selected],
        assigneeId,
      }),
    });
    if (!response.ok) {
      toast("Could not reassign those.", { tone: "error" });
      return;
    }
    const body = await response.json();
    toast(`${body.reassigned} reassigned. Future instances only.`);
    setSelected(new Set());
    router.refresh();
  }

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <main className="mx-auto w-full max-w-5xl pb-16 pt-2">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {templates.filter((t) => t.isActive).length} active ·{" "}
            {templates.filter((t) => !t.isActive).length} inactive
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          New task
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <div className="relative col-span-2 sm:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Anyone</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <Select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
          <option value="">Any frequency</option>
          <option value={Frequency.DAILY}>Daily</option>
          <option value={Frequency.WEEKLY}>Weekly</option>
          <option value={Frequency.MONTHLY}>Monthly</option>
          <option value={Frequency.ONE_OFF}>One-off</option>
        </Select>
        <Select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Any category</option>
          {/* Retired ones stay listed here on purpose: filtering by one is how
              you find the tasks still sitting on it. */}
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.isActive ? "" : " (turned off)"}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="">All</option>
        </Select>
      </div>

      {selected.size > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{selected.size} selected</span>
          <Select
            className="h-9 w-auto"
            defaultValue=""
            onChange={(e) => void bulkReassign(e.target.value)}
          >
            <option value="">Reassign to…</option>
            {users
              .filter((u) => u.isActive)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </Select>
          <span className="text-xs text-muted-foreground">Future instances only.</span>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm md:min-w-[720px]">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-8 px-1 py-2.5 sm:w-10 sm:px-3" />
                <th className="px-2 py-2.5 sm:px-3 font-medium">Task</th>
                <th className="hidden px-2 py-2.5 sm:px-3 font-medium md:table-cell">Owner</th>
                <th className="hidden px-2 py-2.5 sm:px-3 font-medium md:table-cell">Schedule</th>
                <th className="hidden px-2 py-2.5 sm:px-3 font-medium md:table-cell">Category</th>
                <th className="hidden px-2 py-2.5 sm:px-3 font-medium md:table-cell">30-day rate</th>
                <th className="px-2 py-2.5 sm:px-3 font-medium">Active</th>
                <th className="w-8 px-1 py-2.5 sm:w-10 sm:px-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((template) => {
                const category = categories.find((c) => c.id === template.categoryId);
                return (
                  <tr
                    key={template.id}
                    className={cn(
                      "border-b last:border-0 hover:bg-accent/50",
                      !template.isActive && "opacity-60",
                    )}
                  >
                    <td className="px-1 py-2.5 sm:px-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${template.title}`}
                        className="h-4 w-4"
                        checked={selected.has(template.id)}
                        onChange={() => toggleSelected(template.id)}
                      />
                    </td>
                    <td className="px-2 py-2.5 sm:px-3">
                      <button
                        type="button"
                        className="text-left font-medium hover:underline"
                        onClick={() => setEditing(template)}
                      >
                        {template.title}
                      </button>
                      {template.dueTime ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          by {template.dueTime}
                        </span>
                      ) : null}
                      <span className="block max-w-[52vw] truncate text-xs text-muted-foreground md:hidden">
                        {template.assigneeName} · {template.scheduleLabel}
                      </span>
                    </td>
                    <td className="hidden px-2 py-2.5 sm:px-3 text-muted-foreground md:table-cell">
                      {template.assigneeName}
                    </td>
                    <td className="hidden px-2 py-2.5 sm:px-3 text-muted-foreground md:table-cell">
                      {template.scheduleLabel}
                    </td>
                    <td className="hidden px-2 py-2.5 sm:px-3 md:table-cell">
                      {category ? (
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <span
                            aria-hidden="true"
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: category.colour }}
                          />
                          {category.name}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="hidden px-2 py-2.5 sm:px-3 md:table-cell">
                      <RateCell
                        rate={template.completionRate}
                        assigned={template.assignedLast30}
                      />
                    </td>
                    <td className="px-2 py-2.5 sm:px-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={template.isActive}
                        aria-label={`${template.isActive ? "Deactivate" : "Activate"} ${template.title}`}
                        onClick={() =>
                          void patch(
                            template.id,
                            { isActive: !template.isActive },
                            template.isActive
                              ? "Deactivated. Future instances removed, history kept."
                              : "Activated.",
                          )
                        }
                        className={cn(
                          "relative h-6 w-11 rounded-full transition-colors",
                          template.isActive ? "bg-primary" : "bg-input",
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-150",
                            template.isActive ? "translate-x-[22px]" : "translate-x-0.5",
                          )}
                        />
                      </button>
                    </td>
                    <td className="px-2 py-2.5 sm:px-3">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Duplicate ${template.title}`}
                        onClick={() =>
                          void patch(
                            template.id,
                            { duplicate: true },
                            "Duplicated as an inactive draft.",
                          )
                        }
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}

              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                    No tasks match those filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {creating || editing ? (
        <TemplateDrawer
          template={editing}
          users={users}
          categories={categories}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </main>
  );
}

function RateCell({ rate, assigned }: { rate: number | null; assigned: number }) {
  if (rate === null) {
    return <span className="text-muted-foreground">no data</span>;
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cn(
          "font-medium tabular-nums",
          rate >= 0.9 ? "text-success" : rate >= 0.7 ? "text-warning" : "text-destructive",
        )}
      >
        {formatRate(rate)}
      </span>
      <Badge variant="muted">{assigned}</Badge>
    </span>
  );
}
