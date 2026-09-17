/**
 * Put today's still-open tasks on whoever owns them now.
 *
 * Reassigning a task used to leave today's instance with the previous owner,
 * so the Tasks screen and My Day disagreed about whose job it was until the
 * next morning. That is fixed at the source, but only for reassignments made
 * from here on; anything already reassigned today is still sitting on the
 * wrong list. This is the one-off that catches those up.
 *
 * Today only, and only PENDING. An overdue open day stays with the person who
 * has been sitting on it, and anything completed, missed or excused is history
 * and never moves.
 *
 * Safe to run again: once everything matches, it changes nothing.
 *
 *   npx tsx prisma/realign-today.ts
 */

import { InstanceStatus, PrismaClient } from "@prisma/client";
import { toDbDate, todayInLondon } from "../src/lib/time";

const prisma = new PrismaClient();

async function main() {
  const today = todayInLondon();

  const stale = await prisma.taskInstance.findMany({
    where: { status: InstanceStatus.PENDING, dueDate: toDbDate(today) },
    select: {
      id: true,
      title: true,
      assigneeId: true,
      assignee: { select: { name: true } },
      template: { select: { assigneeId: true, assignee: { select: { name: true } } } },
    },
  });

  const wrong = stale.filter((i) => i.assigneeId !== i.template.assigneeId);

  console.log(`\n  ${today}: ${stale.length} open today, ${wrong.length} on the wrong list\n`);

  for (const instance of wrong) {
    await prisma.taskInstance.update({
      where: { id: instance.id },
      data: { assigneeId: instance.template.assigneeId },
    });
    console.log(
      `    ${instance.title} — ${instance.assignee.name} → ${instance.template.assignee.name}`,
    );
  }

  console.log("");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
