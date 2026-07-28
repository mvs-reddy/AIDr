import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, ScrollView, TextInput, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import {
  ChevronLeft, ShieldCheck, IdCard, Sparkles, ChartNoAxesColumn,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card, Row, Divider, StickyFooter } from '../../design-system/components/Surface';
import { Text, Eyebrow, DisplayTitle } from '../../design-system/components/Text';
import { Button, SelectRow } from '../../design-system/components/Controls';
import { Pill, ProgressDots } from '../../design-system/components/Feedback';
import { useTheme } from '../../design-system/theme';
import { space, radius, MIN_TARGET, HIT_SLOP } from '../../design-system/tokens';

import { useSettings } from '../../state/settingsStore';
import { useHealth } from '../../state/healthStore';
import { redactionPack } from '../../services/redaction/nerBackend';
import { redactionService } from '../../services/redaction/RedactionService';
import { SCOPE_SIGNALS } from '../../services/health/HealthAdapter';
import { setSecret } from '../../services/persistence/secrets';

const STEPS = ['welcome', 'howItWorks', 'privacy', 'health', 'account', 'you', 'ready'] as const;
type Step = (typeof STEPS)[number];

/** The sample the redaction demo runs on. Fictional, and never sent anywhere. */
const DEMO_TEXT =
  'Sarah Mills, DOB 14/03/1981, NHS 485 777 3456. Tired in the afternoons for two weeks. Resting heart rate trending up.';

export default function Onboarding() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const step = STEPS[index];

  const s = useSettings();
  const { sourceName, connection, connect, availability, bootstrap } = useHealth();

  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [packInstalled, setPackInstalled] = useState(false);
  const [packBusy, setPackBusy] = useState(false);
  const [demo, setDemo] = useState<{ removed: string[]; kept: string[] }>({ removed: [], kept: [] });

  useEffect(() => {
    bootstrap();
    redactionPack.status().then((p) => setPackInstalled(p.installed));
  }, [bootstrap]);

  // Run the real redaction engine on the sample, so the demo cannot drift from
  // the behaviour it is describing.
  useEffect(() => {
    (async () => {
      await redactionService.prepare();
      const result = await redactionService.redact(DEMO_TEXT);
      setDemo({
        removed: result.spans.map((sp) => sp.text),
        kept: ['tired in the afternoons for two weeks', 'resting heart rate trending up'],
      });
    })();
  }, [packInstalled]);

  const next = useCallback(() => {
    if (index < STEPS.length - 1) setIndex((i) => i + 1);
    else {
      s.set('firstName', name.trim() || null);
      s.set('onboardingComplete', true);
      router.replace('/');
    }
  }, [index, name, s, router]);

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  const healthConnected = connection === 'connected' || connection === 'partial';

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.canvas }}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingTop: insets.top + space.sm,
          paddingBottom: space.xl,
          gap: space.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        {index > 0 ? (
          <Pressable
            onPress={back}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Go back a step"
            style={{
              width: MIN_TARGET, height: MIN_TARGET, borderRadius: MIN_TARGET / 2,
              alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.surface,
            }}
          >
            <ChevronLeft size={22} color={t.colors.ink} />
          </Pressable>
        ) : (
          <View style={{ height: MIN_TARGET }} />
        )}

        <ProgressDots count={STEPS.length} index={index} />

        {step === 'welcome' ? <Welcome /> : null}
        {step === 'howItWorks' ? <HowItWorks /> : null}
        {step === 'privacy' ? (
          <Privacy
            demo={demo}
            packInstalled={packInstalled}
            busy={packBusy}
            onInstall={async () => {
              setPackBusy(true);
              await redactionPack.install();
              setPackInstalled((await redactionPack.status()).installed);
              setPackBusy(false);
            }}
          />
        ) : null}
        {step === 'health' ? (
          <HealthStep
            sourceName={sourceName}
            connected={healthConnected}
            unsupported={availability?.state === 'unsupported' ? availability.reason : null}
          />
        ) : null}
        {step === 'account' ? (
          <AccountStep apiKey={apiKey} onChange={setApiKey} model={s.model} />
        ) : null}
        {step === 'you' ? <YouStep name={name} onChange={setName} /> : null}
        {step === 'ready' ? (
          <ReadyStep
            healthConnected={healthConnected}
            sourceName={sourceName}
            packInstalled={packInstalled}
            accountConnected={Boolean(apiKey.trim()) || s.cloudEnabled}
            analytics={s.analyticsConsent}
            onToggleAnalytics={(v) => s.set('analyticsConsent', v)}
          />
        ) : null}
      </ScrollView>

      <StickyFooter>
        <View style={{ gap: space.xs }}>
          {step === 'health' && !healthConnected ? (
            <>
              <Button
                label={`Connect ${sourceName}`}
                onPress={async () => {
                  await connect('dailyReads');
                }}
                icon={<IdCard size={18} color={t.colors.onInk} />}
              />
              <Button label="Not now" kind="quiet" onPress={next} />
            </>
          ) : step === 'account' ? (
            <>
              <Button
                label="Save and continue"
                onPress={async () => {
                  if (apiKey.trim()) {
                    await setSecret('ai.openai.key', apiKey.trim());
                    s.set('cloudEnabled', true);
                  }
                  next();
                }}
                trailingArrow
              />
              <Button label="Set up later" kind="quiet" onPress={next} />
            </>
          ) : step === 'you' ? (
            <Button label={name.trim() ? 'Continue' : 'Skip'} onPress={next} trailingArrow />
          ) : (
            <Button
              label={
                step === 'welcome' ? 'Get started'
                : step === 'ready' ? 'Enter AIDr.'
                : 'Continue'
              }
              onPress={next}
              trailingArrow
            />
          )}
        </View>
      </StickyFooter>
    </View>
  );
}

// ─── Steps ───────────────────────────────────────────────────────────────────

function Welcome() {
  const t = useTheme();
  return (
    <>
      <Row style={{ gap: space.sm, alignItems: 'center' }}>
        <View
          style={{
            width: 44, height: 44, borderRadius: 14,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: t.colors.ink,
          }}
        >
          <Text variant="displaySm" tone="onInk" maxScale={1}>A</Text>
        </View>
        <View>
          <Eyebrow>AIDr.</Eyebrow>
          <Text variant="body" tone="soft">Private health intelligence</Text>
        </View>
      </Row>

      <Eyebrow>Welcome</Eyebrow>
      <DisplayTitle lead="Understand your " emphasis="health record" trail=" before the visit." />
      <Text variant="body" tone="soft">
        AIDr. reads the health data you authorise, redacts identifiers on your device, then helps you
        turn your own numbers into questions worth asking.
      </Text>

      <Card raised padded={false}>
        {[
          {
            icon: ShieldCheck,
            title: 'On-device redaction first',
            body: 'Names, dates and identifiers are stripped locally before anything is sent.',
          },
          {
            icon: IdCard,
            title: 'You stay in control',
            body: 'Read-only health access, normalized summaries only, kept on your device.',
          },
          {
            icon: Sparkles,
            title: 'Guided workflows',
            body: 'Visit prep, result explanations, medication review and document summaries.',
          },
        ].map((f, i) => {
          const Icon = f.icon;
          return (
            <View key={f.title}>
              {i > 0 ? <Divider /> : null}
              <Row style={{ padding: space.lg, alignItems: 'flex-start', gap: space.md }}>
                <View
                  style={{
                    width: 38, height: 38, borderRadius: 19,
                    alignItems: 'center', justifyContent: 'center',
                    backgroundColor: t.colors.accentSoft,
                  }}
                >
                  <Icon size={18} color={t.colors.accent} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text variant="title">{f.title}</Text>
                  <Text variant="caption" tone="soft">{f.body}</Text>
                </View>
              </Row>
            </View>
          );
        })}
      </Card>
    </>
  );
}

function HowItWorks() {
  const t = useTheme();
  const stages = [
    { label: 'On your phone', body: 'Read authorised health data, extract document text, build your personal baselines.' },
    { label: 'Still on your phone', body: 'Detect and remove names, dates and identifiers. Show you exactly what is left.' },
    { label: 'You decide', body: 'Nothing is sent until you approve the summary on screen.' },
    { label: 'In the cloud', body: 'Your chosen model reasons over the redacted text and returns a structured brief.' },
    { label: 'Back on your phone', body: 'AIDr. checks every claim against your data before showing it, and saves it locally.' },
  ];
  return (
    <>
      <Eyebrow>Step 2 · how it works</Eyebrow>
      <DisplayTitle lead="Local first, then " emphasis="your choice" />
      <Text variant="body" tone="soft">
        This sequence is fixed. AIDr. cannot skip a stage, and it cannot reorder them.
      </Text>
      <Card raised padded={false}>
        {stages.map((stage, i) => (
          <View key={stage.label}>
            {i > 0 ? <Divider /> : null}
            <Row style={{ padding: space.lg, alignItems: 'flex-start', gap: space.md }}>
              <Text variant="mono" tone="accent" style={{ width: 22, marginTop: 2 }}>
                {String(i + 1).padStart(2, '0')}
              </Text>
              <View style={{ flex: 1, gap: 3 }}>
                <Text variant="eyebrow" tone="muted">{stage.label}</Text>
                <Text variant="body">{stage.body}</Text>
              </View>
            </Row>
          </View>
        ))}
      </Card>
    </>
  );
}

function Privacy({
  demo,
  packInstalled,
  busy,
  onInstall,
}: {
  demo: { removed: string[]; kept: string[] };
  packInstalled: boolean;
  busy: boolean;
  onInstall: () => void;
}) {
  const t = useTheme();
  return (
    <>
      <Eyebrow>Step 3 · privacy</Eyebrow>
      <DisplayTitle lead="Redaction that " emphasis="never" trail=" leaves the phone." />
      <Text variant="body" tone="soft">
        Names, dates and identifiers are removed on this device before any text reaches your model.
        Install the clinical PII pack for the strongest redaction, or skip it and AIDr. uses your
        device’s built-in engine.
      </Text>

      <Card raised style={{ gap: space.sm }}>
        <Eyebrow>What leaves your phone</Eyebrow>
        {demo.removed.map((text) => (
          <Row key={text} style={{ justifyContent: 'space-between', gap: space.sm }}>
            <Text
              variant="body"
              tone="soft"
              style={{ flex: 1, textDecorationLine: 'line-through' }}
            >
              {text}
            </Text>
            <Pill label="Removed" tone="removed" />
          </Row>
        ))}
        <Divider />
        {demo.kept.map((text) => (
          <Row key={text} style={{ justifyContent: 'space-between', gap: space.sm }}>
            <Text variant="body" style={{ flex: 1 }}>{text}</Text>
            <Pill label="Kept" tone="kept" />
          </Row>
        ))}
        <Text variant="caption" tone="muted">
          Run live on a fictional sample by the same engine your real notes go through.
        </Text>
      </Card>

      <Card raised style={{ gap: space.sm }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row style={{ flex: 1, gap: space.sm }}>
            <View
              style={{
                width: 34, height: 34, borderRadius: 10,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: t.colors.accentSoft,
              }}
            >
              <ShieldCheck size={17} color={t.colors.accent} />
            </View>
            <View style={{ gap: 2 }}>
              <Text variant="title">Clinical PII pack</Text>
              <Text variant="caption" tone="muted">On-device · about 40 MB</Text>
            </View>
          </Row>
          {packInstalled ? <Pill label="Ready" tone="kept" /> : null}
        </Row>
        {!packInstalled ? (
          <Button label="Install pack" kind="secondary" onPress={onInstall} loading={busy} />
        ) : (
          <Text variant="caption" tone="soft">Cached and ready for offline runs.</Text>
        )}
      </Card>
    </>
  );
}

function HealthStep({
  sourceName,
  connected,
  unsupported,
}: {
  sourceName: string;
  connected: boolean;
  unsupported: string | null;
}) {
  const t = useTheme();
  const types = useMemo(
    () => [...new Set([...SCOPE_SIGNALS.dailyReads, ...SCOPE_SIGNALS.visitPrep])],
    [],
  );
  return (
    <>
      <Eyebrow>Step 4 · health</Eyebrow>
      <DisplayTitle lead="Your " emphasis="vitals" trail=", with your permission." />
      <Text variant="body" tone="soft">
        {unsupported ??
          `Connect ${sourceName} so workflows understand your trends. Read-only, and only normalized summaries ever leave the device.`}
      </Text>

      {!unsupported ? (
        <Card raised style={{ gap: space.sm }}>
          <Eyebrow>We read · read-only</Eyebrow>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {types.map((type) => (
              <View
                key={type}
                style={{
                  paddingHorizontal: space.sm,
                  paddingVertical: 7,
                  borderRadius: radius.chip,
                  backgroundColor: t.colors.surfaceSunken,
                }}
              >
                <Text variant="eyebrow" tone="soft" maxScale={1.35}>
                  {humanSignal(type)}
                </Text>
              </View>
            ))}
          </View>
          <Divider />
          <Row style={{ alignItems: 'flex-start', gap: space.sm }}>
            <ShieldCheck size={16} color={t.colors.accent} style={{ marginTop: 2 }} />
            <Text variant="caption" tone="soft" style={{ flex: 1 }}>
              Device names and raw records stay on this device. AIDr. asks for more only when you turn
              on a feature that needs it.
            </Text>
          </Row>
        </Card>
      ) : null}

      {connected ? <Pill label={`${sourceName} connected`} tone="kept" /> : null}
    </>
  );
}

function AccountStep({
  apiKey,
  onChange,
  model,
}: {
  apiKey: string;
  onChange: (v: string) => void;
  model: string;
}) {
  const t = useTheme();
  return (
    <>
      <Eyebrow>Step 5 · your model</Eyebrow>
      <DisplayTitle lead="Runs use " emphasis="your" trail=" account." />
      <Text variant="body" tone="soft">
        AIDr. calls {model} under your own API key. The key is stored in this device’s secure keystore
        and never appears in logs, crash reports or exports.
      </Text>

      <View style={{ gap: 6 }}>
        <Text variant="caption" tone="muted" style={{ letterSpacing: 0.6 }}>API KEY</Text>
        <TextInput
          value={apiKey}
          onChangeText={onChange}
          placeholder="sk-…"
          placeholderTextColor={t.colors.inkMuted}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          accessibilityLabel="API key"
          style={{
            backgroundColor: t.colors.surface,
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

      <Card fill="sunken" style={{ gap: space.xs }}>
        <Text variant="bodyMedium">You can skip this</Text>
        <Text variant="caption" tone="soft">
          Without a model, AIDr. still reads your health data, keeps your journal, imports documents
          and tracks medication — all on this device. Only the cloud workflows wait.
        </Text>
      </Card>
    </>
  );
}

function YouStep({ name, onChange }: { name: string; onChange: (v: string) => void }) {
  const t = useTheme();
  return (
    <>
      <Eyebrow>Step 6 · you</Eyebrow>
      <DisplayTitle lead="What should we " emphasis="call" trail=" you?" />
      <Text variant="body" tone="soft">
        Just a first name, so AIDr. can greet you. It stays on your device and is never sent
        anywhere — including to your model.
      </Text>
      <TextInput
        value={name}
        onChangeText={onChange}
        placeholder="First name"
        placeholderTextColor={t.colors.inkMuted}
        autoCapitalize="words"
        accessibilityLabel="First name"
        style={{
          backgroundColor: t.colors.surface,
          borderRadius: radius.field,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: t.colors.border,
          paddingHorizontal: space.md,
          minHeight: MIN_TARGET + 12,
          color: t.colors.ink,
          fontFamily: 'Inter_400Regular',
          fontSize: 17,
        }}
      />
    </>
  );
}

function ReadyStep({
  healthConnected,
  sourceName,
  packInstalled,
  accountConnected,
  analytics,
  onToggleAnalytics,
}: {
  healthConnected: boolean;
  sourceName: string;
  packInstalled: boolean;
  accountConnected: boolean;
  analytics: boolean;
  onToggleAnalytics: (v: boolean) => void;
}) {
  const t = useTheme();
  return (
    <>
      <Eyebrow>Ready</Eyebrow>
      <DisplayTitle lead="Ready when " emphasis="you" trail=" are." />

      <Card raised padded={false}>
        <View style={{ padding: space.lg }}>
          <SelectRow
            title="Your model"
            description={accountConnected ? 'Connected' : 'Set up later · asked before cloud actions'}
            selected={accountConnected}
          />
        </View>
        <Divider />
        <View style={{ padding: space.lg }}>
          <SelectRow
            title="AI-generated output is labelled"
            description="Plain disclosure shown on every AI result"
            selected
          />
        </View>
        <Divider />
        <View style={{ padding: space.lg }}>
          <SelectRow
            title="On-device redaction"
            description={packInstalled ? 'Clinical PII pack · on-device' : 'Built-in engine · on-device'}
            selected
          />
        </View>
        <Divider />
        <View style={{ padding: space.lg }}>
          <SelectRow
            title={sourceName}
            description={healthConnected ? 'Connected · read-only' : 'Skipped · connect later in Settings'}
            selected={healthConnected}
          />
        </View>
      </Card>

      <Pressable
        onPress={() => onToggleAnalytics(!analytics)}
        accessibilityRole="switch"
        accessibilityState={{ checked: analytics }}
        accessibilityLabel="Share anonymous usage analytics"
        style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', minHeight: MIN_TARGET }}
      >
        <ChartNoAxesColumn size={17} color={t.colors.inkMuted} style={{ marginTop: 2 }} />
        <Text variant="caption" tone="muted" style={{ flex: 1 }}>
          AIDr. shares anonymous usage stats to improve the app — never your health data, documents or
          anything you type. Tap to turn {analytics ? 'off' : 'on'}.
        </Text>
        <Pill label={analytics ? 'On' : 'Off'} tone={analytics ? 'accent' : 'neutral'} />
      </Pressable>
    </>
  );
}

function humanSignal(type: string): string {
  const map: Record<string, string> = {
    steps: 'Steps',
    activeEnergy: 'Move',
    restingHeartRate: 'Resting heart rate',
    sleepDuration: 'Sleep',
    weight: 'Weight',
    bloodPressureSystolic: 'Blood pressure',
    bloodPressureDiastolic: 'Blood pressure',
  };
  return (map[type] ?? type.replace(/([A-Z])/g, ' $1')).trim();
}
