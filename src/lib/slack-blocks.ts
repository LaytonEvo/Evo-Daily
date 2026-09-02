/**
 * The morning brief as Block Kit, one row per task with a Done button.
 *
 * A tap carries the instance id, so there is no matching to get wrong — which
 * is the whole reason the buttons exist alongside the free-text path.
 */

import { escape, appUrl, type Block } from "./slack";
import { formatTimeLondon } from "./time";

export type BriefTask = {
  id: string;
  title: string;
  dueAt: Date | null;
  overdue: boolean;
  overdueFrom?: string;
};

/** Slack rejects a button value over 2000 chars; ours are cuids. */
export function taskBlocks(tasks: BriefTask[]): Block[] {
  return tasks.flatMap((task) => {
    const time =
      task.dueAt && formatTimeLondon(task.dueAt) !== "23:59"
        ? ` · by ${formatTimeLondon(task.dueAt)}`
        : "";
    const late = task.overdue ? ` · *overdue${task.overdueFrom ? ` from ${task.overdueFrom}` : ""}*` : "";

    return [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${escape(task.title)}*${time}${late}` },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "Done", emoji: false },
          // Slack requires a unique action_id per block, not per message.
          action_id: `complete:${task.id}`,
          value: task.id,
          style: task.overdue ? "danger" : "primary",
        },
      },
    ];
  });
}

export function briefBlocks(heading: string, tasks: BriefTask[]): Block[] {
  return [
    { type: "section", text: { type: "mrkdwn", text: heading } },
    ...taskBlocks(tasks),
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Tap Done, or just tell me — “done the stock take, ran out of range balls”. <${appUrl("/my-day")}|Open EvoTasks>`,
        },
      ],
    },
  ];
}

/** What the row becomes after the tap. */
export function completedBlocks(title: string, note: string | null): Block[] {
  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: `:white_check_mark: ~${escape(title)}~` },
    },
    ...(note
      ? [{ type: "context", elements: [{ type: "mrkdwn", text: `Note: ${escape(note)}` }] }]
      : []),
  ];
}
