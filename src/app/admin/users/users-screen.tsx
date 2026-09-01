"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Role } from "@prisma/client";
import { Check, Copy, Plus, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { CategoryEditor, type Category } from "./category-editor";
import { cn } from "@/lib/utils";
import { generatePassword } from "@/lib/generate-password";

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
    <main className="mx-auto w-full max-w-4xl pb-16 pt-2">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
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
          <table className="w-full text-sm sm:min-w-[640px]">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-2 py-2.5 sm:px-3 font-medium">Name</th>
                <th className="hidden px-2 py-2.5 sm:px-3 font-medium sm:table-cell">Email</th>
                <th className="px-2 py-2.5 sm:px-3 font-medium">Role</th>
                <th className="hidden px-2 py-2.5 sm:px-3 text-right font-medium sm:table-cell">Active tasks</th>
                <th className="px-2 py-2.5 sm:px-3 font-medium">Status</th>
                <th className="w-12 px-2 py-2.5 sm:w-20 sm:px-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((person) => (
                <tr
                  key={person.id}
                  className={cn("border-b last:border-0", !person.isActive && "opacity-60")}
                >
                  <td className="max-w-[42vw] px-2 py-2.5 sm:max-w-none sm:px-3">
                    <Link
                      href={`/admin/reports/${person.id}`}
                      className="block max-w-[46vw] truncate font-medium hover:underline sm:max-w-none"
                    >
                      {person.name}
                    </Link>
                    <span className="block max-w-[46vw] truncate text-xs font-normal text-muted-foreground sm:hidden">
                      {person.email}
                    </span>
                    {person.mustChangePassword ? (
                      <Badge variant="muted" className="mt-1 sm:ml-2 sm:mt-0">
                        <span className="sm:hidden">no password</span>
                        <span className="hidden sm:inline">password not set</span>
                      </Badge>
                    ) : null}
                  </td>
                  <td className="hidden px-2 py-2.5 sm:px-3 text-muted-foreground sm:table-cell">{person.email}</td>
                  <td className="px-2 py-2.5 sm:px-3">
                    <Badge variant={person.role === Role.ADMIN ? "default" : "muted"}>
                      {person.role === Role.ADMIN ? "Admin" : "Member"}
                    </Badge>
                  </td>
                  <td className="hidden px-2 py-2.5 sm:px-3 text-right tabular-nums sm:table-cell">
                    {person.activeTasks}
                  </td>
                  <td className="px-2 py-2.5 sm:px-3">
                    {person.isActive ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="muted">Deactivated</Badge>
                    )}
                  </td>
                  <td className="px-2 py-2.5 sm:px-3 text-right">
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

      <CategoryEditor categories={categories} />

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
  const [password, setPassword] = useState(() => (person ? "" : generatePassword()));
  const [copied, setCopied] = useState(false);
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
              <div className="flex gap-2">
                <Input
                  id="password"
                  type="text"
                  required={!person}
                  minLength={10}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 10 characters"
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  aria-label="Generate a password"
                  title="Generate a password"
                  onClick={() => {
                    setPassword(generatePassword());
                    setCopied(false);
                  }}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  aria-label="Copy password"
                  title="Copy password"
                  disabled={!password}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(password);
                      setCopied(true);
                    } catch {
                      // Clipboard access can be refused; the field is plain
                      // text and selectable, so there is always a way through.
                      setCopied(false);
                    }
                  }}
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-success" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {copied
                  ? "Copied. Send it to them however you normally would."
                  : "Send this to them — they will be forced to change it at first sign-in."}
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
