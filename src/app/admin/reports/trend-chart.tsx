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
import type { TrendPoint } from "@/lib/reports";
import { formatDateOnly } from "@/lib/time";

export function TrendChart({ points }: { points: TrendPoint[] }) {
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
