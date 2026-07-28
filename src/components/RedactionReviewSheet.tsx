import React, { useMemo, useState } from 'react';
import { Modal, View, ScrollView, TextInput, StyleSheet } from 'react-native';
import { Card, Row, StickyFooter } from '../design-system/components/Surface';
import { Text, Eyebrow, DisplayTitle } from '../design-system/components/Text';
import { Button } from '../design-system/components/Controls';
import { Pill } from '../design-system/components/Feedback';
import { useTheme } from '../design-system/theme';
import { space, radius } from '../design-system/tokens';
import type { RedactionResult } from '../services/redaction/RedactionService';

/**
 * Redaction review (spec §5.5, §16 "block cloud send until user confirms").
 *
 * Shown only when a span fell between the review and auto thresholds. The user
 * sees the *original* text with removals struck through, plus an editable copy,
 * so they can fix a false negative themselves before anything is sent.
 */
export function RedactionReviewSheet({
  result,
  onDecision,
}: {
  result: RedactionResult | null;
  onDecision: (editedText: string | null) => void;
}) {
  const t = useTheme();
  const [edited, setEdited] = useState<string | null>(null);

  const uncertain = useMemo(
    () => result?.spans.filter((s) => s.disposition === 'review') ?? [],
    [result],
  );
  const auto = useMemo(
    () => result?.spans.filter((s) => s.disposition === 'auto') ?? [],
    [result],
  );

  if (!result) return null;
  const working = edited ?? result.redactedText;

  return (
    <Modal visible animationType={t.reduceMotion ? 'none' : 'slide'} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: t.colors.canvas }}>
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: space.xxl, gap: space.md }}>
          <Eyebrow>Step · review</Eyebrow>
          <DisplayTitle lead="Check what " emphasis="leaves" trail="." small />
          <Text variant="body" tone="soft">
            AIDr. removed what it recognised. These few it is unsure about — confirm or edit them
            before anything is sent.
          </Text>

          {uncertain.length > 0 ? (
            <Card style={{ gap: space.sm }} raised>
              <Eyebrow>Needs your eyes</Eyebrow>
              {uncertain.map((s) => (
                <Row key={`${s.start}-${s.end}`} style={{ justifyContent: 'space-between' }}>
                  <Text variant="body" style={{ flex: 1, textDecorationLine: 'line-through' }} tone="soft">
                    {s.text}
                  </Text>
                  <Pill label={`${Math.round(s.confidence * 100)}% ${s.entity}`} tone="caution" />
                </Row>
              ))}
            </Card>
          ) : null}

          {auto.length > 0 ? (
            <Card style={{ gap: space.sm }} raised>
              <Eyebrow>Already removed</Eyebrow>
              {auto.slice(0, 8).map((s) => (
                <Row key={`${s.start}-${s.end}`} style={{ justifyContent: 'space-between' }}>
                  <Text variant="body" tone="soft" style={{ flex: 1, textDecorationLine: 'line-through' }}>
                    {s.text}
                  </Text>
                  <Pill label="Removed" tone="removed" />
                </Row>
              ))}
              {auto.length > 8 ? (
                <Text variant="caption" tone="muted">and {auto.length - 8} more</Text>
              ) : null}
            </Card>
          ) : null}

          <View style={{ gap: 6 }}>
            <Eyebrow>Exactly what will be sent</Eyebrow>
            <TextInput
              multiline
              value={working}
              onChangeText={setEdited}
              accessibilityLabel="Editable redacted text"
              style={{
                backgroundColor: t.colors.surface,
                borderRadius: radius.field,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: t.colors.border,
                padding: space.md,
                minHeight: 180,
                color: t.colors.ink,
                fontFamily: 'Inter_400Regular',
                fontSize: 15,
                lineHeight: 22,
                textAlignVertical: 'top',
              }}
            />
            <Text variant="caption" tone="muted">
              Placeholders like [NAME_1] are intentional. The model is told to leave them alone.
            </Text>
          </View>
        </ScrollView>

        <StickyFooter>
          <View style={{ gap: space.xs }}>
            <Button label="Looks right, continue" onPress={() => onDecision(working)} trailingArrow />
            <Button label="Cancel this run" kind="quiet" onPress={() => onDecision(null)} />
          </View>
        </StickyFooter>
      </View>
    </Modal>
  );
}
