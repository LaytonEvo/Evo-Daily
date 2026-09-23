import { SignInOutcome } from "@prisma/client";
import { KeyRound, LogIn, UserX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { describeOutcome, type SignInRow } from "@/lib/sign-ins";
import { formatDateOnly, formatTimeLondon, toDateOnly } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * Who has actually been getting into the platform.
 *
 * A failed attempt is as useful as a successful one here: somebody locked out
 * for a fortnight reads on the reports exactly like somebody ignoring their
 * list, and the two need opposite conversations.
 */
export function SignInLog({ rows, today }: { rows: SignInRow[]; today: string }) {
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Sign-in attempts</CardTitle>
        <CardDescription>
          The last {rows.length === 0 ? "few" : rows.length} password attempts, newest first.
          This is about accounts, not usage: a session lasts a month, so somebody using it every
          day appears here once. Who is opening it is the card above.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">
            Nothing recorded yet. Attempts are logged from the next sign-in.
          </p>
        ) : (
          <ul className="flex flex-col">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-3 border-b py-2.5 text-sm last:border-0"
              >
                <Icon outcome={row.outcome} />
                <span className="min-w-0 flex-1 truncate font-medium">{row.user.name}</span>
                {/* A success is drawn as a green icon and nothing else, which
                    says nothing at all to a screen reader. */}
                <span className="sr-only">{describeOutcome(row.outcome)}</span>
                {row.outcome === SignInOutcome.SUCCESS ? null : (
                  <Badge variant="muted" aria-hidden="true">
                    {describeOutcome(row.outcome)}
                  </Badge>
                )}
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {when(row.at, today)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Icon({ outcome }: { outcome: SignInOutcome }) {
  const shared = "h-4 w-4 shrink-0";
  if (outcome === SignInOutcome.SUCCESS) {
    return <LogIn className={cn(shared, "text-success")} aria-hidden="true" />;
  }
  if (outcome === SignInOutcome.DEACTIVATED) {
    return <UserX className={cn(shared, "text-muted-foreground")} aria-hidden="true" />;
  }
  return <KeyRound className={cn(shared, "text-warning")} aria-hidden="true" />;
}

/** "14:32" for today, otherwise the date and the time. */
function when(at: Date, today: string): string {
  const day = toDateOnly(at);
  const time = formatTimeLondon(at);
  return day === today ? time : `${formatDateOnly(day)} ${time}`;
}
