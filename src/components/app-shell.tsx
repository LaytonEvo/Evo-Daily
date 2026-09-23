"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Role } from "@prisma/client";
import { CalendarCheck, LayoutGrid, Menu, MessageSquare, Repeat, Users, X } from "lucide-react";
import { SignOutButton } from "./sign-out-button";
import { ThemeToggle } from "./theme-toggle";
import type { SessionUser } from "@/lib/guards";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  key: string;
  icon: typeof LayoutGrid;
  /** Shows the unread message count when there is one. */
  badge?: boolean;
};

const MESSAGES: NavItem = {
  href: "/messages",
  label: "Messages",
  key: "messages",
  icon: MessageSquare,
  badge: true,
};

const ADMIN_NAV: NavItem[] = [
  { href: "/my-day", label: "My day", key: "my-day", icon: CalendarCheck },
  { href: "/admin/templates", label: "Tasks", key: "templates", icon: Repeat },
  { href: "/admin/reports", label: "Reports", key: "reports", icon: LayoutGrid },
  { href: "/admin/users", label: "People", key: "users", icon: Users },
  MESSAGES,
];

/**
 * Members used to have no navigation at all: one screen, so a sidebar holding
 * a single link would have been furniture. A second screen changes that, and
 * two links are worth a sidebar when one of them carries a count somebody is
 * waiting on.
 */
const MEMBER_NAV: NavItem[] = [
  { href: "/my-day", label: "My day", key: "my-day", icon: CalendarCheck },
  MESSAGES,
];

/**
 * Horizon's shell: a fixed sidebar alongside the content on desktop, the same
 * sidebar as a slide-in drawer on a phone.
 */
export function AppShell({
  user,
  active,
  title,
  children,
}: {
  user: SessionUser;
  active?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const nav = user.role === Role.ADMIN ? ADMIN_NAV : MEMBER_NAV;
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();

  // A drawer that survives the navigation it triggered would cover the page
  // it just opened.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const hasNav = nav.length > 0;

  return (
    <div className="min-h-dvh">
      {hasNav ? (
        <>
          <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-sidebar px-5 py-7 shadow-card xl:flex">
            <SidebarBody nav={nav} active={active} unread={unread} />
          </aside>

          {open ? (
            <div className="fixed inset-0 z-50 xl:hidden">
              <div
                className="absolute inset-0 bg-foreground/40 animate-fade-in"
                onClick={() => setOpen(false)}
                aria-hidden
              />
              <aside
                role="dialog"
                aria-modal="true"
                aria-label="Menu"
                className="relative flex h-full w-72 max-w-[85vw] flex-col bg-sidebar px-5 py-7 animate-slide-in-left"
              >
                <button
                  type="button"
                  aria-label="Close menu"
                  onClick={() => setOpen(false)}
                  className="absolute right-4 top-6 rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <X className="h-5 w-5" />
                </button>
                <SidebarBody
                  nav={nav}
                  active={active}
                  unread={unread}
                  onNavigate={() => setOpen(false)}
                />
              </aside>
            </div>
          ) : null}
        </>
      ) : null}

      <div className={cn(hasNav && "xl:pl-64")}>
        <header className="sticky top-0 z-30 bg-background/95 backdrop-blur-xl">
          <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
            {hasNav ? (
              <button
                type="button"
                aria-label="Open menu"
                aria-expanded={open}
                onClick={() => setOpen(true)}
                className="relative -ml-1 rounded-xl p-2 text-foreground hover:bg-accent hover:text-accent-foreground xl:hidden"
              >
                <Menu className="h-6 w-6" />
                {/* On a phone the sidebar is behind this button, so the count
                    has to be on the button or nobody sees it. */}
                {unread > 0 ? (
                  <span
                    aria-hidden="true"
                    className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background"
                  />
                ) : null}
              </button>
            ) : null}

            <div className="min-w-0">
              {hasNav ? (
                <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">
                  {title ?? "EvoTasks"}
                </h1>
              ) : (
                <Link href="/my-day" className="text-xl font-bold tracking-tight">
                  EvoTasks
                </Link>
              )}
            </div>

            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle />
              <SignOutButton />
            </div>
          </div>
        </header>

        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">{children}</div>
      </div>
    </div>
  );
}

function SidebarBody({
  nav,
  active,
  unread,
  onNavigate,
}: {
  nav: NavItem[];
  active?: string;
  unread: number;
  onNavigate?: () => void;
}) {
  return (
    <>
      <Link
        href="/my-day"
        onClick={onNavigate}
        className="mb-8 block px-2 text-2xl font-bold tracking-tight"
      >
        Evo<span className="text-primary">Tasks</span>
      </Link>

      <nav className="flex flex-col gap-1">
        {nav.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.key;
          return (
            <Link
              key={item.key}
              href={item.href}
              onClick={onNavigate}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                isActive && "bg-accent font-bold text-accent-foreground",
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {item.label}
              {item.badge && unread > 0 ? (
                <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
                  {unread > 99 ? "99+" : unread}
                </span>
              ) : null}
              {isActive ? (
                <span className="absolute inset-y-2 right-0 w-1 rounded-full bg-primary" />
              ) : null}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

/**
 * The unread count, polled rather than rendered once.
 *
 * A reply can land while somebody is sitting on a screen, and a number
 * rendered at request time goes stale exactly when it matters. Also refreshed
 * when the tab regains focus, which covers the common case of replying on a
 * phone and coming back to the laptop.
 */
function useUnreadCount(): number {
  const [unread, setUnread] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;

    const read = async () => {
      try {
        const response = await fetch("/api/me/unread");
        if (!response.ok) return;
        const body = (await response.json()) as { unread?: number };
        if (!cancelled) setUnread(body.unread ?? 0);
      } catch {
        // A badge is not worth a visible failure.
      }
    };

    void read();
    const timer = setInterval(read, 60_000);
    const onFocus = () => void read();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [pathname]);

  return unread;
}
