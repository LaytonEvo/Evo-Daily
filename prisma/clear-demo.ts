/**
 * Remove the invented seed data from a real organisation.
 *
 * prisma/seed.ts fills a database with nine invented staff, nineteen invented
 * tasks and forty-five days of invented history, so the reporting could be
 * judged on day one. Once real tasks and real people are in, that history is
 * no longer a demonstration — it is nine colleagues who do not exist dragging
 * the completion rate around.
 *
 * What goes is defined by matching the seed exactly: a task whose title is one
 * of the nineteen it creates, and an account whose email is one of the nine it
 * creates. Everything else stays, including the organisation, the categories,
 * the settings, and Layton's account — which the seed also creates but which
 * is the real admin.
 *
 * Anything it does not recognise is listed rather than assumed either way, so
 * a task added by hand can never be swept up as demo data.
 *
 * Instances, audit rows, comments and attachment rows go with their task by
 * cascade. Files already in the bucket are NOT deleted — the script says how
 * many there are so they can be cleared separately.
 *
 * Dry run by default. Nothing is deleted unless CLEAR_DEMO is exactly "true".
 *
 *   npx tsx prisma/clear-demo.ts              # says what it would do
 *   CLEAR_DEMO=true npx tsx prisma/clear-demo.ts
 */

import { PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();

/** The nineteen titles prisma/seed.ts creates. */
const DEMO_TITLES = [
  "Clear the support inbox",
  "Answer overnight website enquiries",
  "Call back yesterday's missed calls",
  "Check simulator bay bookings for today",
  "Wipe down and reset the fitting studio",
  "Record range ball stock level",
  "Pick and pack web orders",
  "Post to Instagram and Facebook",
  "Weekly stock count — shafts and grips",
  "Send the weekly lesson availability email",
  "Review last week's completion report",
  "Simulator software update check",
  "Reconcile the card machine takings",
  "Month-end stock reconciliation",
  "Submit supplier invoices to the accountant",
  "Deep clean the driving range mats",
  "Review lesson pricing against competitors",
  "Chase the TaylorMade rep about the delayed fitting cart",
  "Photograph the new Ping stock for the website",
];

/** The nine accounts prisma/seed.ts creates. */
const DEMO_EMAILS = [
  "layton@evolutiongolf.co.uk",
  "luke@evolutiongolf.co.uk",
  "karin@evolutiongolf.co.uk",
  "sam@evolutiongolf.co.uk",
  "priya@evolutiongolf.co.uk",
  "dan@evolutiongolf.co.uk",
  "chloe@evolutiongolf.co.uk",
  "marek@evolutiongolf.co.uk",
  "hannah@evolutiongolf.co.uk",
];

/**
 * Seeded, but real: this is the account the business signs in with. Everything
 * the seed gave it is demo data; the account itself is not.
 */
const KEEP_EMAILS = ["layton@evolutiongolf.co.uk"];

const armed = process.env.CLEAR_DEMO === "true";

async function main() {
  const organisations = await prisma.organisation.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  if (organisations.length === 0) throw new Error("No organisation.");

  const wanted = process.env.BOOTSTRAP_ORG;
  const org = wanted ? organisations.find((o) => o.name === wanted) : organisations[0];
  if (!org) throw new Error(`No organisation named "${wanted}".`);

  const templates = await prisma.taskTemplate.findMany({
    where: { organisationId: org.id },
    select: { id: true, title: true, assignee: { select: { name: true } } },
    orderBy: { title: "asc" },
  });
  const demoTemplates = templates.filter((t) => DEMO_TITLES.includes(t.title));
  const keptTemplates = templates.filter((t) => !DEMO_TITLES.includes(t.title));

  const users = await prisma.user.findMany({
    where: { organisationId: org.id },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" },
  });
  const demoUsers = users.filter(
    (u) => DEMO_EMAILS.includes(u.email) && !KEEP_EMAILS.includes(u.email),
  );
  const keptUsers = users.filter((u) => !demoUsers.some((d) => d.id === u.id));

  if (!keptUsers.some((u) => u.role === Role.ADMIN)) {
    throw new Error("That would leave no admin. Nothing has been deleted.");
  }

  const demoTemplateIds = demoTemplates.map((t) => t.id);
  const instances = await prisma.taskInstance.count({
    where: { templateId: { in: demoTemplateIds } },
  });
  const comments = await prisma.comment.count({
    where: { instance: { templateId: { in: demoTemplateIds } } },
  });
  const attachments = await prisma.attachment.count({
    where: { comment: { instance: { templateId: { in: demoTemplateIds } } } },
  });
  const absences = await prisma.absence.count({
    where: { userId: { in: demoUsers.map((u) => u.id) } },
  });

  console.log(`\n${org.name}\n`);
  console.log(`  going: ${demoTemplates.length} tasks, ${instances} instances,`);
  console.log(`         ${comments} comments, ${attachments} attachments, ${absences} absences,`);
  console.log(`         ${demoUsers.length} accounts\n`);
  for (const u of demoUsers) console.log(`    account  ${u.name} <${u.email}>`);
  console.log("");
  for (const t of demoTemplates) console.log(`    task     ${t.title}`);

  console.log(`\n  staying: ${keptTemplates.length} tasks, ${keptUsers.length} accounts\n`);
  for (const u of keptUsers) console.log(`    account  ${u.name} <${u.email}> ${u.role}`);
  console.log("");
  for (const t of keptTemplates) console.log(`    task     ${t.title} — ${t.assignee.name}`);

  if (attachments > 0) {
    console.log(
      `\n  ${attachments} attachment rows go, but their files stay in the bucket. Clear those separately.`,
    );
  }

  if (!armed) {
    console.log("\n  Dry run. Nothing deleted. Set CLEAR_DEMO=true to go ahead.\n");
    return;
  }

  // Instances first: audit rows, comments and attachment rows cascade from
  // them, and templates cannot go while instances point at them.
  await prisma.absence.deleteMany({ where: { userId: { in: demoUsers.map((u) => u.id) } } });
  await prisma.taskInstance.deleteMany({ where: { templateId: { in: demoTemplateIds } } });
  await prisma.taskTemplate.deleteMany({ where: { id: { in: demoTemplateIds } } });

  // An account only goes once nothing real points at it. If something still
  // does, that account was doing real work and this script was wrong about it.
  const stubborn: string[] = [];
  for (const user of demoUsers) {
    const [owns, created, assigned, wrote] = await Promise.all([
      prisma.taskTemplate.count({ where: { assigneeId: user.id } }),
      prisma.taskTemplate.count({ where: { createdById: user.id } }),
      prisma.taskInstance.count({ where: { assigneeId: user.id } }),
      prisma.comment.count({ where: { authorId: user.id } }),
    ]);
    if (owns + created + assigned + wrote > 0) {
      stubborn.push(
        `${user.name}: ${owns} tasks owned, ${created} created, ${assigned} instances, ${wrote} comments`,
      );
      continue;
    }
    await prisma.auditLog.updateMany({ where: { userId: user.id }, data: { userId: null } });
    await prisma.user.delete({ where: { id: user.id } });
  }

  console.log("\n  Done.");
  if (stubborn.length > 0) {
    console.log("\n  Kept, because real work still points at them:");
    for (const line of stubborn) console.log(`    ${line}`);
  }
  console.log("");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
