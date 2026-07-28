/**
 * Medication reminders (spec §26.1).
 *
 * Two rules drive every decision here:
 *
 *   1. A reminder exists only for a plan the user has *verified*. AIDr. never
 *      schedules from an unconfirmed OCR or platform import (§30).
 *   2. An unacknowledged reminder becomes "not logged", never "missed". The app
 *      measures its own delivery separately from the user's logging, because
 *      absence of a log is not evidence of a skipped dose (§30).
 *
 * Escalation ladder: upcoming → due → one follow-up after the grace period →
 * not logged. Caregiver notification only for user-marked critical medicines,
 * and only with explicit per-person consent. Emergency services are never
 * contacted automatically.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { MedicationPlan, Medication, ReminderPolicy, DoseEvent } from '../../domain/models';
import { medicationRepo, newId } from '../persistence/db';

export const DEFAULT_REMINDER_POLICY: ReminderPolicy = {
  leadTimeMinutes: 15,
  gracePeriodMinutes: 30,
  followUpCount: 1,
  lockScreenPrivacy: true, // §30 — medicine names hidden by default
  caregiverEscalation: false,
};

const CATEGORY_DOSE = 'aidr.dose';

export async function configureNotifications(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return false;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  // Actionable notification: log without opening the app.
  await Notifications.setNotificationCategoryAsync(CATEGORY_DOSE, [
    { identifier: 'TAKEN', buttonTitle: 'Taken', options: { opensAppToForeground: false } },
    { identifier: 'SNOOZE', buttonTitle: 'Snooze', options: { opensAppToForeground: false } },
    { identifier: 'SKIP', buttonTitle: 'Skip', options: { opensAppToForeground: true } },
  ]);

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('medication', {
      name: 'Medication reminders',
      importance: Notifications.AndroidImportance.HIGH,
      // Private: the full text is withheld from the lock screen; the expanded
      // notification shows the name only once the device is unlocked.
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      vibrationPattern: [0, 220, 120, 220],
    });
    await Notifications.setNotificationChannelAsync('briefs', {
      name: 'Daily reads',
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.SECRET,
    });
  }
  return true;
}

/** What the lock screen is allowed to say. */
function notificationBody(
  plan: MedicationPlan & { medication: Medication },
  policy: ReminderPolicy,
  phase: 'upcoming' | 'due' | 'followUp',
): { title: string; body: string } {
  if (policy.lockScreenPrivacy) {
    return {
      title: phase === 'upcoming' ? 'A dose is coming up' : 'A dose is due',
      body: 'Open AIDr. to see the details and log it.',
    };
  }
  const name = plan.medication.nameOriginal;
  // The dose string is quoted from the verified source — AIDr. never composes it.
  const dose = plan.doseText;
  return {
    title: phase === 'upcoming' ? `${name} coming up` : `${name} due now`,
    body: [dose, plan.foodInstructions].filter(Boolean).join(' · '),
  };
}

export async function scheduleForPlan(
  plan: MedicationPlan & { medication: Medication },
  policy: ReminderPolicy = DEFAULT_REMINDER_POLICY,
): Promise<string[]> {
  // Rule 1, enforced at the only place that can create a reminder.
  if (!plan.verifiedAt) return [];
  if (plan.scheduleRule.kind === 'asNeeded') return [];

  await cancelForPlan(plan.id);
  const ids: string[] = [];

  const times = expandTimes(plan);
  for (const { hour, minute, weekday } of times) {
    if (policy.leadTimeMinutes > 0) {
      const lead = shiftMinutes(hour, minute, -policy.leadTimeMinutes);
      ids.push(
        await Notifications.scheduleNotificationAsync({
          identifier: `${plan.id}:upcoming:${hour}-${minute}${weekday ? `:${weekday}` : ''}`,
          content: {
            ...notificationBody(plan, policy, 'upcoming'),
            categoryIdentifier: CATEGORY_DOSE,
            data: { planId: plan.id, phase: 'upcoming' },
            interruptionLevel: 'passive',
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
            hour: lead.hour,
            minute: lead.minute,
            weekday,
            repeats: true,
            channelId: 'medication',
          },
        }),
      );
    }

    ids.push(
      await Notifications.scheduleNotificationAsync({
        identifier: `${plan.id}:due:${hour}-${minute}${weekday ? `:${weekday}` : ''}`,
        content: {
          ...notificationBody(plan, policy, 'due'),
          categoryIdentifier: CATEGORY_DOSE,
          data: { planId: plan.id, phase: 'due' },
          interruptionLevel: plan.isCritical ? 'timeSensitive' : 'active',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
          hour,
          minute,
          weekday,
          repeats: true,
          channelId: 'medication',
        },
      }),
    );
  }
  return ids;
}

/**
 * Follow-up is scheduled *reactively* when a due notification is delivered and
 * still unacknowledged, so we never queue a follow-up for a dose already taken.
 */
export async function scheduleFollowUp(
  plan: MedicationPlan & { medication: Medication },
  scheduledAt: Date,
  policy: ReminderPolicy = DEFAULT_REMINDER_POLICY,
): Promise<void> {
  if (policy.followUpCount < 1) return;
  const at = new Date(scheduledAt.getTime() + policy.gracePeriodMinutes * 60_000);
  await Notifications.scheduleNotificationAsync({
    identifier: `${plan.id}:followUp:${scheduledAt.toISOString()}`,
    content: {
      ...notificationBody(plan, policy, 'followUp'),
      categoryIdentifier: CATEGORY_DOSE,
      data: { planId: plan.id, phase: 'followUp', scheduledAt: scheduledAt.toISOString() },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: 'medication' },
  });
}

export async function cancelForPlan(planId: string): Promise<void> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    all
      .filter((n) => n.identifier.startsWith(`${planId}:`))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

/** Handles TAKEN / SNOOZE / SKIP from the notification itself. */
export function registerResponseHandler(): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener(async (response) => {
    const { planId, scheduledAt } = (response.notification.request.content.data ?? {}) as {
      planId?: string;
      scheduledAt?: string;
    };
    if (!planId) return;

    const action = response.actionIdentifier;
    const when = scheduledAt ? new Date(scheduledAt) : new Date();

    if (action === 'SNOOZE') {
      await Notifications.scheduleNotificationAsync({
        content: response.notification.request.content,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 600,
          channelId: 'medication',
        },
      });
      await logDose(planId, when, 'snoozed');
      return;
    }
    if (action === 'TAKEN') await logDose(planId, when, 'taken');
    if (action === 'SKIP') await logDose(planId, when, 'skipped');
  });
  return () => sub.remove();
}

export async function logDose(
  planId: string,
  scheduledAt: Date,
  status: DoseEvent['status'],
  note?: string,
): Promise<DoseEvent> {
  const event: DoseEvent = {
    id: newId(),
    planId,
    scheduledAt: scheduledAt.toISOString(),
    // Scheduled and actual times are kept separate — §26 requires it so that
    // "took it late" is distinguishable from "took it on time".
    actionAt: status === 'notLogged' ? null : new Date().toISOString(),
    status,
    quantity: null,
    note: note ?? null,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    writtenToPlatform: false,
  };
  await medicationRepo.logDose(event);
  return event;
}

/**
 * Sweeps past-due reminders with no response and records `notLogged`.
 * Deliberately NOT `missed` — see the header note.
 */
export async function sweepUnlogged(
  plans: Array<MedicationPlan & { medication: Medication }>,
  policy: ReminderPolicy = DEFAULT_REMINDER_POLICY,
): Promise<number> {
  let marked = 0;
  const cutoff = Date.now() - (policy.gracePeriodMinutes + 60) * 60_000;

  for (const plan of plans) {
    const events = await medicationRepo.adherenceWindow(plan.id, 2);
    const logged = new Set(events.map((e) => e.scheduledAt));
    for (const occurrence of occurrencesSince(plan, new Date(Date.now() - 2 * 86_400_000))) {
      if (occurrence.getTime() > cutoff) continue;
      if (logged.has(occurrence.toISOString())) continue;
      await logDose(plan.id, occurrence, 'notLogged');
      marked++;
    }
  }
  return marked;
}

// ─── Schedule expansion ──────────────────────────────────────────────────────

interface TimeSlot {
  hour: number;
  minute: number;
  weekday?: number;
}

function expandTimes(plan: MedicationPlan): TimeSlot[] {
  const rule = plan.scheduleRule;
  switch (rule.kind) {
    case 'fixedTimes': {
      const slots = rule.times.map(parseHM);
      if (!rule.daysOfWeek?.length) return slots;
      // expo weekday: 1 = Sunday
      return rule.daysOfWeek.flatMap((d) => slots.map((s) => ({ ...s, weekday: d + 1 })));
    }
    case 'interval': {
      const anchor = parseHM(rule.anchor);
      const out: TimeSlot[] = [];
      for (let h = anchor.hour; h < anchor.hour + 24; h += rule.everyHours) {
        out.push({ hour: h % 24, minute: anchor.minute });
      }
      return out;
    }
    case 'cycle':
      // Cycles are re-scheduled daily by the background task, because a repeating
      // calendar trigger cannot express "20 days on, 8 days off".
      return [];
    case 'taper': {
      const step = rule.steps
        .filter((s) => new Date(s.from) <= new Date())
        .sort((a, b) => b.from.localeCompare(a.from))[0];
      return step ? step.times.map(parseHM) : [];
    }
    default:
      return [];
  }
}

export function occurrencesSince(plan: MedicationPlan, since: Date): Date[] {
  const slots = expandTimes(plan);
  const out: Date[] = [];
  const days = Math.ceil((Date.now() - since.getTime()) / 86_400_000);
  for (let d = 0; d <= days; d++) {
    const day = new Date(since.getTime() + d * 86_400_000);
    for (const s of slots) {
      const at = new Date(day);
      at.setHours(s.hour, s.minute, 0, 0);
      if (at >= since && at <= new Date()) out.push(at);
    }
  }
  return out;
}

function parseHM(hm: string): TimeSlot {
  const [h, m] = hm.split(':').map(Number);
  return { hour: h ?? 8, minute: m ?? 0 };
}

function shiftMinutes(hour: number, minute: number, delta: number): TimeSlot {
  const total = (hour * 60 + minute + delta + 1440) % 1440;
  return { hour: Math.floor(total / 60), minute: total % 60 };
}

/**
 * §26.1 — a time-zone change must ask, never guess. Returns the prompt payload;
 * the UI decides when to show it.
 */
export function detectTimeZoneShift(lastKnown: string | null): { from: string; to: string } | null {
  const current = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!lastKnown || lastKnown === current) return null;
  return { from: lastKnown, to: current };
}
