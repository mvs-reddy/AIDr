import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, RefreshControl, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Plus, ChevronRight, Sunrise, Sun, Moon, TrendingUp,
  CalendarClock, ChartLine, Pill, ScanLine, NotebookPen,
} from 'lucide-react-native';

import { Screen, Card, Section, Row, Divider } from '../../design-system/components/Surface';
import { Text, Eyebrow, DisplayTitle } from '../../design-system/components/Text';
import { Pill as StatusPill } from '../../design-system/components/Feedback';
import { useTheme } from '../../design-system/theme';
import { space, MIN_TARGET, HIT_SLOP } from '../../design-system/tokens';
import { useRuns } from '../../state/runStore';
import { journalRepo } from '../../services/persistence/db';
import type { JournalEntry, DailyRead, WorkflowRun, WorkflowKind } from '../../domain/models';

type Filter = 'all' | 'reads' | 'runs' | 'notes';

const RUN_ICON: Record<WorkflowKind, React.ComponentType<{ size: number; color: string }>> = {
  visitPrep: CalendarClock,
  explainResults: ChartLine,
  medicationReview: Pill,
  documentSummary: ScanLine,
  journalReflection: NotebookPen,
};

const RUN_LABEL: Record<WorkflowKind, string> = {
  visitPrep: 'Visit Prep',
  explainResults: 'Explain Results',
  medicationReview: 'Medication Review',
  documentSummary: 'Document Summary',
  journalReflection: 'Reflection',
};

const READ_ICON = { morning: Sunrise, midday: Sun, evening: Moon, weekly: TrendingUp };

export default function JournalScreen() {
  const t = useTheme();
  const router = useRouter();
  const { history, loadHistory } = useRuns();
  const [notes, setNotes] = useState<JournalEntry[]>([]);
  const [reads] = useState<DailyRead[]>([]); // populated by the daily-read task
  const [filter, setFilter] = useState<Filter>('all');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    await loadHistory();
    setNotes(await journalRepo.list());
  }, [loadHistory]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  /** One timeline, three sources, grouped by day. */
  const grouped = useMemo(() => {
    type Item =
      | { kind: 'read'; at: string; read: DailyRead }
      | { kind: 'run'; at: string; run: WorkflowRun }
      | { kind: 'note'; at: string; note: JournalEntry };

    const items: Item[] = [
      ...(filter === 'all' || filter === 'reads'
        ? reads.map((r) => ({ kind: 'read' as const, at: r.date, read: r }))
        : []),
      ...(filter === 'all' || filter === 'runs'
        ? history.map((r) => ({ kind: 'run' as const, at: r.createdAt, run: r }))
        : []),
      ...(filter === 'all' || filter === 'notes'
        ? notes.map((n) => ({ kind: 'note' as const, at: n.createdAt, note: n }))
        : []),
    ].sort((a, b) => b.at.localeCompare(a.at));

    const byDay = new Map<string, Item[]>();
    for (const item of items) {
      const day = item.at.slice(0, 10);
      byDay.set(day, [...(byDay.get(day) ?? []), item]);
    }
    return [...byDay.entries()];
  }, [reads, history, notes, filter]);

  const isEmpty = grouped.length === 0;

  return (
    <Screen
      tabBarInset
      scroll={false}
      contentStyle={{ paddingHorizontal: 0 }}
    >
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.accent} />
        }
      >
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Eyebrow>Your record</Eyebrow>
            <View style={{ marginTop: space.xs }}>
              <DisplayTitle lead="Your health " emphasis="story" />
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

        {/* ── Filters ────────────────────────────────────────────────────── */}
        <Row style={{ marginTop: space.lg, gap: space.xs, flexWrap: 'wrap' }}>
          {(['all', 'reads', 'runs', 'notes'] as Filter[]).map((f) => {
            const selected = filter === f;
            const label = { all: 'Everything', reads: 'Daily reads', runs: 'Workflows', notes: 'Notes' }[f];
            return (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={label}
                style={{
                  minHeight: MIN_TARGET - 8,
                  paddingHorizontal: space.md,
                  paddingVertical: space.xs,
                  borderRadius: 999,
                  justifyContent: 'center',
                  backgroundColor: selected ? t.colors.ink : t.colors.surface,
                }}
              >
                <Text variant="eyebrow" tone={selected ? 'onInk' : 'soft'} maxScale={1.35}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </Row>

        {/* ── Empty state ────────────────────────────────────────────────── */}
        {isEmpty ? (
          <Card style={{ marginTop: space.xl, gap: space.sm }} raised>
            <Eyebrow>Nothing here yet</Eyebrow>
            <Text variant="body" tone="soft">
              Your daily reads, saved workflows and notes collect here so you can see how things
              change over months, not just today.
            </Text>
            <Pressable
              onPress={() => router.push('/note/new')}
              accessibilityRole="button"
              accessibilityLabel="Write your first note"
              style={{ minHeight: MIN_TARGET, justifyContent: 'center' }}
            >
              <Text variant="bodyMedium" tone="accent">Write your first note →</Text>
            </Pressable>
          </Card>
        ) : null}

        {/* ── Timeline ───────────────────────────────────────────────────── */}
        {grouped.map(([day, items]) => (
          <Section key={day} label={formatDay(day)} top={space.xl}>
            {items.map((item) => {
              if (item.kind === 'run') {
                const Icon = RUN_ICON[item.run.type];
                return (
                  <Pressable
                    key={item.run.id}
                    onPress={() => router.push(`/run/${item.run.id}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`${RUN_LABEL[item.run.type]}: ${item.run.output?.headline ?? 'Saved run'}`}
                    style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
                  >
                    <Card raised style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
                      <Icon size={22} color={t.colors.accent} />
                      <View style={{ flex: 1, gap: 4 }}>
                        <Row style={{ justifyContent: 'space-between' }}>
                          <Text variant="eyebrow" tone="muted" maxScale={1.35}>
                            {RUN_LABEL[item.run.type].toUpperCase()}
                          </Text>
                          <Text variant="caption" tone="muted">{formatClock(item.at)}</Text>
                        </Row>
                        <Text variant="title" numberOfLines={2}>
                          {item.run.output?.headline ?? 'Saved run'}
                        </Text>
                        {item.run.output?.questionsForClinician.length ? (
                          <Text variant="caption" tone="soft">
                            {item.run.output.questionsForClinician.length} question
                            {item.run.output.questionsForClinician.length === 1 ? '' : 's'} for your clinician
                          </Text>
                        ) : null}
                      </View>
                      <ChevronRight size={19} color={t.colors.inkMuted} />
                    </Card>
                  </Pressable>
                );
              }

              if (item.kind === 'read') {
                const Icon = READ_ICON[item.read.kind];
                return (
                  <Card key={item.read.id} raised style={{ gap: space.xs }}>
                    <Row>
                      <Icon size={18} color={t.colors.accent} />
                      <Text variant="eyebrow" tone="muted" maxScale={1.35} style={{ flex: 1 }}>
                        {item.read.kind.toUpperCase()} READ
                      </Text>
                    </Row>
                    <Text variant="title">{item.read.headline}</Text>
                    <Text variant="body" tone="soft">{item.read.body}</Text>
                    {item.read.suggestion ? (
                      <Text variant="caption" tone="accent">{item.read.suggestion}</Text>
                    ) : null}
                  </Card>
                );
              }

              return (
                <Card key={item.note.id} raised style={{ gap: space.xs }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Row style={{ flex: 1 }}>
                      <NotebookPen size={17} color={t.colors.accent} />
                      <Text variant="eyebrow" tone="muted" maxScale={1.35}>NOTE</Text>
                    </Row>
                    <Text variant="caption" tone="muted">{formatClock(item.at)}</Text>
                  </Row>
                  {/* The raw note is shown here because this view is on-device only. */}
                  <Text variant="body" numberOfLines={4}>{item.note.rawTextLocal}</Text>
                  {item.note.reflection ? (
                    <>
                      <Divider />
                      <Text variant="caption" tone="soft" style={{ fontStyle: 'italic' }}>
                        {item.note.reflection}
                      </Text>
                    </>
                  ) : (
                    <StatusPill label={`${item.note.wordCount} words`} tone="neutral" />
                  )}
                </Card>
              );
            })}
          </Section>
        ))}
      </ScrollView>
    </Screen>
  );
}

function formatDay(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (day === today.toISOString().slice(0, 10)) return 'Today';
  if (day === yesterday.toISOString().slice(0, 10)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
