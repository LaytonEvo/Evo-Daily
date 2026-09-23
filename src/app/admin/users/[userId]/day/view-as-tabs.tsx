import Link from "next/link";
import { cn } from "@/lib/utils";
import { addDays, todayInLondon } from "@/lib/time";

/**
 * The three things there are to see about somebody: today, the day after, and
 * what anybody has said to them. Shared so the two pages cannot disagree about
 * which of them exists.
 */
export function ViewAsTabs({
  userId,
  current,
}: {
  userId: string;
  current: "today" | "tomorrow" | "messages";
}) {
  const tomorrow = addDays(todayInLondon(), 1);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tab href={`/admin/users/${userId}/day`} active={current === "today"} label="Today" />
      <Tab
        href={`/admin/users/${userId}/day?on=${tomorrow}`}
        active={current === "tomorrow"}
        label="Tomorrow"
      />
      <Tab
        href={`/admin/users/${userId}/messages`}
        active={current === "messages"}
        label="Messages"
      />
    </div>
  );
}

function Tab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-card hover:bg-accent",
      )}
    >
      {label}
    </Link>
  );
}
