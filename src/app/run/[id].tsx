import React, { useEffect, useState, useCallback } from 'react';
import { View, Pressable, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ChevronLeft, Share2, CircleHelp, TriangleAlert, Quote, Trash2,
} from 'lucide-react-native';

import { Screen, Card, Section, Row, Divider } from '../../design-system/components/Surface';
import { Text, Eyebrow, DisplayTitle } from '../../design-system/components/Text';
import { Button } from '../../design-system/components/Controls';
import { AIGeneratedLabel, Pill, SafetyBanner } from '../../design-system/components/Feedback';
import { useTheme } from '../../design-system/theme';
import { space, MIN_TARGET, HIT_SLOP } from '../../design-system/tokens';

import { runsRepo } from '../../services/persistence/db';
import type { WorkflowRun, Confidence } from '../../domain/models';
import { createClinicianExport } from '../../services/export/clinicianExport';

const TITLES: Record<string, { lead: string; emphasis: string }> = {
  visitPrep: { lead: 'Your visit ', emphasis: 'brief' },
  explainResults: { lead: 'Your results, ', emphasis: 'explained' },
  medicationReview: { lead: 'Your medication ', emphasis: 'list' },
  documentSummary: { lead: 'Document ', emphasis: 'summary' },
  journalReflection: { lead: 'A ', emphasis: 'reflection' },
};

export default function RunScreen() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    runsRepo.get(String(id)).then(setRun);
  }, [id]);

  const onExport = useCallback(async () => {
    if (!run) return;
    setExporting(true);
    const result = await createClinicianExport(run);
    setExporting(false);
    if (!result.ok) Alert.alert('Could not create the export', result.message);
  }, [run]);

  const onDelete = useCallback(() => {
    if (!run) return;
    Alert.alert('Delete this run?', 'It will be removed from your journal. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await runsRepo.remove(run.id);
          router.back();
        },
      },
    ]);
  }, [run, router]);

  if (!run || !run.output) {
    return (
      <Screen>
        <Text variant="title">This run is no longer available.</Text>
      </Screen>
    );
  }

  const out = run.output;
  const title = TITLES[run.type] ?? { lead: 'Your ', emphasis: 'brief' };

  return (
    <Screen
      footer={
        <Button
          label="Create a clinician export"
          onPress={onExport}
          loading={exporting}
          icon={<Share2 size={18} color={t.colors.onInk} />}
          accessibilityHint="Creates a one-page PDF with an expiring link you can revoke."
        />
      }
    >
      <Row style={{ justifyContent: 'space-between' }}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={{
            width: MIN_TARGET, height: MIN_TARGET, borderRadius: MIN_TARGET / 2,
            alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.surface,
          }}
        >
          <ChevronLeft size={22} color={t.colors.ink} />
        </Pressable>
        <Pressable
          onPress={onDelete}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Delete this run"
          style={{
            width: MIN_TARGET, height: MIN_TARGET, borderRadius: MIN_TARGET / 2,
            alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.surface,
          }}
        >
          <Trash2 size={19} color={t.colors.inkMuted} />
        </Pressable>
      </Row>

      <View style={{ marginTop: space.xl }}>
        <Eyebrow>{new Date(run.createdAt).toLocaleString()}</Eyebrow>
        <View style={{ marginTop: space.xs }}>
          <DisplayTitle {...title} />
        </View>
      </View>

      {/* Urgent safety message always sits above everything else. */}
      {out.urgentSafetyMessage ? (
        <View style={{ marginTop: space.lg }}>
          <SafetyBanner title="Please seek care" body={out.urgentSafetyMessage} />
        </View>
      ) : null}

      <Card style={{ marginTop: space.lg, gap: space.sm }} raised>
        <Text variant="displaySm">{out.headline}</Text>
        {out.summary.map((line, i) => (
          <Text key={i} variant="body" tone="soft">{line}</Text>
        ))}
      </Card>

      {/* ── Observations, each with its evidence ─────────────────────────── */}
      {out.observations.length > 0 ? (
        <Section label="What AIDr. noticed">
          {out.observations.map((o, i) => (
            <Card key={i} raised style={{ gap: space.xs }}>
              <Text variant="body">{o.statement}</Text>
              <Row style={{ gap: space.xs, flexWrap: 'wrap' }}>
                <Pill label={`${o.confidence} confidence`} tone={confidenceTone(o.confidence)} />
                {o.evidenceRefs.map((ref) => (
                  <Pill key={ref} label={humaniseRef(ref)} tone="neutral" />
                ))}
              </Row>
            </Card>
          ))}
          <Text variant="caption" tone="muted">
            Every statement above is tied to data you shared. AIDr. discards anything it cannot trace
            back to your own numbers.
          </Text>
        </Section>
      ) : null}

      {/* ── Questions ────────────────────────────────────────────────────── */}
      {out.questionsForClinician.length > 0 ? (
        <Section label="Questions for your clinician">
          <Card raised style={{ gap: space.md }}>
            {out.questionsForClinician.map((q, i) => (
              <React.Fragment key={i}>
                {i > 0 ? <Divider /> : null}
                <Row style={{ alignItems: 'flex-start', gap: space.sm }}>
                  <CircleHelp size={18} color={t.colors.accent} style={{ marginTop: 3 }} />
                  <Text variant="body" style={{ flex: 1 }}>{q}</Text>
                </Row>
              </React.Fragment>
            ))}
          </Card>
        </Section>
      ) : null}

      {/* ── Uncertainties ────────────────────────────────────────────────── */}
      {out.uncertainties.length > 0 ? (
        <Section label="What AIDr. is unsure about">
          <Card fill="sunken" style={{ gap: space.sm }}>
            {out.uncertainties.map((u, i) => (
              <Row key={i} style={{ alignItems: 'flex-start', gap: space.sm }}>
                <TriangleAlert size={16} color={t.colors.cautionFg} style={{ marginTop: 3 }} />
                <Text variant="caption" tone="soft" style={{ flex: 1 }}>{u}</Text>
              </Row>
            ))}
          </Card>
        </Section>
      ) : null}

      {/* ── Provenance ───────────────────────────────────────────────────── */}
      <Section label="Provenance">
        <Card raised style={{ gap: space.sm }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="body" tone="soft">Model</Text>
            <Text variant="bodyMedium">{run.modelLabel}</Text>
          </Row>
          <Divider />
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="body" tone="soft">Payload fingerprint</Text>
            <Text variant="mono" tone="muted">
              {run.redactedPayloadHash?.slice(0, 12) ?? '—'}
            </Text>
          </Row>
          <Text variant="caption" tone="muted">
            The fingerprint is a one-way hash of exactly what was sent, so you can verify a run
            without AIDr. keeping a second copy of it.
          </Text>
          <Divider />
          <Row style={{ alignItems: 'flex-start', gap: space.sm }}>
            <Quote size={15} color={t.colors.inkMuted} style={{ marginTop: 3 }} />
            <Text variant="caption" tone="soft" style={{ flex: 1 }}>{run.disclaimer}</Text>
          </Row>
          <AIGeneratedLabel model={run.modelLabel ?? 'your model'} />
        </Card>
      </Section>
    </Screen>
  );
}

function confidenceTone(c: Confidence): 'kept' | 'caution' | 'neutral' {
  return c === 'high' ? 'kept' : c === 'medium' ? 'neutral' : 'caution';
}

/** `signal:restingHeartRate:7d` → `Resting heart rate · 7d`. */
function humaniseRef(ref: string): string {
  const [kind, name, period] = ref.split(':');
  if (kind === 'signal' && name) {
    const spaced = name.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
    return period ? `${spaced} · ${period}` : spaced;
  }
  if (kind === 'guideline') return 'published guidance';
  if (kind === 'doc') return 'your document';
  return ref;
}
