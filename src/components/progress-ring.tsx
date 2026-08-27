import { cn } from "@/lib/utils";

/** "6 of 9 done" — the one number a member sees at the top of their day. */
export function ProgressRing({
  done,
  total,
  size = 64,
  className,
}: {
  done: number;
  total: number;
  size?: number;
  className?: string;
}) {
  const fraction = total === 0 ? 1 : done / total;
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const complete = total > 0 && done >= total;

  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-border"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          className={cn(
            "transition-[stroke-dashoffset] duration-200",
            complete ? "stroke-success" : "stroke-primary",
          )}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">
        {total === 0 ? "—" : `${done}/${total}`}
      </div>
    </div>
  );
}
