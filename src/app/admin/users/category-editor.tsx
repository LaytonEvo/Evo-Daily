"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export type Category = {
  id: string;
  name: string;
  colour: string;
  isActive: boolean;
  templateCount: number;
  instanceCount: number;
};

/** A spread wide enough to tell five or six areas apart at a 10px dot. */
const SWATCHES = [
  "#2563eb",
  "#0891b2",
  "#059669",
  "#65a30d",
  "#d97706",
  "#dc2626",
  "#e11d48",
  "#c026d3",
  "#7c3aed",
  "#4f46e5",
];

/** Anything referencing a category means it can be retired but not removed. */
function inUse(category: Category): boolean {
  return category.templateCount > 0 || category.instanceCount > 0;
}

export function CategoryEditor({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const { toast } = useToast();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send(
    url: string,
    method: "POST" | "PATCH" | "DELETE",
    body: Record<string, unknown> | null,
    success: string,
  ): Promise<boolean> {
    setBusy(true);
    try {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        toast(payload.error ?? "Could not save that.", { tone: "error" });
        return false;
      }
      toast(success);
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Categories</CardTitle>
          <CardDescription>
            Group tasks, and show which area of the business is slipping. Renaming one applies
            everywhere, including past reports.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => setAdding(true)} disabled={adding}>
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </CardHeader>

      <CardContent>
        <ul className="flex flex-col divide-y">
          {categories.map((category) =>
            editingId === category.id ? (
              <li key={category.id} className="py-3">
                <CategoryForm
                  initial={category}
                  busy={busy}
                  onCancel={() => setEditingId(null)}
                  onSubmit={async (values) => {
                    const ok = await send(
                      `/api/admin/categories/${category.id}`,
                      "PATCH",
                      values,
                      "Category updated.",
                    );
                    if (ok) setEditingId(null);
                  }}
                />
              </li>
            ) : (
              <li key={category.id} className="flex items-center gap-3 py-2.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-3 w-3 shrink-0 rounded-full",
                    !category.isActive && "opacity-40",
                  )}
                  style={{ backgroundColor: category.colour }}
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm font-medium",
                    !category.isActive && "text-muted-foreground line-through",
                  )}
                >
                  {category.name}
                </span>

                {!category.isActive ? <Badge variant="muted">Off</Badge> : null}

                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {inUse(category)
                    ? `${category.templateCount} task${category.templateCount === 1 ? "" : "s"}`
                    : "unused"}
                </span>

                <button
                  type="button"
                  role="switch"
                  aria-checked={category.isActive}
                  aria-label={`${category.isActive ? "Turn off" : "Turn on"} ${category.name}`}
                  disabled={busy}
                  onClick={() =>
                    void send(
                      `/api/admin/categories/${category.id}`,
                      "PATCH",
                      { isActive: !category.isActive },
                      category.isActive
                        ? `${category.name} turned off. Past reports are unaffected.`
                        : `${category.name} turned back on.`,
                    )
                  }
                  className={cn(
                    "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50",
                    category.isActive ? "bg-primary" : "bg-input",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform duration-150",
                      category.isActive ? "translate-x-[18px]" : "translate-x-0.5",
                    )}
                  />
                </button>

                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${category.name}`}
                  onClick={() => {
                    setAdding(false);
                    setEditingId(category.id);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>

                {/* Offering delete on a category in use would only ever fail.
                    The server still refuses it either way. */}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${category.name}`}
                  disabled={busy || inUse(category)}
                  title={
                    inUse(category)
                      ? `${category.name} is in use — turn it off instead`
                      : `Delete ${category.name}`
                  }
                  onClick={() =>
                    void send(
                      `/api/admin/categories/${category.id}`,
                      "DELETE",
                      null,
                      `${category.name} deleted.`,
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ),
          )}

          {adding ? (
            <li className="py-3">
              <CategoryForm
                busy={busy}
                onCancel={() => setAdding(false)}
                onSubmit={async (values) => {
                  const ok = await send(
                    "/api/admin/categories",
                    "POST",
                    values,
                    "Category added.",
                  );
                  if (ok) setAdding(false);
                }}
              />
            </li>
          ) : null}
        </ul>

        {categories.length === 0 && !adding ? (
          <p className="py-4 text-sm text-muted-foreground">
            No categories yet. Tasks work fine without them — add some when you want the
            by-area breakdown.
          </p>
        ) : null}

        <p className="mt-4 text-xs text-muted-foreground">
          A category in use can be turned off but not deleted, so past reports keep reading
          correctly. Turning one off only hides it from the task form.
        </p>
      </CardContent>
    </Card>
  );
}

function CategoryForm({
  initial,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: Category;
  busy: boolean;
  onSubmit: (values: { name: string; colour: string }) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [colour, setColour] = useState(initial?.colour ?? SWATCHES[0]);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        void onSubmit({ name: name.trim(), colour });
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          autoFocus
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          placeholder="Category name"
          aria-label="Category name"
          className="h-10 min-w-[12rem] flex-1"
        />
        <Button type="submit" size="sm" disabled={busy || !name.trim()}>
          <Check className="h-4 w-4" />
          {initial ? "Save" : "Add"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <X className="h-4 w-4" />
          Cancel
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SWATCHES.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={`Use colour ${swatch}`}
            aria-pressed={colour.toLowerCase() === swatch.toLowerCase()}
            onClick={() => setColour(swatch)}
            className={cn(
              "h-7 w-7 rounded-full ring-offset-2 ring-offset-card transition-shadow",
              colour.toLowerCase() === swatch.toLowerCase() && "ring-2 ring-ring",
            )}
            style={{ backgroundColor: swatch }}
          />
        ))}
      </div>
    </form>
  );
}
