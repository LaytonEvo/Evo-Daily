/**
 * Evo Ops Hub: the modules that sit around Tasks, and who can see them.
 *
 * Roles stay deliberately small. ADMIN sees everything. MANAGER and MEMBER
 * get their own day plus whatever modules an admin grants them by name, so
 * "Katy: Finance only" is a manager with ["finance"]. Inside Tasks a MANAGER
 * is treated exactly as a MEMBER: every Tasks check is `role === ADMIN`.
 *
 * A module that isn't built yet is hidden from everyone, and its routes 404.
 */

import { Role } from "@prisma/client";

export const HUB_MODULES = [
  { key: "approvals", label: "Approvals", href: "/approvals", built: true },
  { key: "email", label: "Email", href: "/email", built: false },
  { key: "tiktok", label: "TikTok", href: "/tiktok", built: false },
  { key: "finance", label: "Finance", href: "/finance", built: false },
  { key: "reporting", label: "Reporting", href: "/reporting", built: false },
  { key: "activity", label: "Activity", href: "/admin/activity", built: true },
  { key: "health", label: "Health", href: "/admin/health", built: true },
] as const;

export type HubModuleKey = (typeof HUB_MODULES)[number]["key"];

/** Modules an admin can grant to a manager or member. Approvals is for everyone. */
export const GRANTABLE_MODULES = ["email", "tiktok", "finance", "reporting", "activity"] as const;

export type GrantableModule = (typeof GRANTABLE_MODULES)[number];

export function moduleLabel(key: string): string {
  return HUB_MODULES.find((m) => m.key === key)?.label ?? key;
}

export function isGrantableModule(value: string): value is GrantableModule {
  return (GRANTABLE_MODULES as readonly string[]).includes(value);
}

type Viewer = { role: Role; moduleAccess: string[] };

export function canAccessModule(viewer: Viewer, module: HubModuleKey): boolean {
  if (viewer.role === Role.ADMIN) return true;
  if (module === "approvals") return true;
  // Health is the hub owner's page, which comes with Activity access.
  if (module === "health") return viewer.moduleAccess.includes("activity");
  return viewer.moduleAccess.includes(module);
}

/** The hub modules to show in someone's nav: built, and theirs to see. */
export function hubNavFor(viewer: Viewer) {
  return HUB_MODULES.filter((m) => m.built && canAccessModule(viewer, m.key));
}

export const ROLE_LABELS: Record<Role, string> = {
  [Role.ADMIN]: "Admin",
  [Role.MANAGER]: "Manager",
  [Role.MEMBER]: "Member",
};

/** Where a module-raised task links back to. */
export function sourceHref(source: { sourceModule: string | null; sourceRef: string | null }): string | null {
  if (!source.sourceModule || !source.sourceRef) return null;
  if (source.sourceRef.startsWith("/")) return source.sourceRef;
  return `/${source.sourceModule}/${encodeURIComponent(source.sourceRef)}`;
}
