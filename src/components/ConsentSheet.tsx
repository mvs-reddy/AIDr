import React from 'react';
import { Modal, View, ScrollView } from 'react-native';
import { ShieldCheck } from 'lucide-react-native';
import { Card, Row, StickyFooter } from '../design-system/components/Surface';
import { Text, Eyebrow, DisplayTitle } from '../design-system/components/Text';
import { Button } from '../design-system/components/Controls';
import { Pill } from '../design-system/components/Feedback';
import { useTheme } from '../design-system/theme';
import { space } from '../design-system/tokens';
import type { ConsentSummary } from '../services/ai/runner';

export interface ConsentRequest extends ConsentSummary {
  sourceName: string;
}

/**
 * The consent gate (spec §9.1, §18.1: "a cloud request cannot be created
 * without a valid consent receipt").
 *
 * This sheet is deliberately specific rather than a generic "Allow?" — it names
 * the model, the exact signal types, the redaction engine and how many spans it
 * removed, so the decision is informed rather than habitual.
 */
export function ConsentSheet({
  request,
  onDecision,
}: {
  request: ConsentRequest | null;
  onDecision: (accepted: boolean) => void;
}) {
  const t = useTheme();
  if (!request) return null;

  return (
    <Modal visible animationType={t.reduceMotion ? 'none' : 'slide'} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: t.colors.canvas }}>
        <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: space.xxl, gap: space.md }}>
          <Eyebrow>Before this leaves your phone</Eyebrow>
          <DisplayTitle lead="Send this " emphasis="summary" trail="?" small />

          <Card style={{ gap: space.sm }} raised>
            <Eyebrow>What will be sent</Eyebrow>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="body" tone="soft">Redacted text</Text>
              <Text variant="bodyMedium">{request.charactersOfText} characters</Text>
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="body" tone="soft">Identifiers removed</Text>
              <Pill label={`${request.spansRedacted} removed`} tone="removed" />
            </Row>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Text variant="body" tone="soft" style={{ flex: 1 }}>Health summaries</Text>
              <Text variant="bodyMedium" style={{ flex: 1.4, textAlign: 'right' }}>
                {request.signalTypes.length
                  ? request.signalTypes.join(', ')
                  : 'None'}
              </Text>
            </Row>
          </Card>

          <Card fill="sunken" style={{ gap: space.xs }}>
            <Row>
              <ShieldCheck size={17} color={t.colors.accent} />
              <Text variant="bodyMedium" style={{ flex: 1 }}>What stays here</Text>
            </Row>
            <Text variant="caption" tone="soft">
              Raw {request.sourceName} records, device names, original documents and your unedited
              words never leave this phone. Redaction ran locally using {request.engine}.
            </Text>
          </Card>

          <Card style={{ gap: 4 }}>
            <Eyebrow>Destination</Eyebrow>
            <Text variant="title">{request.model}</Text>
            <Text variant="caption" tone="muted">
              Under your own account. AIDr. will not switch to a different model on your behalf.
            </Text>
          </Card>
        </ScrollView>

        <StickyFooter>
          <View style={{ gap: space.xs }}>
            <Button label="Send and run" onPress={() => onDecision(true)} trailingArrow />
            <Button label="Cancel" kind="quiet" onPress={() => onDecision(false)} />
          </View>
        </StickyFooter>
      </View>
    </Modal>
  );
}
