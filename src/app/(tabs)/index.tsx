import React, { useCallback, useEffect, useMemo } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Plus, ChevronRight, ArrowRight, Sparkles, CalendarClock, ChartLine,
  Pill, ScanLine, TrendingUp, Footprints, Flame, IdCard,
} from 'lucide-react-native';

import { Screen, Card, Section, Row } from '../../design-system/components/Surface';
import { Text, Eyebrow, DisplayTitle } from '../../design-system/components/Text';
import { MetricRing, Pill as StatusPill } from '../../design-system/components/Feedback';
import { useTheme } from '../../design-system/theme';
import { space, radius, MIN_TARGET, HIT_SLOP } from '../../design-system/tokens';
import { useHealth } from '../../state/healthStore';
import { useSettings } from '../../state/settingsStore';
import { useRuns } from '../../state/runStore';
import { WORKFLOWS } from '../../domain/workflows';

const ICON_FOR = { visitPrep: CalendarClock, explainResults: ChartLine, medicationReview: Pill, documentSummary: ScanLine };

export default function HomeScreen() {
  const t = useTheme();
  const router = useRouter();
  const firstName = useSettings((s) => s.firstName);
  const briefs = useSettings((s) => s.briefs);
  const { connection, sourceName, signals, syncing, bootstrap, refresh } = useHealth();
  const loadHistory = useRuns((s) => s.loadHistory);

  useEffect(() => {
    bootstrap();
    loadHistory();
  }, [bootstrap, loadHistory]);

  const onRefresh = useCallback(() => refresh('dailyReads', 90), [refresh]);
  useEffect(() => {
    if (connection === 'connected' || connection === 'partial') onRefresh();
  }, [connection, onRefresh]);

  const steps = signals['steps'];
  const energy = signals['activeEnergy'];
  const hasMetrics = Boolean(steps || energy);
  const weekly = useMemo(() => briefs.find((b) => b.kind === 'weekly'), [briefs]);

  return (
    <Screen tabBarInset>
      {/* ── Greeting ─────────────────────────────────────────────────────── */}
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Eyebrow>{formatToday()}</Eyebrow>
          <View style={{ marginTop: space.xs }}>
            <DisplayTitle lead={`Good ${partOfDay()}`} emphasis={firstName ? `, ${firstName}` : undefined} />
          </View>
        </View>
        <Pressable
          onPress={() => router.push('/note/new')}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Write a new note"
          style={{
            width: MIN_TARGET, height: MIN_TARGET, borderRadius: MIN_TARGET / 2,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: t.colors.accentSoft,
          }}
        >
          <Plus size={22} color={t.colors.accent} />
        </Pressable>
      </Row>

      <View style={{ alignItems: 'flex-end', marginTop: space.xs }}>
        <SyncBadge state={syncing ? 'syncing' : connection} sourceName={sourceName} onPress={() => router.push('/(tabs)/settings')} />
      </View>

      {/* ── Today + digest ───────────────────────────────────────────────── */}
      {hasMetrics ? (
        <Row style={{ marginTop: space.lg, gap: space.sm, alignItems: 'stretch' }}>
          <Card style={{ flex: 1.05, gap: space.sm }} raised>
            <Eyebrow>Today</Eyebrow>
            <Row style={{ justifyContent: 'space-around' }}>
              <MetricRing
                value={steps?.aggregate ?? null}
                goal={8000}
                glyph={<Footprints size={20} color={t.colors.accent} />}
                label="Steps"
                formatted={steps ? formatCount(steps.aggregate) : '–'}
              />
              <MetricRing
                value={energy?.aggregate ?? null}
                goal={500}
                glyph={<Flame size={20} color={t.colors.accent} />}
                label="Move"
                formatted={energy ? `${Math.round(energy.aggregate)}` : '–'}
              />
            </Row>
          </Card>

          <Card style={{ flex: 1, gap: space.sm, justifyContent: 'center' }} raised>
            <View
              style={{
                width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
                backgroundColor: t.colors.accentSoft,
              }}
            >
              <TrendingUp size={19} color={t.colors.accent} />
            </View>
            <Text variant="title">Weekly digest</Text>
            <Text variant="caption" tone="soft">
              {weekly?.enabled
                ? `Arrives ${dayName(weekly.weekday ?? 0)}s, ${formatTime(weekly.hour, weekly.minute)}`
                : 'Turn on in Settings'}
            </Text>
          </Card>
        </Row>
      ) : null}

      {/* ── Hero CTA ─────────────────────────────────────────────────────── */}
      <Pressable
        onPress={() => router.push('/workflow/visitPrep')}
        accessibilityRole="button"
        accessibilityLabel="Prepare for your next visit"
        accessibilityHint="Turns your recent numbers into questions. Takes about two minutes."
        style={({ pressed }) => ({ marginTop: space.lg, opacity: pressed ? 0.92 : 1 })}
      >
        <Card fill="ink" style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View
            style={{
              width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
              backgroundColor: 'rgba(241,236,226,0.12)',
            }}
          >
            <Sparkles size={20} color={t.colors.onInk} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text variant="title" tone="onInk">Prepare for your next visit</Text>
            <Text variant="caption" style={{ color: 'rgba(241,236,226,0.72)' }}>
              Turn your recent numbers into questions · 2 min
            </Text>
          </View>
          <ArrowRight size={20} color={t.colors.onInk} />
        </Card>
      </Pressable>

      {/* ── Empty state ──────────────────────────────────────────────────── */}
      {!hasMetrics ? (
        <Card style={{ marginTop: space.md, gap: 6 }} raised>
          <Eyebrow>No metrics yet</Eyebrow>
          <Text variant="body" tone="soft">
            Connect {sourceName} to show read-only wellness metrics.
          </Text>
          <Pressable
            onPress={() => router.push('/(tabs)/settings')}
            accessibilityRole="button"
            accessibilityLabel={`Connect ${sourceName}`}
            style={{ marginTop: space.xs, minHeight: MIN_TARGET, justifyContent: 'center' }}
          >
            <Text variant="bodyMedium" tone="accent">Connect {sourceName} →</Text>
          </Pressable>
        </Card>
      ) : null}

      {/* ── Workflow launcher ────────────────────────────────────────────── */}
      <Section label="Start a workflow">
        {WORKFLOWS.map((w) => {
          const Icon = ICON_FOR[w.kind as keyof typeof ICON_FOR] ?? ScanLine;
          return (
            <Pressable
              key={w.kind}
              onPress={() => router.push(`/workflow/${w.kind}`)}
              accessibilityRole="button"
              accessibilityLabel={w.title}
              accessibilityHint={w.subtitle}
              style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
            >
              <Card raised style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
                <Icon size={24} color={t.colors.accent} strokeWidth={1.8} style={{ marginTop: 2 }} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text variant="title">{w.title}</Text>
                  <Text variant="caption" tone="soft">{w.subtitle}</Text>
                </View>
                <ChevronRight size={20} color={t.colors.inkMuted} style={{ marginTop: 2 }} />
              </Card>
            </Pressable>
          );
        })}
      </Section>
    </Screen>
  );
}

function SyncBadge({
  state,
  sourceName,
  onPress,
}: {
  state: 'unknown' | 'unavailable' | 'notConnected' | 'partial' | 'connected' | 'syncing';
  sourceName: string;
  onPress: () => void;
}) {
  const t = useTheme();
  const map = {
    syncing: { label: 'Syncing', tone: 'neutral' as const, dot: t.colors.inkMuted },
    connected: { label: 'Synced', tone: 'kept' as const, dot: t.colors.keptFg },
    partial: { label: 'Partly connected', tone: 'caution' as const, dot: t.colors.cautionFg },
    notConnected: { label: 'Connect health', tone: 'accent' as const, dot: t.colors.accent },
    unavailable: { label: 'No health source', tone: 'neutral' as const, dot: t.colors.inkMuted },
    unknown: { label: 'Checking', tone: 'neutral' as const, dot: t.colors.inkMuted },
  }[state];

  return (
    <Pressable
      onPress={onPress}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={`${sourceName} status: ${map.label}. Opens settings.`}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 7,
        paddingHorizontal: space.sm, paddingVertical: 7,
        borderRadius: radius.chip, backgroundColor: t.colors.surface,
        borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.hairline,
      }}
    >
      {state === 'notConnected' ? (
        <IdCard size={14} color={map.dot} />
      ) : (
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: map.dot }} />
      )}
      <Text variant="eyebrow" tone={map.tone === 'accent' ? 'accent' : 'soft'} maxScale={1.3}>
        {map.label}
      </Text>
    </Pressable>
  );
}

function partOfDay(now = new Date()): string {
  const h = now.getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}
function formatToday(now = new Date()): string {
  return now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}
function dayName(weekday: number): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday];
}
function formatTime(h: number, m: number): string {
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function formatCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
}
