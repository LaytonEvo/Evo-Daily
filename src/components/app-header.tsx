import Link from "next/link";
import { Role } from "@prisma/client";
import { SignOutButton } from "./sign-out-button";
import type { SessionUser } from "@/lib/guards";
import { cn } from "@/lib/utils";

/** One thin bar. Members get no navigation at all — they have one screen. */
export function AppHeader({ user, active }: { user: SessionUser; active?: string }) {
  const isAdmin = user.role === Role.ADMIN;

  const links = isAdmin
    ? [
        { href: "/my-day", label: "My day", key: "my-day" },
        { href: "/admin/templates", label: "Tasks", key: "templates" },
        { href: "/admin/reports", label: "Reports", key: "reports" },
        { href: "/admin/users", label: "People", key: "users" },
      ]
    : [];

  return (
    <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-4 px-4">
        <Link href="/my-day" className="font-bold tracking-tight">
          EvoTasks
        </Link>

        {links.length > 0 ? (
          <nav className="flex items-center gap-1 overflow-x-auto text-sm">
            {links.map((link) => (
              <Link
                key={link.key}
                href={link.href}
                className={cn(
                  "rounded-md px-2.5 py-1.5 font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
                  active === link.key && "bg-accent text-foreground",
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
