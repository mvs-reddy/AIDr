import React, { useCallback, useMemo, useState } from 'react';
import { View, ScrollView, TextInput, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Sparkles, ShieldCheck } from 'lucide-react-native';

import { Card, Row, StickyFooter } from '../../design-system/components/Surface';
import { Text, Eyebrow, DisplayTitle } from '../../design-system/components/Text';
import { Button } from '../../design-system/components/Controls';
import { SafetyBanner } from '../../design-system/components/Feedback';
import { useTheme } from '../../design-system/theme';
import { space, radius } from '../../design-system/tokens';

import { useSettings } from '../../state/settingsStore';
import { useHealth } from '../../state/healthStore';
import { journalRepo, newId } from '../../services/persistence/db';
import { redactionService } from '../../services/redaction/RedactionService';
import { detectEmergency, EMERGENCY_COPY } from '../../domain/safety/policy';
import { executeRun } from '../../services/ai/runner';
import { OpenAIProvider } from '../../services/ai/OpenAIProvider';
import type { JournalEntry } from '../../domain/models';

const provider = new OpenAIProvider();

/**
 * New note (spec §5.6).
 *
 * The raw words are the most sensitive text in the app. They are written to the
 * local store and *never* leave: only a redacted derivative can be reflected on,
 * and only if the user taps the reflect action. Saving without reflecting makes
 * no network call at all.
 */
export default function NewNoteScreen() {
  const t = useTheme();
  const router = useRouter();
  const cloudEnabled = useSettings((s) => s.cloudEnabled);
  const model = useSettings((s) => s.model);
  const locale = useSettings((s) => s.locale);
  const signalsFor = useHealth((s) => s.signalsFor);

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [emergency, setEmergency] = useState<{ title: string; body: string } | null>(null);

  const wordCount = useMemo(
    () => (text.trim() ? text.trim().split(/\s+/).length : 0),
    [text],
  );

  const persist = useCallback(
    async (reflection: string | null): Promise<JournalEntry> => {
      await redactionService.prepare();
      const redaction = await redactionService.redact(text);
      const entry: JournalEntry = {
        id: newId(),
        rawTextLocal: text,
        redactedText: redaction.redactedText,
        reflection,
        linkedSignalRefs: signalsFor('dailyReads').map((s) => s.ref),
        wordCount,
        createdAt: new Date().toISOString(),
      };
      await journalRepo.save(entry);
      return entry;
    },
    [text, wordCount, signalsFor],
  );

  const onSaveOnly = useCallback(async () => {
    if (!text.trim()) return;
    await persist(null);
    router.back();
  }, [text, persist, router]);

  const onSaveAndReflect = useCallback(async () => {
    if (!text.trim()) return;

    // Crisis language is handled before anything else, and it is handled locally.
    const kind = detectEmergency(text);
    if (kind) {
      setEmergency(EMERGENCY_COPY[kind]);
      await persist(null); // the words are still theirs to keep
      return;
    }

    if (!cloudEnabled) {
      await persist(null);
      Alert.alert(
        'Saved to your journal',
        'Reflections need a cloud workflow, which is currently off. Your note is saved on this device.',
      );
      router.back();
      return;
    }

    setBusy(true);
    const result = await executeRun({
      workflow: 'journalReflection',
      inputs: { fields: { note: text }, focus: [], documentIds: [], includeHealthContext: true },
      signals: signalsFor('dailyReads'),
      locale,
      model,
      provider,
      requestConsent: async () => true, // the reflect button *is* the consent action
      requestRedactionReview: async (r) => r.redactedText,
      onEmergency: (_k, copy) => setEmergency(copy),
    });
    setBusy(false);

    const reflection = result.ok
      ? [result.run.output?.headline, ...(result.run.output?.summary ?? [])].filter(Boolean).join(' ')
      : null;
    await persist(reflection);

    if (!result.ok && result.status !== 'cancelled') {
      Alert.alert('Saved, but no reflection', result.message);
    }
    router.back();
  }, [text, cloudEnabled, persist, signalsFor, locale, model, router]);

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.canvas }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: space.xl, gap: space.md }}>
        <Text variant="title" center>New note</Text>

        <View style={{ marginTop: space.md }}>
          <Eyebrow>{formatStamp()}</Eyebrow>
          <View style={{ marginTop: space.xs }}>
            <DisplayTitle lead="How are you " emphasis="feeling" trail="?" small />
          </View>
        </View>

        <Text variant="body" tone="soft">
          Jot down whatever is on your mind — how you feel, a symptom, how you slept. AIDr. files it
          into your record.
        </Text>

        {emergency ? <SafetyBanner title={emergency.title} body={emergency.body} /> : null}

        <TextInput
          multiline
          autoFocus
          value={text}
          onChangeText={setText}
          accessibilityLabel="Note text"
          placeholder=""
          style={{
            backgroundColor: t.colors.surface,
            borderRadius: radius.field,
            borderWidth: 1.5,
            borderColor: t.colors.accent,
            padding: space.md,
            minHeight: 200,
            color: t.colors.ink,
            fontFamily: 'Inter_400Regular',
            fontSize: 16 * Math.min(t.fontScale, 1.6),
            lineHeight: 24 * Math.min(t.fontScale, 1.6),
            textAlignVertical: 'top',
          }}
        />

        <Text variant="caption" tone="muted" style={{ textAlign: 'right' }}>
          {wordCount} {wordCount === 1 ? 'word' : 'words'}
        </Text>

        <Card fill="sunken" style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
          <ShieldCheck size={17} color={t.colors.keptFg} style={{ marginTop: 2 }} />
          <Text variant="caption" tone="soft" style={{ flex: 1 }}>
            Identifiers are stripped on this device before AIDr. reads it. Your raw words never leave
            your phone.
          </Text>
        </Card>
      </ScrollView>

      <StickyFooter>
        <View style={{ gap: space.xs }}>
          <Button
            label="Save & reflect"
            onPress={onSaveAndReflect}
            disabled={!text.trim()}
            loading={busy}
            icon={<Sparkles size={18} color={t.colors.onInk} />}
          />
          <Button label="Save without reflecting" kind="quiet" onPress={onSaveOnly} disabled={!text.trim()} />
        </View>
      </StickyFooter>
    </View>
  );
}

function formatStamp(now = new Date()): string {
  const date = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} · ${time}`;
}
