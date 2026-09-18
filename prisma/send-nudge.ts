/**
 * Send one nudge, on demand, to named people only.
 *
 * The scheduled jobs go to everybody they apply to, which is right at 08:30
 * and wrong when somebody has just been mapped to Slack and wants to see what
 * the bot actually sends. This runs the same job for a named few, so nobody
 * else gets a surprise DM out of the blue.
 *
 *   NUDGE_TO="a@example.com,b@example.com" npx tsx prisma/send-nudge.ts
 *   NUDGE_TO="a@example.com" NUDGE_JOB=afternoon-nudge npx tsx prisma/send-nudge.ts
 *
 * NUDGE_JOB defaults to morning-brief: it lists each task, marks the overdue
 * ones with the date they were due, and carries the Done buttons.
 *
 * Anyone named who has no Slack ID mapped is reported rather than skipped
 * silently — "sent 0" with no explanation is how you waste half an hour.
 */

import { PrismaClient } from "@prisma/client";
import { isNudgeJob, nudgeNames, runNudge } from "../src/lib/nudge-jobs";

const prisma = new PrismaClient();

async function main() {
  const job = process.env.NUDGE_JOB || "morning-brief";
  if (!isNudgeJob(job)) {
    throw new Error(`Unknown NUDGE_JOB "${job}". Expected one of: ${nudgeNames()}`);
  }

  const emails = (process.env.NUDGE_TO ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) {
    throw new Error('NUDGE_TO is not set. Expected "someone@example.com,other@example.com".');
  }

  const people = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, name: true, email: true, slackUserId: true, isActive: true },
  });

  const missing = emails.filter((e) => !people.some((p) => p.email.toLowerCase() === e));
  const unmapped = people.filter((p) => !p.slackUserId);
  const inactive = people.filter((p) => !p.isActive);

  console.log(`\n  ${job} → ${people.length} matched of ${emails.length} asked for\n`);
  for (const p of people) {
    console.log(
      `    ${p.name} <${p.email}> ${p.slackUserId ? `slack ${p.slackUserId}` : "NO SLACK ID"}`,
    );
  }
  for (const e of missing) console.log(`    ${e} — no account with that email`);
  console.log("");

  if (unmapped.length > 0) {
    console.log(`  ${unmapped.length} without a Slack ID will get nothing.`);
  }
  if (inactive.length > 0) {
    console.log(`  ${inactive.length} deactivated, which the job skips.`);
  }

  const sendable = people.filter((p) => p.slackUserId && p.isActive).map((p) => p.id);
  if (sendable.length === 0) {
    console.log("\n  Nobody to send to.\n");
    return;
  }

  const outcome = await runNudge(job, prisma, { onlyUserIds: sendable });
  console.log(`\n  ${JSON.stringify(outcome)}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
