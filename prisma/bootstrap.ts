/**
 * Bootstrap a real organisation.
 *
 * This is the counterpart to prisma/seed.ts. The seed exists to make the
 * reporting judgeable on day one and fills the database with invented staff
 * and invented history; this creates the real thing and nothing else — the
 * organisation, its categories, and real accounts with no tasks and no history.
 *
 * Recurring tasks are deliberately not created here. They are business
 * knowledge, not something a script should guess, and the admin screen is
 * built to define one in well under a minute.
 *
 * The team is read from the environment rather than committed, so nobody's
 * email address lives in the repository.
 *
 *   BOOTSTRAP_TEAM        JSON array: [{"name":"...","email":"...","role":"ADMIN"}]
 *                         role defaults to MEMBER.
 *   BOOTSTRAP_ORG         Organisation name. Defaults to "Evolution Golf".
 *   BOOTSTRAP_CATEGORIES  Comma-separated names. Defaults to the five below.
 *   BOOTSTRAP_RESET       Must be exactly "true" to delete existing data.
 *
 * Every account is created with a generated password and must change it at
 * first sign-in. The passwords are printed once, here, and never again.
 */

import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { generatePassword } from "../src/lib/generate-password";

const prisma = new PrismaClient();

const DEFAULT_CATEGORIES = [
  { name: "Customer Support", colour: "#2563eb" },
  { name: "Stock", colour: "#d97706" },
  { name: "Marketing", colour: "#7c3aed" },
  { name: "Facilities", colour: "#059669" },
  { name: "Finance", colour: "#dc2626" },
];

const FALLBACK_COLOURS = [
  "#2563eb", "#d97706", "#7c3aed", "#059669", "#dc2626",
  "#0891b2", "#c026d3", "#65a30d", "#e11d48", "#4f46e5",
];

type Person = { name: string; email: string; role: Role };

function parseTeam(): Person[] {
  const raw = process.env.BOOTSTRAP_TEAM;
  if (!raw) {
    throw new Error(
      'BOOTSTRAP_TEAM is not set. Expected JSON, e.g. [{"name":"Layton Brooks","email":"layton@example.com","role":"ADMIN"}]',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("BOOTSTRAP_TEAM is not valid JSON.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("BOOTSTRAP_TEAM must be a non-empty JSON array.");
  }

  const seen = new Set<string>();
  const team = parsed.map((entry, index) => {
    const person = entry as Record<string, unknown>;
    const name = String(person.name ?? "").trim();
    const email = String(person.email ?? "").trim().toLowerCase();
    const role = String(person.role ?? "MEMBER").toUpperCase();

    if (!name) throw new Error(`Person ${index + 1} has no name.`);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new Error(`"${name}" has an invalid email: ${email || "(blank)"}`);
    }
    if (seen.has(email)) throw new Error(`${email} appears twice.`);
    seen.add(email);
    if (role !== "ADMIN" && role !== "MEMBER") {
      throw new Error(`"${name}" has role "${role}"; expected ADMIN or MEMBER.`);
    }

    return { name, email, role: role as Role };
  });

  if (!team.some((p) => p.role === Role.ADMIN)) {
    throw new Error("At least one person must be an ADMIN, or nobody can manage anything.");
  }
  return team;
}

function parseCategories() {
  const raw = process.env.BOOTSTRAP_CATEGORIES;
  if (!raw) return DEFAULT_CATEGORIES;
  return raw
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name, i) => ({ name, colour: FALLBACK_COLOURS[i % FALLBACK_COLOURS.length] }));
}

async function main() {
  const team = parseTeam();
  const categories = parseCategories();
  const orgName = process.env.BOOTSTRAP_ORG?.trim() || "Evolution Golf";

  const existingUsers = await prisma.user.count();
  const existingInstances = await prisma.taskInstance.count();

  if (existingUsers > 0 || existingInstances > 0) {
    if (process.env.BOOTSTRAP_RESET !== "true") {
      throw new Error(
        `Refusing to run: the database already holds ${existingUsers} users and ` +
          `${existingInstances} task instances. Set BOOTSTRAP_RESET=true to delete ` +
          `them and start clean.`,
      );
    }
    console.log(
      `Clearing ${existingUsers} users and ${existingInstances} instances (BOOTSTRAP_RESET=true)`,
    );
  }

  // Dependency order.
  await prisma.auditLog.deleteMany();
  await prisma.taskInstance.deleteMany();
  await prisma.taskTemplate.deleteMany();
  await prisma.category.deleteMany();
  await prisma.settings.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organisation.deleteMany();

  const org = await prisma.organisation.create({
    data: { name: orgName, timezone: "Europe/London" },
  });
  await prisma.settings.create({
    data: { organisationId: org.id, graceDays: 2, generationHorizonDays: 14 },
  });

  for (const [i, category] of categories.entries()) {
    await prisma.category.create({
      data: { organisationId: org.id, ...category, sortOrder: i + 1 },
    });
  }

  const credentials: { name: string; email: string; role: Role; password: string }[] = [];
  for (const person of team) {
    const password = generatePassword();
    await prisma.user.create({
      data: {
        organisationId: org.id,
        name: person.name,
        email: person.email,
        passwordHash: await bcrypt.hash(password, 10),
        role: person.role,
        isActive: true,
        // Nobody keeps a password a script chose for them.
        mustChangePassword: true,
      },
    });
    credentials.push({ ...person, password });
  }

  console.log(`\n${orgName} is ready.`);
  console.log(`  ${team.length} accounts, ${categories.length} categories`);
  console.log(`  0 tasks and 0 history — define real tasks in Tasks → New task\n`);

  const width = Math.max(...credentials.map((c) => c.email.length));
  console.log("  Sign-in details. Each person must change this at first sign-in:\n");
  for (const c of credentials) {
    console.log(`    ${c.email.padEnd(width)}  ${c.password}  (${c.role.toLowerCase()}) — ${c.name}`);
  }
  console.log("");
}

main()
  .catch((error) => {
    console.error(`\nBootstrap failed: ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
