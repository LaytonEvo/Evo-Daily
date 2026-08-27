import { InstanceStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { csvRate, csvResponse, toCsv } from "@/lib/csv";
import { errorResponse, requireApiAdmin } from "@/lib/guards";
import { buildOrgReport, buildPersonReport, buildWindow } from "@/lib/reports";
import { toDateOnly, toDbDate } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * CSV for every panel, plus a raw instance-level export.
 *
 * Each panel exports the same rows the panel renders, from the same report
 * object, so an export can never disagree with the screen above it.
 */
export async function GET(request: Request) {
  try {
    const admin = await requireApiAdmin();
    const url = new URL(request.url);
    const panel = url.searchParams.get("panel") ?? "leaderboard";

    const window = buildWindow({
      days: url.searchParams.get("days") ? Number(url.searchParams.get("days")) : undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    });

    const stamp = `${window.from}_to_${window.to}`;

    if (panel === "instances") {
      const rows = await prisma.taskInstance.findMany({
        where: {
          organisationId: admin.organisationId,
          dueDate: { gte: toDbDate(window.from), lte: toDbDate(window.to) },
        },
        include: {
          assignee: { select: { name: true, email: true } },
          completedBy: { select: { name: true } },
          category: { select: { name: true } },
          template: { select: { frequency: true, dueTime: true } },
        },
        orderBy: [{ dueDate: "asc" }, { title: "asc" }],
      });

      const csv = toCsv(
        [
          "instance_id",
          "template_id",
          "due_date",
          "due_at_utc",
          "title",
          "assignee_name",
          "assignee_email",
          "category",
          "frequency",
          "status",
          "was_late",
          "completed_at_utc",
          "completed_by",
          "note",
        ],
        rows.map((row) => [
          row.id,
          row.templateId,
          toDateOnly(row.dueDate),
          row.dueAt?.toISOString() ?? "",
          row.title,
          row.assignee.name,
          row.assignee.email,
          row.category?.name ?? "",
          row.template.frequency,
          row.status,
          row.status === InstanceStatus.COMPLETED ? String(row.wasLate) : "",
          row.completedAt?.toISOString() ?? "",
          row.completedBy?.name ?? "",
          row.note ?? "",
        ]),
      );
      return csvResponse(csv, `evotasks_instances_${stamp}.csv`);
    }

    const userId = url.searchParams.get("userId");
    if (panel === "person" && userId) {
      const person = await buildPersonReport(prisma, admin.organisationId, userId, window);
      if (!person) return csvResponse(toCsv(["error"], [["User not found"]]), "error.csv");

      const csv = toCsv(
        ["due_date", "title", "category", "status", "was_late", "completed_at_utc", "note"],
        person.history.map((row) => [
          row.dueDate,
          row.title,
          row.categoryName ?? "",
          row.status,
          row.status === InstanceStatus.COMPLETED ? String(row.wasLate) : "",
          row.completedAt?.toISOString() ?? "",
          row.note ?? "",
        ]),
      );
      return csvResponse(csv, `evotasks_${slug(person.user.name)}_${stamp}.csv`);
    }

    const report = await buildOrgReport(prisma, admin.organisationId, window);

    switch (panel) {
      case "summary": {
        const csv = toCsv(
          ["metric", "value", "previous_period"],
          [
            ["assigned", report.totals.assigned, report.previousTotals.assigned],
            ["completed", report.totals.completed, report.previousTotals.completed],
            ["missed", report.totals.missed, report.previousTotals.missed],
            ["outstanding", report.totals.outstanding, report.previousTotals.outstanding],
            ["on_time", report.totals.onTime, report.previousTotals.onTime],
            [
              "completion_rate",
              csvRate(report.totals.completionRate),
              csvRate(report.previousTotals.completionRate),
            ],
            [
              "on_time_rate",
              csvRate(report.totals.onTimeRate),
              csvRate(report.previousTotals.onTimeRate),
            ],
          ],
        );
        return csvResponse(csv, `evotasks_summary_${stamp}.csv`);
      }

      case "trend": {
        const csv = toCsv(
          ["date", "assigned", "completed", "completion_rate", "moving_average_7d"],
          report.trend.map((point) => [
            point.date,
            point.assigned,
            point.completed,
            csvRate(point.completionRate),
            csvRate(point.movingAverage),
          ]),
        );
        return csvResponse(csv, `evotasks_trend_${stamp}.csv`);
      }

      case "problem-tasks": {
        const csv = toCsv(
          [
            "task",
            "owner",
            "schedule",
            "category",
            "assigned",
            "completed",
            "missed",
            "outstanding",
            "completion_rate",
            "on_time_rate",
            "active",
          ],
          report.problemTasks.map((task) => [
            task.title,
            task.assigneeName,
            task.schedule,
            task.categoryName ?? "",
            task.assigned,
            task.completed,
            task.missed,
            task.outstanding,
            csvRate(task.completionRate),
            csvRate(task.onTimeRate),
            String(task.isActive),
          ]),
        );
        return csvResponse(csv, `evotasks_problem_tasks_${stamp}.csv`);
      }

      case "categories": {
        const csv = toCsv(
          ["category", "assigned", "completed", "missed", "outstanding", "completion_rate", "on_time_rate"],
          report.categories.map((row) => [
            row.name,
            row.assigned,
            row.completed,
            row.missed,
            row.outstanding,
            csvRate(row.completionRate),
            csvRate(row.onTimeRate),
          ]),
        );
        return csvResponse(csv, `evotasks_categories_${stamp}.csv`);
      }

      case "leaderboard":
      default: {
        const csv = toCsv(
          [
            "person",
            "assigned",
            "completed",
            "missed",
            "outstanding",
            "completion_rate",
            "on_time",
            "on_time_rate",
            "low_volume",
          ],
          report.leaderboard.map((row) => [
            row.name,
            row.assigned,
            row.completed,
            row.missed,
            row.outstanding,
            csvRate(row.completionRate),
            row.onTime,
            csvRate(row.onTimeRate),
            String(row.lowVolume),
          ]),
        );
        return csvResponse(csv, `evotasks_leaderboard_${stamp}.csv`);
      }
    }
  } catch (error) {
    return errorResponse(error);
  }
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
