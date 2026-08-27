import { NextResponse } from "next/server";
import { z } from "zod";
import { Frequency } from "@prisma/client";
import { errorResponse, requireApiAdmin } from "@/lib/guards";
import { describeSchedule, nextDueDates } from "@/lib/recurrence";
import { formatDateOnly, todayInLondon } from "@/lib/time";

const schema = z.object({
  frequency: z.nativeEnum(Frequency),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).default([]),
  dayOfWeek: z.number().int().min(1).max(7).nullish(),
  dayOfMonth: z.number().int().min(1).max(31).nullish(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

/** Powers the live preview line: "Next 3 due dates: Thu 28 Aug, Fri 29 Aug…". */
export async function POST(request: Request) {
  try {
    await requireApiAdmin();
    const input = schema.parse(await request.json());

    const schedule = {
      frequency: input.frequency,
      daysOfWeek: input.daysOfWeek,
      dayOfWeek: input.dayOfWeek ?? null,
      dayOfMonth: input.dayOfMonth ?? null,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
    };

    const dates = nextDueDates(schedule, 3, todayInLondon());

    return NextResponse.json({
      description: describeSchedule(schedule),
      dates,
      labels: dates.map((d) => formatDateOnly(d)),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
