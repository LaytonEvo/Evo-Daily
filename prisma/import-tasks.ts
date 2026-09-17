/**
 * Load Alex's and Brad's recurring tasks into a real organisation.
 *
 * The twenty tasks written up in "Alex and Brad task specs", put in at the
 * cadence Layton asked for — daily on weekdays — rather than the cadence each
 * one actually wants. The schedules are the first thing to change in the admin
 * screen. The wording is the part that took the work, and that is what this
 * script carries.
 *
 * One exception: the sign-up baseline is a genuine one-off. Making it daily
 * would generate an instance every morning for a job that happens once.
 *
 * Safe to run again. A task already in the organisation under the same title
 * and owner is left exactly as it is, so re-running never overwrites an edit
 * made in the admin screen.
 *
 * Owners are matched by first name against existing accounts. No email address
 * is written here — that is what BOOTSTRAP_TEAM is for. Until Alex and Brad
 * have accounts every task lands on the first admin, and the Tasks screen can
 * move them all in one go.
 *
 *   npx tsx prisma/import-tasks.ts
 */

import { Frequency, PrismaClient, Role } from "@prisma/client";
import { runGenerateJob } from "../src/lib/jobs";
import { todayInLondon, toDbDate } from "../src/lib/time";

const prisma = new PrismaClient();

/** Weekdays. A golf shop works weekends, but a placeholder should be quiet. */
const WEEKDAYS = [1, 2, 3, 4, 5];

type Spec = {
  title: string;
  description: string;
  /** Category name, or null where none of the five fit. */
  category: string | null;
  /** First name of the person who owns it. */
  owner: string;
  dueTime?: string;
  /** Only where daily would be wrong rather than merely provisional. */
  frequency?: Frequency;
};

const SPECS: Spec[] = [
  // ---- Alex ---------------------------------------------------------------
  {
    owner: "Alex",
    title: "Review out-of-stock products",
    category: "Stock",
    dueTime: "12:00",
    description:
      "Pull the out-of-stock list. Every line gets one of three decisions: reorder, discontinue, or leave out of stock for now. Raise the PO for anything being reordered, so a decision does not sit as an intention.\n\nDone when every out-of-stock SKU has a decision recorded and every reorder has a PO number.",
  },
  {
    owner: "Alex",
    title: "Top up the blog content calendar",
    category: "Marketing",
    description:
      "Count the titles in the calendar that have not been written. A title only counts if it has a target keyword and the products it will link to; a bare headline does not. If fewer than ten remain, add titles until there are ten.\n\nDone when ten or more unwritten titles each have a keyword and products, and Layton has been told if the calendar was short.",
  },
  {
    owner: "Alex",
    title: "Plan next week's non-member emails",
    category: "Marketing",
    description:
      "Fill next week's slots: send date, subject line, the offer or theme, and the products or collections it points at. A slot you are deliberately leaving empty is marked 'no send' with a reason, so nobody has to guess whether it was a decision.\n\nDone when every slot next week carries all four, or is marked no send.",
  },
  {
    owner: "Alex",
    title: "Schedule this week's emails",
    category: "Marketing",
    dueTime: "11:00",
    description:
      "Build this week's planned sends properly — audience, subject, content, send time — and schedule them. Send yourself a test of each and open it on a phone first.\n\nDone when every send planned for this week is scheduled rather than drafted, and each one has been opened on a phone.",
  },
  {
    owner: "Alex",
    title: "Flag dead and slowing stock",
    category: "Stock",
    description:
      "Pull the ageing report. List every SKU with no sale in [TBD] days, and every SKU whose rate of sale will reach that mark within a month — the second list is the useful one, because it is still cheap to act on. Each line gets one action: discount, bundle, feature, or return to supplier.\n\nDone when the list is written and every line carries an action.",
  },
  {
    owner: "Alex",
    title: "Check competitor pricing",
    category: "Stock",
    description:
      "Price the agreed basket against the agreed competitors. Record each competitor's price and the gap to ours, and flag anything where we are more than [TBD]% above with what you would do about it.\n\nDone when every product in the basket has a price and a gap for every competitor, and everything over the threshold is flagged with a recommendation.",
  },
  {
    owner: "Alex",
    title: "Conversion check on the top ten products",
    category: "Marketing",
    description:
      "Take the ten best sellers of the last 30 days. Record each one's conversion rate against the previous 30 days. Then open each product page on a phone and on desktop and check the ordinary things: images loading, stock status, price, delivery message, reviews showing.\n\nDone when all ten have a rate, a comparison against the previous period, and a pass or fail on the page check, with a note on anything down more than [TBD] percentage points.",
  },
  {
    owner: "Alex",
    title: "Find keywords worth pushing from page two",
    category: "Marketing",
    description:
      "Filter the ranking report to positions 10-30 with real search volume. Pick the ones where a page already exists and a small change would move it. Write the shortlist: keyword, page, current position, and the one thing you would change.\n\nDone when the shortlist is written. An empty shortlist is a valid answer — write 'nothing worth pushing' rather than leaving it blank.",
  },
  {
    owner: "Alex",
    title: "Publish a product review",
    category: "Marketing",
    description:
      "Write and publish one in-depth review of a single product: hands-on detail, photographs, who it suits and who it does not, and a clear route to buy.\n\nDone when the review is live and linked from the product page.",
  },
  {
    owner: "Alex",
    title: "Nominate one process to improve",
    category: null,
    description:
      "Pick one thing in the business that wastes time or causes mistakes. Write three lines: what happens now, what it costs in time or money or errors, and what you would change. One is enough — this is deliberately not a list-building exercise.\n\nDone when it is written and sent to Layton.",
  },

  // ---- Brad ---------------------------------------------------------------
  {
    owner: "Brad",
    title: "Publish today's instant deals",
    category: "Marketing",
    dueTime: "09:00",
    description:
      "Publish today's instant deals: live on site, right price, right end time, visible to the audience they are meant for. Check one on the live site as a customer would see it. A deal that exists only in the admin panel is the classic way this goes wrong.\n\nDone when every deal for today is live and at least one has been checked from the front end.",
  },
  {
    owner: "Brad",
    title: "List this week's member deals",
    category: "Marketing",
    dueTime: "10:00",
    description:
      "Publish the member deals agreed for this week: product, member price, start and end dates, and the member gate actually working. Check one signed in as a member and again signed out.\n\nDone when every deal for this week is live and correctly dated, and the gate has been tested both ways.",
  },
  {
    owner: "Brad",
    title: "Draft next week's member deals",
    category: "Marketing",
    description:
      "Line up next week's deals as drafts: product, member price, margin checked, dates set, not yet live. Drafting a week ahead is what stops Monday becoming an hour of picking products under time pressure.\n\nDone when next week's slots are filled as drafts and the margin on each has been checked.",
  },
  {
    owner: "Brad",
    title: "Line up next month's giveaway",
    category: "Marketing",
    description:
      "Pick the prize and get it confirmed in writing by whoever is providing it. Build the entry page, write the terms, and set both the entry window and the draw date.\n\nDone when the giveaway page is built and scheduled, the prize is confirmed in writing, and the draw date is in the diary.",
  },
  {
    owner: "Brad",
    title: "Draw the giveaway and tell everyone",
    category: "Marketing",
    description:
      "Run the draw by the agreed method and record the winner and the method used, so the result can be defended if anyone asks. Contact the winner, confirm the prize has been sent, and email the entrants who did not win — that last email is where most of the value sits.\n\nDone when the winner has replied, the prize is on its way, and the email to everyone else has gone out.",
  },
  {
    owner: "Brad",
    title: "Partner outreach",
    category: "Marketing",
    description:
      "Approach [TBD] new prospective partners about an offer or benefit for members. Log who you contacted, what you proposed and what came back. Chase anything from last week that has gone quiet.\n\nDone when the new approaches are logged and every open conversation has been chased or closed.",
  },
  {
    owner: "Brad",
    title: "Affiliate outreach",
    category: "Marketing",
    description:
      "The same motion against a different list: approach [TBD] new affiliate prospects, log the approach and the reply, and chase what has gone quiet.\n\nDone when the new approaches are logged and every open conversation has been chased or closed.",
  },
  {
    owner: "Brad",
    title: "Baseline the member sign-up journey",
    category: "Marketing",
    frequency: Frequency.ONE_OFF,
    description:
      "Walk the whole journey as a new visitor would: where sign-up is offered, how many steps it takes, what it asks for, and what it promises in return. Then record the current numbers — visitors, reached the sign-up page, started, completed — and the drop-off at each step.\n\nDone when the walkthrough and those four numbers are written down in one place.",
  },
  {
    owner: "Brad",
    title: "Review member sign-up conversion",
    category: "Marketing",
    description:
      "Compare this month's funnel against the baseline and say which step moved and by how much. Then propose one change to test, with what you expect it to move. One change, not a list — otherwise next month there is no way to tell which of them worked.\n\nDone when the four numbers are recorded against the baseline and one change is proposed with a predicted effect.",
  },
  {
    owner: "Brad",
    title: "Nominate one process to improve",
    category: null,
    description:
      "Pick one thing in the business that wastes time or causes mistakes. Write three lines: what happens now, what it costs in time or money or errors, and what you would change. One is enough — this is deliberately not a list-building exercise.\n\nDone when it is written and sent to Layton.",
  },
];

async function main() {
  const organisations = await prisma.organisation.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  if (organisations.length === 0) throw new Error("No organisation. Run db:bootstrap first.");

  const wanted = process.env.BOOTSTRAP_ORG;
  const org = wanted
    ? organisations.find((o) => o.name === wanted)
    : organisations[0];
  if (!org) {
    throw new Error(
      `No organisation named "${wanted}". Found: ${organisations.map((o) => o.name).join(", ")}`,
    );
  }

  const users = await prisma.user.findMany({
    where: { organisationId: org.id, isActive: true },
    select: { id: true, name: true, role: true },
    orderBy: { createdAt: "asc" },
  });
  const admin = users.find((u) => u.role === Role.ADMIN);
  if (!admin) throw new Error("No active admin in the organisation.");

  /** First name match, so "Alex Whittle" answers to "Alex". */
  function ownerFor(first: string) {
    const match = users.find(
      (u) => u.name.split(" ")[0].toLowerCase() === first.toLowerCase(),
    );
    return match ?? admin!;
  }

  const categories = await prisma.category.findMany({
    where: { organisationId: org.id },
    select: { id: true, name: true },
  });
  const categoryId = (name: string | null) =>
    name ? (categories.find((c) => c.name === name)?.id ?? null) : null;

  const startDate = toDbDate(todayInLondon());
  const created: string[] = [];
  const skipped: string[] = [];
  const standIn = new Set<string>();

  for (const spec of SPECS) {
    const assignee = ownerFor(spec.owner);
    if (assignee.id === admin.id && spec.owner.toLowerCase() !== admin.name.split(" ")[0].toLowerCase()) {
      standIn.add(spec.owner);
    }

    // Keyed on owner as well as title: Alex and Brad share one task title, and
    // those are two different tasks unless they also share a stand-in owner.
    const existing = await prisma.taskTemplate.findFirst({
      where: { organisationId: org.id, title: spec.title, assigneeId: assignee.id },
      select: { id: true },
    });
    if (existing) {
      skipped.push(`${spec.title} (${spec.owner})`);
      continue;
    }

    const frequency = spec.frequency ?? Frequency.DAILY;
    await prisma.taskTemplate.create({
      data: {
        organisationId: org.id,
        title: spec.title,
        description: spec.description,
        categoryId: categoryId(spec.category),
        assigneeId: assignee.id,
        frequency,
        daysOfWeek: frequency === Frequency.DAILY ? WEEKDAYS : [],
        dueTime: spec.dueTime ?? null,
        startDate,
        isActive: true,
        createdById: admin.id,
      },
    });
    created.push(`${spec.title} (${spec.owner} → ${assignee.name})`);
  }

  console.log(`\n${org.name}\n`);
  console.log(`  created ${created.length}:`);
  for (const line of created) console.log(`    ${line}`);
  if (skipped.length > 0) {
    console.log(`\n  already there, left alone ${skipped.length}:`);
    for (const line of skipped) console.log(`    ${line}`);
  }
  if (standIn.size > 0) {
    console.log(
      `\n  No account for ${[...standIn].join(" or ")} — those tasks are on ${admin.name}.`,
    );
    console.log("  Create the accounts, then reassign in bulk from the Tasks screen.");
  }

  const generated = await runGenerateJob(prisma);
  const total = generated.results.reduce((sum, r) => sum + (r.created ?? 0), 0);
  console.log(`\n  generated ${total} instances across the horizon\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
