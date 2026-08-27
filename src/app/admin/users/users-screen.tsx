"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Role } from "@prisma/client";
import { Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type Person = {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  slackUserId: string | null;
  managerId: string | null;
  mustChangePassword: boolean;
  activeTasks: number;
};

type Category = { id: string; name: string; colour: string };

export function UsersScreen({
  currentUserId,
  users,
  categories,
}: {
  currentUserId: string;
  users: Person[];
  categories: Category[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);

  async function patch(id: string, body: Record<string, unknown>, message: string) {
    const response = await fetch(`/api/admin/users/${id}`, {
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

  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-16 pt-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">People</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {users.filter((u) => u.isActive).length} active. Admins create accounts — there is no
            sign-up.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          Add person
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">Name</th>
                <th className="px-3 py-2.5 font-medium">Email</th>
                <th className="px-3 py-2.5 font-medium">Role</th>
                <th className="px-3 py-2.5 text-right font-medium">Active tasks</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="w-20 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {users.map((person) => (
                <tr
                  key={person.id}
                  className={cn("border-b last:border-0", !person.isActive && "opacity-60")}
                >
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/admin/reports/${person.id}`}
                      className="font-medium hover:underline"
                    >
                      {person.name}
                    </Link>
                    {person.mustChangePassword ? (
                      <Badge variant="muted" className="ml-2">
                        password not set
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{person.email}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant={person.role === Role.ADMIN ? "default" : "muted"}>
                      {person.role === Role.ADMIN ? "Admin" : "Member"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{person.activeTasks}</td>
                  <td className="px-3 py-2.5">
                    {person.isActive ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="muted">Deactivated</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(person)}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Categories</CardTitle>
          <CardDescription>
            Used to group tasks and to show which area of the business is slipping.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <span
                key={category.id}
                className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm"
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: category.colour }}
                />
                {category.name}
              </span>
            ))}
            {categories.length === 0 ? (
              <p className="text-sm text-muted-foreground">No categories yet.</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {creating || editing ? (
        <PersonDrawer
          person={editing}
          people={users}
          currentUserId={currentUserId}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            router.refresh();
          }}
          onPatch={patch}
        />
      ) : null}
    </main>
  );
}

function PersonDrawer({
  person,
  people,
  currentUserId,
  onClose,
  onSaved,
  onPatch,
}: {
  person: Person | null;
  people: Person[];
  currentUserId: string;
  onClose: () => void;
  onSaved: () => void;
  onPatch: (id: string, body: Record<string, unknown>, message: string) => Promise<void>;
}) {
  const [name, setName] = useState(person?.name ?? "");
  const [email, setEmail] = useState(person?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(person?.role ?? Role.MEMBER);
  const [isActive, setIsActive] = useState(person?.isActive ?? true);
  const [slackUserId, setSlackUserId] = useState(person?.slackUserId ?? "");
  const [managerId, setManagerId] = useState(person?.managerId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const isSelf = person?.id === currentUserId;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    if (person) {
      await onPatch(
        person.id,
        {
          name,
          role,
          isActive,
          slackUserId: slackUserId || null,
          managerId: managerId || null,
          ...(password ? { password } : {}),
        },
        password ? "Saved. They will set a new password at next sign-in." : "Saved.",
      );
      setPending(false);
      onSaved();
      return;
    }

    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        password,
        role,
        slackUserId: slackUserId || null,
        managerId: managerId || null,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error ?? "Could not create that account.");
      setPending(false);
      return;
    }

    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={person ? "Edit person" : "Add person"}
        className="relative flex h-full w-full max-w-md flex-col bg-card shadow-xl"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">{person ? "Edit person" : "Add person"}</h2>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="name" className="text-sm font-medium">
                Name
              </label>
              <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <Input
                id="email"
                type="email"
                required
                disabled={Boolean(person)}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {person ? (
                <p className="text-xs text-muted-foreground">
                  Email is the sign-in identity and cannot be changed here.
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-sm font-medium">
                {person ? "Reset password" : "Temporary password"}
                {person ? (
                  <span className="ml-1 font-normal text-muted-foreground">optional</span>
                ) : null}
              </label>
              <Input
                id="password"
                type="text"
                required={!person}
                minLength={10}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 10 characters"
              />
              <p className="text-xs text-muted-foreground">
                They will be forced to change it on their next sign-in.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="role" className="text-sm font-medium">
                Role
              </label>
              <Select
                id="role"
                value={role}
                disabled={isSelf}
                onChange={(e) => setRole(e.target.value as Role)}
              >
                <option value={Role.MEMBER}>Member — their own tasks only</option>
                <option value={Role.ADMIN}>Admin — everything</option>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="manager" className="text-sm font-medium">
                Manager
                <span className="ml-1 font-normal text-muted-foreground">optional</span>
              </label>
              <Select id="manager" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                <option value="">None</option>
                {people
                  .filter((p) => p.id !== person?.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Used for miss alerts once Slack is switched on.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="slack" className="text-sm font-medium">
                Slack member ID
                <span className="ml-1 font-normal text-muted-foreground">optional</span>
              </label>
              <Input
                id="slack"
                value={slackUserId}
                onChange={(e) => setSlackUserId(e.target.value)}
                placeholder="U01ABCDEF"
              />
            </div>

            {person ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  disabled={isSelf}
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                Active
                {isSelf ? (
                  <span className="text-xs text-muted-foreground">
                    You cannot deactivate yourself.
                  </span>
                ) : null}
              </label>
            ) : null}

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex gap-2 border-t px-4 py-3 safe-bottom">
            <Button type="submit" className="flex-1" disabled={pending}>
              {pending ? "Saving…" : person ? "Save changes" : "Create account"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
