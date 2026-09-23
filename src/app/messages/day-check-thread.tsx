"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatDateOnlyLong, formatTimeLondon, toDateOnly } from "@/lib/time";

type Message = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  mine: boolean;
};

/**
 * The conversation under an under-half answer.
 *
 * Its own component rather than the task one, because there is no task: no
 * attachments, no lazy fetch. The messages are already on the page — a day
 * check is one sentence and its replies, and a request to load that would be
 * a request to load nothing.
 */
export function DayCheckThread({
  dayCheckId,
  messages,
  readOnly = false,
}: {
  dayCheckId: string;
  messages: Message[];
  /** Reading somebody else's inbox: the replies show, the composer does not. */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const body = draft.trim();
    if (!body) return;

    setBusy(true);
    const response = await fetch(`/api/day-checks/${dayCheckId}/replies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    });
    setBusy(false);

    if (!response.ok) {
      toast("Could not send that.", { tone: "error" });
      return;
    }
    setDraft("");
    router.refresh();
  }

  return (
    <div className="pt-3">
      <ul className="flex flex-col gap-3">
        {messages.map((message, index) => (
          <li key={message.id}>
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {message.mine && !readOnly ? "You" : message.authorName}
              </span>{" "}
              {when(message.createdAt)}
              {/* The first message answers the compulsory question rather than
                  being a reply somebody chose to write. "asked why" read as
                  though they had done the asking, when they were the one
                  asked. */}
              {index === 0 ? " · answering for a day under half" : null}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm leading-snug">{message.body}</p>
          </li>
        ))}
      </ul>

      {readOnly ? null : (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <textarea
            rows={2}
            maxLength={2000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Reply"
            aria-label="Reply"
            className="flex-1 rounded-xl border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            size="sm"
            className="sm:self-end"
            disabled={!draft.trim() || busy}
            onClick={() => void send()}
          >
            {busy ? "Sending…" : "Send"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** "14:32" today, otherwise the date and the time. */
function when(iso: string): string {
  const at = new Date(iso);
  const time = formatTimeLondon(at);
  const day = toDateOnly(at);
  return day === toDateOnly(new Date()) ? time : `${formatDateOnlyLong(day)} ${time}`;
}
