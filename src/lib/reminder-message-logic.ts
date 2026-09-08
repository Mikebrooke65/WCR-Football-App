// Pure logic for the manual "Send Reminder" message a coach/manager sends
// from an event card (Schedule.tsx and desktop/DesktopSchedule.tsx).
//
// Why this exists as its own module: both Schedule pages previously carried
// their own identical copy of the prefill template inline, so any wording
// fix had to be made twice and could silently drift. Both now call this.
//
// Kept free of React/Supabase so it can be unit-tested directly, matching
// this repo's `*-logic.ts` convention (see `rsvp-identities.ts`,
// `rsvp-reminders-logic.ts`).

export interface ReminderPrefillInput {
  /** Display title, already resolved (e.g. "U9 Lithium vs City FC"). */
  eventTitle: string;
  /** Pre-formatted date, e.g. "Wed, Sep 9". */
  dateLabel: string;
  /** Pre-formatted time, e.g. "3:00 PM". */
  timeLabel: string;
  location: string;
  /**
   * How many people have answered AT ALL — going, maybe or can't-go.
   * Note this is NOT the "attending" count: a decline is still a reply, and
   * counting only `going` here understated it and made the message wrong.
   */
  replied: number;
  /** Total roster size for the event's team(s). 0 if not yet known. */
  total: number;
}

/**
 * Build the pre-filled reminder message. The composer lets the sender edit
 * it before sending, so this only has to be a sensible starting point — but
 * it should never state something untrue about the numbers.
 */
export function buildReminderPrefill(input: ReminderPrefillInput): {
  title: string;
  body: string;
} {
  return {
    title: `Reminder: ${input.eventTitle}`,
    body: [
      'Hi team,',
      '',
      describeReplies(input.replied, input.total),
      '',
      `This is a reminder about ${input.eventTitle} on ${input.dateLabel} at ${input.timeLabel}.`,
      '',
      `Location: ${input.location}`,
      '',
      "Please update your RSVP if you haven't already.",
    ].join('\n'),
  };
}

/**
 * The replies sentence, with correct pluralisation and an honest
 * denominator. Handles the three cases that read badly otherwise:
 * nobody has replied, exactly one person has, and everybody has.
 */
function describeReplies(replied: number, total: number): string {
  if (replied === 0) {
    return "We haven't had any replies yet — please get your response in!";
  }

  if (total > 0 && replied >= total) {
    return `Everyone has replied — thanks! Please update your RSVP if anything has changed.`;
  }

  const noun = replied === 1 ? 'reply' : 'replies';

  if (total > 0) {
    return `We've had ${replied} of ${total} ${noun} so far. Please get your response in!`;
  }

  return `We've had ${replied} ${noun} so far. Please get your response in!`;
}
