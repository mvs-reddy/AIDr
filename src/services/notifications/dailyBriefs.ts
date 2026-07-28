/**
 * Daily reads (spec §13). Morning / midday / evening / weekly.
 *
 * The notification itself never contains a health detail — it is a doorway, not
 * a summary. "Health data never appears in notification previews" is an
 * acceptance criterion (Android §12), and it applies on both platforms.
 */

import * as Notifications from 'expo-notifications';
import type { DailyReadKind } from '../../domain/models';

export interface BriefSchedule {
  kind: DailyReadKind;
  enabled: boolean;
  hour: number;
  minute: number;
  /** Weekly only. 0 = Sunday. */
  weekday?: number;
}

export const DEFAULT_BRIEFS: BriefSchedule[] = [
  { kind: 'morning', enabled: true, hour: 8, minute: 0 },
  { kind: 'midday', enabled: true, hour: 12, minute: 30 },
  { kind: 'evening', enabled: true, hour: 21, minute: 30 },
  { kind: 'weekly', enabled: true, hour: 18, minute: 0, weekday: 0 },
];

const COPY: Record<DailyReadKind, { title: string; body: string }> = {
  morning: { title: 'Your morning read is ready', body: 'How your body recovered overnight.' },
  midday: { title: 'Midday check', body: 'Movement and the afternoon ahead.' },
  evening: { title: 'Evening recap', body: 'The day, closed.' },
  weekly: { title: 'Your weekly summary', body: 'Your longer arc, once a week.' },
};

export async function rescheduleBriefs(schedules: BriefSchedule[], masterEnabled: boolean): Promise<void> {
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    existing
      .filter((n) => n.identifier.startsWith('brief:'))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
  if (!masterEnabled) return;

  for (const s of schedules.filter((x) => x.enabled)) {
    await Notifications.scheduleNotificationAsync({
      identifier: `brief:${s.kind}`,
      content: {
        ...COPY[s.kind],
        data: { deeplink: `aidr://journal?read=${s.kind}` },
        interruptionLevel: 'passive',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        hour: s.hour,
        minute: s.minute,
        weekday: s.weekday != null ? s.weekday + 1 : undefined,
        repeats: true,
        channelId: 'briefs',
      },
    });
  }
}
