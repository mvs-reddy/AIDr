import React, { useCallback, useEffect, useState } from 'react';
import { View, Pressable, TextInput, StyleSheet, Alert, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft, CircleCheck, CircleAlert } from 'lucide-react-native';

import { Screen, Card, Section, Row, Divider } from '../../design-system/components/Surface';
import { Text, Eyebrow, DisplayTitle } from '../../design-system/components/Text';
import { Button } from '../../design-system/components/Controls';
import { Pill } from '../../design-system/components/Feedback';
import { useTheme } from '../../design-system/theme';
import { space, radius, MIN_TARGET, HIT_SLOP } from '../../design-system/tokens';

import { useSettings } from '../../state/settingsStore';
import { getSecret, setSecret, deleteSecret, maskSecret } from '../../services/persistence/secrets';
import { OpenAIProvider } from '../../services/ai/OpenAIProvider';

const provider = new OpenAIProvider();

/**
 * AI account setup.
 *
 * Verification is a real capabilities call, so the user learns *here* whether the
 * model they selected actually exists on their account — rather than discovering
 * it mid-run, which the no-fallback policy would turn into a hard stop.
 */
export default function AIAccountScreen() {
  const t = useTheme();
  const router = useRouter();
  const s = useSettings();

  const [key, setKey] = useState('');
  const [existing, setExisting] = useState('Not set');
  const [checking, setChecking] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'ok' | 'modelMissing' | 'bad'>('idle');

  useEffect(() => {
    getSecret('ai.openai.key').then((v) => setExisting(maskSecret(v)));
  }, []);

  const verify = useCallback(async () => {
    if (!key.trim()) return;
    setChecking(true);
    await setSecret('ai.openai.key', key.trim());

    const caps = await provider.capabilities();
    setModels(caps.models);
    setChecking(false);

    if (caps.models.length === 0) {
      setStatus('bad');
      await deleteSecret('ai.openai.key');
      return;
    }
    const has = caps.models.some((m) => m === s.model || m.startsWith(`${s.model}-`));
    setStatus(has ? 'ok' : 'modelMissing');
    if (has) {
      s.set('cloudEnabled', true);
      setExisting(maskSecret(key.trim()));
      setKey('');
    }
  }, [key, s]);

  const disconnect = useCallback(() => {
    Alert.alert(
      'Disconnect your AI account?',
      'Cloud workflows will stop. Your journal, documents, medication schedule and on-device features keep working.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await deleteSecret('ai.openai.key');
            s.set('cloudEnabled', false);
            setExisting('Not set');
            setStatus('idle');
            setModels([]);
          },
        },
      ],
    );
  }, [s]);

  return (
    <Screen>
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

      <View style={{ marginTop: space.xl }}>
        <Eyebrow>AI account</Eyebrow>
        <View style={{ marginTop: space.xs }}>
          <DisplayTitle lead="Runs use " emphasis="your" trail=" account." />
        </View>
        <Text variant="body" tone="soft" style={{ marginTop: space.sm }}>
          AIDr. calls your chosen model directly from this device under your own key. The key is held
          in the secure keystore and is never written to logs, crash reports or exports.
        </Text>
      </View>

      <Section label="Current key">
        <Card raised style={{ gap: space.sm }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="body" tone="soft">Stored key</Text>
            <Text variant="mono">{existing}</Text>
          </Row>
          {existing !== 'Not set' ? (
            <>
              <Divider />
              <Pressable
                onPress={disconnect}
                accessibilityRole="button"
                accessibilityLabel="Disconnect AI account"
                style={{ minHeight: MIN_TARGET, justifyContent: 'center' }}
              >
                <Text variant="bodyMedium" style={{ color: t.colors.removedFg }}>
                  Disconnect this account
                </Text>
              </Pressable>
            </>
          ) : null}
        </Card>
      </Section>

      <Section label={existing === 'Not set' ? 'Add a key' : 'Replace the key'}>
        <Card raised style={{ gap: space.md }}>
          <View style={{ gap: 6 }}>
            <Text variant="caption" tone="muted" style={{ letterSpacing: 0.6 }}>API KEY</Text>
            <TextInput
              value={key}
              onChangeText={(v) => { setKey(v); setStatus('idle'); }}
              placeholder="sk-…"
              placeholderTextColor={t.colors.inkMuted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              accessibilityLabel="API key"
              style={{
                backgroundColor: t.colors.surfaceSunken,
                borderRadius: radius.field,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: t.colors.border,
                paddingHorizontal: space.md,
                minHeight: MIN_TARGET + 8,
                color: t.colors.ink,
                fontFamily: 'Inter_400Regular',
                fontSize: 16,
              }}
            />
          </View>

          <Button
            label="Verify and save"
            onPress={verify}
            disabled={!key.trim()}
            loading={checking}
          />

          {status === 'ok' ? (
            <Row style={{ gap: space.xs }}>
              <CircleCheck size={17} color={t.colors.keptFg} />
              <Text variant="caption" tone="soft" style={{ flex: 1 }}>
                Verified. {s.model} is available on this account.
              </Text>
            </Row>
          ) : null}

          {status === 'modelMissing' ? (
            <Row style={{ gap: space.xs, alignItems: 'flex-start' }}>
              <CircleAlert size={17} color={t.colors.cautionFg} style={{ marginTop: 2 }} />
              <Text variant="caption" tone="soft" style={{ flex: 1 }}>
                The key works, but {s.model} is not available on this account. Because you have “no
                silent fallback” on, AIDr. will stop rather than substitute a model. Pick one of the
                models below.
              </Text>
            </Row>
          ) : null}

          {status === 'bad' ? (
            <Row style={{ gap: space.xs, alignItems: 'flex-start' }}>
              <CircleAlert size={17} color={t.colors.removedFg} style={{ marginTop: 2 }} />
              <Text variant="caption" tone="soft" style={{ flex: 1 }}>
                That key could not be verified, so it was discarded. Check it and try again.
              </Text>
            </Row>
          ) : null}
        </Card>
      </Section>

      {models.length > 0 ? (
        <Section label="Available on this account">
          <Card raised style={{ gap: space.xs }}>
            {models.slice(0, 12).map((m) => {
              const selected = m === s.model;
              return (
                <Pressable
                  key={m}
                  onPress={() => { s.set('model', m); setStatus('ok'); }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={m}
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    minHeight: MIN_TARGET,
                  }}
                >
                  <Text variant="body" tone={selected ? 'accent' : 'ink'}>{m}</Text>
                  {selected ? <Pill label="Selected" tone="accent" /> : null}
                </Pressable>
              );
            })}
          </Card>
        </Section>
      ) : null}

      <Section label="Where to get a key">
        <Card fill="sunken" style={{ gap: space.sm }}>
          <Text variant="caption" tone="soft">
            Create a key in your provider’s dashboard, then paste it here. AIDr. requests only chat
            completions; it never reads your account history or billing.
          </Text>
          <Pressable
            onPress={() => Linking.openURL('https://platform.openai.com/api-keys')}
            accessibilityRole="link"
            accessibilityLabel="Open the provider dashboard"
            style={{ minHeight: MIN_TARGET, justifyContent: 'center' }}
          >
            <Text variant="bodyMedium" tone="accent">Open the provider dashboard →</Text>
          </Pressable>
        </Card>
      </Section>
    </Screen>
  );
}
