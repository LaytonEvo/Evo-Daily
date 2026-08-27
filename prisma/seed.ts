/**
 * Seed a working Evolution Golf organisation.
 *
 * The point of the backdated history is that the reporting can be judged on
 * day one against data that looks like real operational behaviour — some
 * people reliable, some slipping, some tasks that nobody ever does — rather
 * than against an empty database or a uniform 90%.
 */

import { Frequency, InstanceStatus, PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { dueDatesFor, type Schedule } from "../src/lib/recurrence";
import {
  addDays,
  compareDateOnly,
  dueAtFor,
  toDbDate,
  todayInLondon,
} from "../src/lib/time";

const prisma = new PrismaClient();

const HISTORY_DAYS = 45;
const FUTURE_DAYS = 14;
const DEFAULT_PASSWORD = process.env.SEED_DEFAULT_PASSWORD || "ChangeMe123!";

/** Deterministic PRNG, so re-seeding produces the same history every time. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const random = makeRandom(20260827);

async function main() {
  const today = todayInLondon();
  const historyStart = addDays(today, -HISTORY_DAYS);

  console.log(`Seeding Evolution Golf — today is ${today} (Europe/London)`);

  // Wipe in dependency order so the seed is re-runnable.
  await prisma.auditLog.deleteMany();
  await prisma.taskInstance.deleteMany();
  await prisma.taskTemplate.deleteMany();
  await prisma.category.deleteMany();
  await prisma.settings.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organisation.deleteMany();

  const org = await prisma.organisation.create({
    data: { name: "Evolution Golf", timezone: "Europe/London" },
  });

  await prisma.settings.create({
    data: { organisationId: org.id, graceDays: 2, generationHorizonDays: 14 },
  });

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  const people = [
    { key: "layton", name: "Layton Brooks", email: "layton@evolutiongolf.co.uk", role: Role.ADMIN, reliability: 0.94 },
    { key: "luke", name: "Luke Harding", email: "luke@evolutiongolf.co.uk", role: Role.ADMIN, reliability: 0.9 },
    { key: "karin", name: "Karin Vaughan", email: "karin@evolutiongolf.co.uk", role: Role.ADMIN, reliability: 0.92 },
    { key: "sam", name: "Sam Whitfield", email: "sam@evolutiongolf.co.uk", role: Role.MEMBER, reliability: 0.88 },
    { key: "priya", name: "Priya Raman", email: "priya@evolutiongolf.co.uk", role: Role.MEMBER, reliability: 0.96 },
    { key: "dan", name: "Dan Okoye", email: "dan@evolutiongolf.co.uk", role: Role.MEMBER, reliability: 0.71 },
    { key: "chloe", name: "Chloe Bennett", email: "chloe@evolutiongolf.co.uk", role: Role.MEMBER, reliability: 0.83 },
    { key: "marek", name: "Marek Nowak", email: "marek@evolutiongolf.co.uk", role: Role.MEMBER, reliability: 0.62 },
    { key: "hannah", name: "Hannah Doyle", email: "hannah@evolutiongolf.co.uk", role: Role.MEMBER, reliability: 0.79 },
  ];

  const users: Record<string, { id: string; reliability: number }> = {};
  for (const person of people) {
    const created = await prisma.user.create({
      data: {
        organisationId: org.id,
        email: person.email,
        name: person.name,
        passwordHash,
        role: person.role,
        // Admins are seeded ready to sign in; members are forced to set their
        // own password on first login.
        mustChangePassword: person.role !== Role.ADMIN,
      },
    });
    users[person.key] = { id: created.id, reliability: person.reliability };
  }

  // Everyone reports to Layton for the Phase 3 miss alerts.
  await prisma.user.updateMany({
    where: { organisationId: org.id, id: { not: users.layton.id } },
    data: { managerId: users.layton.id },
  });

  const categoryDefs = [
    { name: "Customer Support", colour: "#2563eb", sortOrder: 1 },
    { name: "Stock", colour: "#d97706", sortOrder: 2 },
    { name: "Marketing", colour: "#7c3aed", sortOrder: 3 },
    { name: "Facilities", colour: "#059669", sortOrder: 4 },
    { name: "Finance", colour: "#dc2626", sortOrder: 5 },
  ];
  const categories: Record<string, string> = {};
  for (const def of categoryDefs) {
    const created = await prisma.category.create({
      data: { organisationId: org.id, ...def },
    });
    categories[def.name] = created.id;
  }

  type TemplateSeed = {
    title: string;
    description?: string;
    category: string;
    assignee: string;
    frequency: Frequency;
    daysOfWeek?: number[];
    dayOfWeek?: number;
    dayOfMonth?: number;
    dueTime?: string;
    /** Multiplier on the assignee's reliability — some tasks just get skipped. */
    difficulty?: number;
    startOffset?: number;
  };

  const templateSeeds: TemplateSeed[] = [
    {
      title: "Clear the support inbox",
      description: "Every email answered or assigned. Nothing older than 24 hours left sitting.",
      category: "Customer Support",
      assignee: "priya",
      frequency: Frequency.DAILY,
      daysOfWeek: [1, 2, 3, 4, 5],
      dueTime: "10:00",
    },
    {
      title: "Answer overnight website enquiries",
      category: "Customer Support",
      assignee: "chloe",
      frequency: Frequency.DAILY,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      dueTime: "11:00",
      difficulty: 0.95,
    },
    {
      title: "Call back yesterday's missed calls",
      category: "Customer Support",
      assignee: "hannah",
      frequency: Frequency.DAILY,
      daysOfWeek: [1, 2, 3, 4, 5],
      dueTime: "12:00",
      difficulty: 0.9,
    },
    {
      title: "Check simulator bay bookings for today",
      description: "Confirm every booking has a bay assigned and staff cover.",
      category: "Facilities",
      assignee: "sam",
      frequency: Frequency.DAILY,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      dueTime: "09:00",
    },
    {
      title: "Wipe down and reset the fitting studio",
      category: "Facilities",
      assignee: "marek",
      frequency: Frequency.DAILY,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      dueTime: "18:00",
      // The task nobody does. This is what the Problem Tasks panel is for.
      difficulty: 0.45,
    },
    {
      title: "Record range ball stock level",
      category: "Stock",
      assignee: "marek",
      frequency: Frequency.DAILY,
      daysOfWeek: [1, 3, 5],
      difficulty: 0.8,
    },
    {
      title: "Pick and pack web orders",
      category: "Stock",
      assignee: "dan",
      frequency: Frequency.DAILY,
      daysOfWeek: [1, 2, 3, 4, 5],
      dueTime: "15:00",
    },
    {
      title: "Post to Instagram and Facebook",
      description: "One post minimum. Lesson clips, fitting results or stock arrivals.",
      category: "Marketing",
      assignee: "chloe",
      frequency: Frequency.DAILY,
      daysOfWeek: [1, 3, 5],
      difficulty: 0.85,
    },
    {
      title: "Weekly stock count — shafts and grips",
      category: "Stock",
      assignee: "dan",
      frequency: Frequency.WEEKLY,
      dayOfWeek: 1,
      dueTime: "17:00",
      difficulty: 0.9,
    },
    {
      title: "Send the weekly lesson availability email",
      category: "Marketing",
      assignee: "chloe",
      frequency: Frequency.WEEKLY,
      dayOfWeek: 4,
      dueTime: "12:00",
    },
    {
      title: "Review last week's completion report",
      description: "Ten minutes before the management meeting. Leaderboard and problem tasks.",
      category: "Finance",
      assignee: "layton",
      frequency: Frequency.WEEKLY,
      dayOfWeek: 1,
      dueTime: "09:00",
    },
    {
      title: "Simulator software update check",
      category: "Facilities",
      assignee: "sam",
      frequency: Frequency.WEEKLY,
      dayOfWeek: 3,
      difficulty: 0.85,
    },
    {
      title: "Reconcile the card machine takings",
      category: "Finance",
      assignee: "karin",
      frequency: Frequency.WEEKLY,
      dayOfWeek: 5,
      dueTime: "16:00",
    },
    {
      title: "Month-end stock reconciliation",
      description: "Full count against the system. Variances written up before it is signed off.",
      category: "Stock",
      assignee: "dan",
      frequency: Frequency.MONTHLY,
      dayOfMonth: 31,
      difficulty: 0.75,
    },
    {
      title: "Submit supplier invoices to the accountant",
      category: "Finance",
      assignee: "karin",
      frequency: Frequency.MONTHLY,
      dayOfMonth: 5,
      dueTime: "17:00",
    },
    {
      title: "Deep clean the driving range mats",
      category: "Facilities",
      assignee: "marek",
      frequency: Frequency.MONTHLY,
      dayOfMonth: 15,
      difficulty: 0.6,
    },
    {
      title: "Review lesson pricing against competitors",
      category: "Marketing",
      assignee: "luke",
      frequency: Frequency.MONTHLY,
      dayOfMonth: 1,
      difficulty: 0.8,
    },
    {
      title: "Chase the TaylorMade rep about the delayed fitting cart",
      category: "Stock",
      assignee: "dan",
      frequency: Frequency.ONE_OFF,
      startOffset: 2,
    },
    {
      title: "Photograph the new Ping stock for the website",
      category: "Marketing",
      assignee: "chloe",
      frequency: Frequency.ONE_OFF,
      startOffset: -6,
    },
  ];

  const templates: { id: string; seed: TemplateSeed; schedule: Schedule }[] = [];

  for (const seed of templateSeeds) {
    const startDate =
      seed.frequency === Frequency.ONE_OFF
        ? addDays(today, seed.startOffset ?? 0)
        : historyStart;

    const created = await prisma.taskTemplate.create({
      data: {
        organisationId: org.id,
        title: seed.title,
        description: seed.description ?? null,
        categoryId: categories[seed.category],
        assigneeId: users[seed.assignee].id,
        frequency: seed.frequency,
        daysOfWeek: seed.daysOfWeek ?? [],
        dayOfWeek: seed.dayOfWeek ?? null,
        dayOfMonth: seed.dayOfMonth ?? null,
        dueTime: seed.dueTime ?? null,
        startDate: toDbDate(startDate),
        endDate: null,
        createdById: users.layton.id,
      },
    });

    templates.push({
      id: created.id,
      seed,
      schedule: {
        frequency: seed.frequency,
        daysOfWeek: seed.daysOfWeek ?? [],
        dayOfWeek: seed.dayOfWeek ?? null,
        dayOfMonth: seed.dayOfMonth ?? null,
        startDate,
        endDate: null,
      },
    });
  }

  // Generate 45 days of history plus the forward horizon, then decide the
  // outcome of everything that is already due.
  const graceDays = 2;
  const hardenBefore = addDays(today, -graceDays); // due before this is MISSED if untouched

  let created = 0;
  let completed = 0;
  let missed = 0;
  let pending = 0;

  for (const template of templates) {
    const dueDates = dueDatesFor(template.schedule, historyStart, addDays(today, FUTURE_DAYS));
    const assignee = users[template.seed.assignee];
    const chance = assignee.reliability * (template.seed.difficulty ?? 1);

    for (const dueDate of dueDates) {
      const dueAt = dueAtFor(dueDate, template.seed.dueTime ?? null);
      const isFuture = compareDateOnly(dueDate, today) > 0;

      let status: InstanceStatus = InstanceStatus.PENDING;
      let completedAt: Date | null = null;
      let wasLate = false;

      if (!isFuture) {
        const roll = random();
        if (roll < chance) {
          status = InstanceStatus.COMPLETED;
          // A fifth of completions land after the cut-off.
          wasLate = random() < 0.2;
          completedAt = wasLate
            ? new Date(dueAt.getTime() + (1 + random() * 8) * 3600 * 1000)
            : new Date(dueAt.getTime() - (1 + random() * 5) * 3600 * 1000);
        } else if (compareDateOnly(dueDate, hardenBefore) < 0) {
          status = InstanceStatus.MISSED;
        }
        // Otherwise it is still inside the grace window: left PENDING, and it
        // will show as Overdue on /my-day. That is the state worth seeing.
      }

      const instance = await prisma.taskInstance.create({
        data: {
          organisationId: org.id,
          templateId: template.id,
          dueDate: toDbDate(dueDate),
          dueAt,
          title: template.seed.title,
          assigneeId: assignee.id,
          categoryId: categories[template.seed.category],
          status,
          completedAt,
          completedById: status === InstanceStatus.COMPLETED ? assignee.id : null,
          wasLate,
        },
      });
      created += 1;

      if (status === InstanceStatus.COMPLETED) {
        completed += 1;
        await prisma.auditLog.create({
          data: {
            organisationId: org.id,
            instanceId: instance.id,
            userId: assignee.id,
            fromStatus: InstanceStatus.PENDING,
            toStatus: InstanceStatus.COMPLETED,
            source: "USER",
            at: completedAt ?? new Date(),
          },
        });
      } else if (status === InstanceStatus.MISSED) {
        missed += 1;
        await prisma.auditLog.create({
          data: {
            organisationId: org.id,
            instanceId: instance.id,
            userId: null,
            fromStatus: InstanceStatus.PENDING,
            toStatus: InstanceStatus.MISSED,
            source: "SYSTEM",
            at: dueAtFor(addDays(dueDate, graceDays + 1), "00:15"),
          },
        });
      } else {
        pending += 1;
      }
    }
  }

  console.log(`  ${people.length} users, ${categoryDefs.length} categories, ${templates.length} templates`);
  console.log(`  ${created} instances — ${completed} completed, ${missed} missed, ${pending} pending`);
  console.log(`\n  Sign in as layton@evolutiongolf.co.uk / ${DEFAULT_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
