"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState } from "react";
import { Select } from "@/components/ui/input";
import type { TrendPoint } from "@/lib/reports";
import { formatDateOnly } from "@/lib/time";

export type TrendPerson = { userId: string; name: string };

/**
 * The org's completion trend, or one person's.
 *
 * The filter is local state rather than a URL parameter on purpose: the series
 * for every person is already on the page, so switching between them is
 * instant, and it is a way of looking at one chart rather than a different
 * report. Everything else on the screen keeps meaning what it says.
 */
export function TrendChart({
  points,
  pointsByUser,
  people,
}: {
  points: TrendPoint[];
  pointsByUser?: Record<string, TrendPoint[]>;
  people?: TrendPerson[];
}) {
  const [userId, setUserId] = useState("");
  const shown = userId ? (pointsByUser?.[userId] ?? []) : points;
  const canFilter = Boolean(people?.length && pointsByUser);

  return (
    <div>
      {canFilter ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select
            className="h-9 w-auto"
            aria-label="Whose trend to show"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            <option value="">Everyone</option>
            {people!.map((person) => (
              <option key={person.userId} value={person.userId}>
                {person.name}
              </option>
            ))}
          </Select>
          {userId ? (
            <span className="text-xs text-muted-foreground">
              One person&rsquo;s days. The tiles above are still everyone.
            </span>
          ) : null}
        </div>
      ) : null}
      <TrendLines points={shown} />
    </div>
  );
}

function TrendLines({ points }: { points: TrendPoint[] }) {
  const data = points.map((point) => ({
    date: point.date,
    label: formatDateOnly(point.date),
    // Days with nothing due are gaps in the line rather than a dip to zero —
    // a weekend with no tasks is not a 0% day.
    rate: point.assigned === 0 ? null : Math.round((point.completionRate ?? 0) * 100),
    average: point.movingAverage === null ? null : Math.round(point.movingAverage * 100),
    assigned: point.assigned,
    completed: point.completed,
  }));

  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-muted-foreground">Nothing was due in this window.</p>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            interval="preserveStartEnd"
            minTickGap={40}
            className="fill-muted-foreground"
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(value: number) => `${value}%`}
            tick={{ fontSize: 11 }}
            className="fill-muted-foreground"
          />
          <Tooltip
            contentStyle={{
              borderRadius: 8,
              border: "1px solid hsl(var(--border))",
              fontSize: 12,
            }}
            formatter={(value, name) => [
              value === null ? "—" : `${value}%`,
              name === "rate" ? "Completion" : "7-day average",
            ]}
            labelFormatter={(label, payload) => {
              const point = payload?.[0]?.payload as (typeof data)[number] | undefined;
              return point ? `${label} · ${point.completed}/${point.assigned}` : String(label);
            }}
          />
          <Line
            type="monotone"
            dataKey="rate"
            stroke="hsl(var(--muted-foreground))"
            strokeWidth={1.5}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="average"
            stroke="hsl(var(--primary))"
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
