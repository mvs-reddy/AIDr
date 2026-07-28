import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Pressable, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, ScanLine } from 'lucide-react-native';

import { Screen, Card, Section, Row } from '../../design-system/components/Surface';
import { Text, Eyebrow, DisplayTitle } from '../../design-system/components/Text';
import { Button, Field, FocusChip } from '../../design-system/components/Controls';
import { PrivacyNote, SafetyBanner } from '../../design-system/components/Feedback';
import { useTheme } from '../../design-system/theme';
import { space, radius, MIN_TARGET, HIT_SLOP } from '../../design-system/tokens';

import { workflowByKind, FOCUS_TAGS } from '../../domain/workflows';
import type { FocusTag, WorkflowInputs } from '../../domain/models';
import { useHealth } from '../../state/healthStore';
import { useSettings } from '../../state/settingsStore';
import { useRuns } from '../../state/runStore';
import { executeRun } from '../../services/ai/runner';
import { OpenAIProvider } from '../../services/ai/OpenAIProvider';
import { ConsentSheet, type ConsentRequest } from '../../components/ConsentSheet';
import { RedactionReviewSheet } from '../../components/RedactionReviewSheet';
import type { RedactionResult } from '../../services/redaction/RedactionService';
import { importDocument } from '../../services/documents/importDocument';

const provider = new OpenAIProvider();

export default function WorkflowScreen() {
  const t = useTheme();
  const router = useRouter();
  const { kind } = useLocalSearchParams<{ kind: string }>();
  const spec = workflowByKind(String(kind));

  const model = useSettings((s) => s.model);
  const cloudEnabled = useSettings((s) => s.cloudEnabled);
  const locale = useSettings((s) => s.locale);
  const { connection, sourceName, signalsFor, connect } = useHealth();
  const { begin, setStatus, appendDelta, complete, failWith } = useRuns();

  const [fields, setFields] = useState<Record<string, string>>({});
  const [focus, setFocus] = useState<FocusTag[]>([]);
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [emergency, setEmergency] = useState<{ title: string; body: string } | null>(null);

  const [consentRequest, setConsentRequest] = useState<ConsentRequest | null>(null);
  const [redactionRequest, setRedactionRequest] = useState<RedactionResult | null>(null);
  const consentResolver = useRef<((ok: boolean) => void) | null>(null);
  const redactionResolver = useRef<((text: string | null) => void) | null>(null);

  const healthConnected = connection === 'connected' || connection === 'partial';
  const signals = useMemo(
    () => (spec && healthConnected ? signalsFor(spec.healthScope) : []),
    [spec, healthConnected, signalsFor],
  );

  const requiredKey = spec?.fields.find((f) => f.required)?.key;
  const canRun = useMemo(() => {
    if (!spec) return false;
    const hasRequired = requiredKey ? Boolean(fields[requiredKey]?.trim()) : true;
    const hasAnyText = Object.values(fields).some((v) => v?.trim());
    const hasDoc = documentIds.length > 0;
    if (spec.runnableFromHealthAlone) return hasRequired && (hasAnyText || hasDoc || signals.length > 0);
    return hasRequired || hasDoc;
  }, [spec, fields, documentIds, signals, requiredKey]);

  const onScan = useCallback(async () => {
    const result = await importDocument();
    if (!result) return;
    setDocumentIds((ids) => [...ids, result.id]);
    // Merge OCR text into the primary field so the user can see and edit exactly
    // what will be redacted — never send text the user has not seen.
    const key = requiredKey ?? spec?.fields[spec.fields.length - 1].key;
    if (key) {
      setFields((f) => ({ ...f, [key]: [f[key], result.text].filter(Boolean).join('\n\n') }));
    }
  }, [requiredKey, spec]);

  const onRun = useCallback(async () => {
    if (!spec) return;
    if (!cloudEnabled) {
      Alert.alert(
        'Cloud workflows are off',
        'Turn on “Share with your AI provider” in Settings to run this. Everything on-device keeps working either way.',
        [{ text: 'Not now' }, { text: 'Open Settings', onPress: () => router.push('/(tabs)/settings') }],
      );
      return;
    }

    setBusy(true);
    setEmergency(null);
    begin(spec.kind);

    const inputs: WorkflowInputs = {
      fields,
      focus,
      documentIds,
      includeHealthContext: healthConnected,
    };

    const result = await executeRun({
      workflow: spec.kind,
      inputs,
      signals,
      locale,
      model,
      provider,
      onStatus: setStatus,
      onDelta: appendDelta,
      onEmergency: (_kind, copy) => setEmergency(copy),
      requestConsent: (summary) =>
        new Promise<boolean>((resolve) => {
          consentResolver.current = resolve;
          setConsentRequest({ ...summary, sourceName });
        }),
      requestRedactionReview: (redaction) =>
        new Promise<string | null>((resolve) => {
          redactionResolver.current = resolve;
          setRedactionRequest(redaction);
        }),
    });

    setBusy(false);
    if (result.ok) {
      await complete(result.run);
      router.replace(`/run/${result.run.id}`);
    } else if (result.status !== 'cancelled') {
      failWith(result.message);
      Alert.alert('Could not finish', result.message);
    }
  }, [
    spec, cloudEnabled, fields, focus, documentIds, healthConnected, signals,
    locale, model, begin, setStatus, appendDelta, complete, failWith, router, sourceName,
  ]);

  if (!spec) {
    return (
      <Screen>
        <Text variant="title">That workflow does not exist.</Text>
      </Screen>
    );
  }

  return (
    <>
      <Screen
        footer={
          <Button
            label={spec.ctaLabel}
            onPress={onRun}
            disabled={!canRun}
            loading={busy}
            trailingArrow
            accessibilityHint={
              canRun ? undefined : 'Add some detail or connect a health source first.'
            }
          />
        }
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={{
            width: MIN_TARGET, height: MIN_TARGET, borderRadius: MIN_TARGET / 2,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: t.colors.surface,
          }}
        >
          <ChevronLeft size={22} color={t.colors.ink} />
        </Pressable>

        <View style={{ marginTop: space.xl }}>
          <Eyebrow>Workflow</Eyebrow>
          <View style={{ marginTop: space.xs }}>
            <DisplayTitle {...spec.headline} />
          </View>
          <Text variant="body" tone="soft" style={{ marginTop: space.sm }}>
            {spec.description}
          </Text>
        </View>

        {emergency ? (
          <View style={{ marginTop: space.lg }}>
            <SafetyBanner title={emergency.title} body={emergency.body} />
          </View>
        ) : null}

        {/* ── Health context ─────────────────────────────────────────────── */}
        <Card style={{ marginTop: space.lg, gap: space.sm }} raised>
          <Eyebrow>Context included</Eyebrow>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="title">{sourceName}</Text>
              <Text variant="caption" tone="muted">
                {healthConnected
                  ? `${signals.length} signal${signals.length === 1 ? '' : 's'} · read-only`
                  : 'Not connected'}
              </Text>
            </View>
            {!healthConnected ? (
              <Button
                label="Connect"
                kind="secondary"
                full={false}
                onPress={() => connect(spec.healthScope)}
                accessibilityHint={`Asks only for the data ${spec.title} needs.`}
              />
            ) : null}
          </Row>
        </Card>

        {/* ── Fields ─────────────────────────────────────────────────────── */}
        <Section label="Add notes · optional" gap={space.md}>
          {spec.fields.map((f) => (
            <View key={f.key} style={{ gap: 6 }}>
              <Field
                label={f.label}
                placeholder={f.placeholder}
                multiline={f.multiline}
                value={fields[f.key] ?? ''}
                onChangeText={(v) => setFields((prev) => ({ ...prev, [f.key]: v }))}
              />
              {f.hint ? (
                <Text variant="caption" tone="muted">{f.hint}</Text>
              ) : null}
            </View>
          ))}
        </Section>

        {/* ── Focus chips ────────────────────────────────────────────────── */}
        {spec.showFocusChips ? (
          <Section label="Focus · optional">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
              {FOCUS_TAGS.map(({ tag, label }) => (
                <FocusChip
                  key={tag}
                  label={label}
                  selected={focus.includes(tag)}
                  onToggle={() =>
                    setFocus((prev) =>
                      prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag],
                    )
                  }
                />
              ))}
            </View>
          </Section>
        ) : null}

        {/* ── Document import ────────────────────────────────────────────── */}
        {spec.allowDocumentImport ? (
          <Pressable
            onPress={onScan}
            accessibilityRole="button"
            accessibilityLabel="Add from a document"
            accessibilityHint="Scans with the camera or picks a file. Text is extracted on this device."
            style={({ pressed }) => ({ marginTop: space.lg, opacity: pressed ? 0.9 : 1 })}
          >
            <Card
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: space.xs, minHeight: MIN_TARGET + 12, borderRadius: radius.field,
              }}
            >
              <ScanLine size={19} color={t.colors.ink} />
              <Text variant="title">Add from a document</Text>
            </Card>
          </Pressable>
        ) : null}

        {documentIds.length > 0 ? (
          <Text variant="caption" tone="muted" style={{ marginTop: space.xs }}>
            {documentIds.length} document{documentIds.length === 1 ? '' : 's'} attached · originals stay on this device
          </Text>
        ) : null}

        {/* ── Disclosure ─────────────────────────────────────────────────── */}
        <View style={{ marginTop: space.lg }}>
          <PrivacyNote>
            {`Redacted on this device, then sent with normalized health summaries to your ${model} account. Redaction is automated, so review your text first.`}
          </PrivacyNote>
        </View>
      </Screen>

      <ConsentSheet
        request={consentRequest}
        onDecision={(ok) => {
          setConsentRequest(null);
          consentResolver.current?.(ok);
          consentResolver.current = null;
        }}
      />

      <RedactionReviewSheet
        result={redactionRequest}
        onDecision={(text) => {
          setRedactionRequest(null);
          redactionResolver.current?.(text);
          redactionResolver.current = null;
        }}
      />
    </>
  );
}
