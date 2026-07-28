import React, { useCallback, useEffect, useState } from 'react';
import { View, Pressable, Alert, Linking, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Cloud, CloudOff, Palette, Bell, FileClock, ShieldCheck, Share2,
  ChartNoAxesColumn, IdCard, Info, Sunrise, Sun, Moon, TrendingUp, Trash2, Download,
} from 'lucide-react-native';

import { Screen, Card, Section, Row, Divider } from '../../design-system/components/Surface';
import { Text, Eyebrow, DisplayTitle } from '../../design-system/components/Text';
import { Button, ToggleRow } from '../../design-system/components/Controls';
import { Pill } from '../../design-system/components/Feedback';
import { useTheme } from '../../design-system/theme';
import { accents, space, radius, MIN_TARGET, type AccentName, type DarkStyle, type ThemeMode } from '../../design-system/tokens';

import { useSettings } from '../../state/settingsStore';
import { useHealth } from '../../state/healthStore';
import { rescheduleBriefs } from '../../services/notifications/dailyBriefs';
import { configureNotifications } from '../../services/notifications/medicationScheduler';
import { privacySummary } from '../../services/audit/privacyLog';
import { redactionPack } from '../../services/redaction/nerBackend';
import { getSecret, maskSecret, purgeAllSecrets } from '../../services/persistence/secrets';
import { exportsRepo, resetEverything } from '../../services/persistence/db';
import type { SharedExport } from '../../domain/models';
import { DISCLAIMER } from '../../domain/safety/policy';

const APP_VERSION = '1.0.0 (1)';

const BRIEF_META = {
  morning: { icon: Sunrise, label: 'Morning read', hint: 'How your body recovered overnight' },
  midday: { icon: Sun, label: 'Midday check', hint: 'Movement and the afternoon' },
  evening: { icon: Moon, label: 'Evening recap', hint: 'The day, closed' },
  weekly: { icon: TrendingUp, label: 'Weekly summary', hint: 'Your longer arc, once a week' },
} as const;

export default function SettingsScreen() {
  const t = useTheme();
  const router = useRouter();
  const s = useSettings();
  const { sourceName, connection, sources, connect, availability } = useHealth();

  const [apiKeyMask, setApiKeyMask] = useState('Not set');
  const [packState, setPackState] = useState<{ installed: boolean; available: boolean; sizeBytes: number }>({
    installed: false, available: false, sizeBytes: 0,
  });
  const [privacy, setPrivacy] = useState({ total: 0, local: 0, cloud: 0 });
  const [exports, setExports] = useState<SharedExport[]>([]);

  const refresh = useCallback(async () => {
    setApiKeyMask(maskSecret(await getSecret('ai.openai.key')));
    setPackState(await redactionPack.status());
    setPrivacy(await privacySummary());
    setExports(await exportsRepo.list());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onBriefsToggle = useCallback(
    async (enabled: boolean) => {
      if (enabled) {
        const granted = await configureNotifications();
        if (!granted) {
          Alert.alert(
            'Notifications are off',
            'Turn on notifications for AIDr. in your device settings to receive daily reads.',
            [{ text: 'Not now' }, { text: 'Open settings', onPress: () => Linking.openSettings() }],
          );
          return;
        }
      }
      s.set('briefsEnabled', enabled);
      await rescheduleBriefs(s.briefs, enabled);
    },
    [s],
  );

  const onDeleteEverything = useCallback(() => {
    Alert.alert(
      'Delete all local data?',
      'This removes every run, note, document, lab result, medication schedule, derived signal and cached export from this device. It cannot be undone. AIDr. stays installed and usable.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: async () => {
            await resetEverything();
            await purgeAllSecrets();
            s.reset();
            await refresh();
          },
        },
      ],
    );
  }, [s, refresh]);

  return (
    <Screen tabBarInset>
      <Eyebrow>Settings</Eyebrow>
      <View style={{ marginTop: space.xs }}>
        <DisplayTitle lead="Control your " emphasis="privacy" />
      </View>
      <Text variant="body" tone="soft" style={{ marginTop: space.sm }}>
        Manage your AI account, {sourceName} access, model status and local data.
      </Text>

      {/* ── Model ────────────────────────────────────────────────────────── */}
      <Section label="Model">
        <Card raised style={{ gap: space.sm }}>
          <Text variant="displaySm">{s.model}</Text>
          <Row style={{ gap: space.xs, flexWrap: 'wrap' }}>
            <Pill
              label={s.cloudEnabled ? 'Cloud enabled' : 'On-device only'}
              tone={s.cloudEnabled ? 'accent' : 'neutral'}
            />
            {s.noFallback ? <Pill label="No fallback" tone="kept" /> : <Pill label="Fallback allowed" tone="caution" />}
          </Row>
          <Divider />
          <ToggleRow
            title="No silent fallback"
            description="If this model is unavailable, AIDr. stops and tells you rather than quietly using a different one."
            value={s.noFallback}
            onValueChange={(v) => s.set('noFallback', v)}
          />
        </Card>
      </Section>

      {/* ── Appearance ───────────────────────────────────────────────────── */}
      <Section label="Appearance">
        <Card raised style={{ gap: space.md }}>
          <Row>
            <Palette size={17} color={t.colors.accent} />
            <Text variant="eyebrow" tone="muted">ACCENT</Text>
          </Row>
          <Row style={{ gap: space.lg }}>
            {(Object.keys(accents) as AccentName[]).map((name) => {
              const selected = s.accent === name;
              return (
                <Pressable
                  key={name}
                  onPress={() => s.set('accent', name)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${accents[name].label} accent`}
                  style={{ alignItems: 'center', gap: 6, minHeight: MIN_TARGET }}
                >
                  <View
                    style={{
                      width: 34, height: 34, borderRadius: 17,
                      backgroundColor: accents[name].base,
                      borderWidth: selected ? 3 : 0,
                      borderColor: t.colors.ink,
                    }}
                  />
                  <Text variant="caption" tone={selected ? 'ink' : 'muted'}>
                    {accents[name].label}
                  </Text>
                </Pressable>
              );
            })}
          </Row>

          <Divider />
          <Text variant="eyebrow" tone="muted">THEME</Text>
          <Row style={{ gap: space.sm }}>
            {(['system', 'light', 'dark'] as ThemeMode[]).map((mode) => (
              <ChoiceTile
                key={mode}
                label={mode === 'system' ? 'System' : mode === 'light' ? 'Light' : 'Dark'}
                selected={s.themeMode === mode}
                onPress={() => s.set('themeMode', mode)}
              />
            ))}
          </Row>
          <Text variant="caption" tone="muted">
            Follows your device: light by day, dark at night.
          </Text>

          {(s.themeMode === 'dark' || s.themeMode === 'system') ? (
            <>
              <Divider />
              <Text variant="eyebrow" tone="muted">DARK STYLE</Text>
              <Row style={{ gap: space.sm }}>
                {(['elevated', 'warmInk', 'dim'] as DarkStyle[]).map((style) => (
                  <ChoiceTile
                    key={style}
                    label={style === 'elevated' ? 'Elevated' : style === 'warmInk' ? 'Warm ink' : 'Dim'}
                    selected={s.darkStyle === style}
                    onPress={() => s.set('darkStyle', style)}
                  />
                ))}
              </Row>
            </>
          ) : null}
        </Card>
      </Section>

      {/* ── Daily briefs ─────────────────────────────────────────────────── */}
      <Section label="Daily briefs">
        <Card raised style={{ gap: space.sm }}>
          <Row>
            <Bell size={17} color={t.colors.accent} />
            <View style={{ flex: 1 }}>
              <ToggleRow
                title="Brief reminders"
                description="Gentle nudges that open straight to that brief. Notifications never include any health detail."
                value={s.briefsEnabled}
                onValueChange={onBriefsToggle}
              />
            </View>
          </Row>

          {s.briefs.map((brief) => {
            const meta = BRIEF_META[brief.kind];
            const Icon = meta.icon;
            return (
              <View key={brief.kind}>
                <Divider />
                <Row style={{ marginTop: space.sm }}>
                  <Icon size={17} color={t.colors.inkMuted} />
                  <View style={{ flex: 1 }}>
                    <ToggleRow
                      title={meta.label}
                      description={meta.hint}
                      value={brief.enabled}
                      disabled={!s.briefsEnabled}
                      onValueChange={async (v) => {
                        s.setBrief(brief.kind, { enabled: v });
                        await rescheduleBriefs(
                          s.briefs.map((b) => (b.kind === brief.kind ? { ...b, enabled: v } : b)),
                          s.briefsEnabled,
                        );
                      }}
                    />
                  </View>
                  <Text variant="bodyMedium" tone={brief.enabled ? 'ink' : 'muted'}>
                    {formatTime(brief.hour, brief.minute)}
                  </Text>
                </Row>
              </View>
            );
          })}
        </Card>
      </Section>

      {/* ── On-device redaction ──────────────────────────────────────────── */}
      <Section label="On-device redaction">
        <Card raised style={{ gap: space.sm }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="title">Clinical PII pack</Text>
              <Text variant="caption" tone="muted">
                {packState.installed
                  ? `Ready · cached for offline runs${packState.sizeBytes ? ` · ${(packState.sizeBytes / 1e6).toFixed(0)} MB` : ''}`
                  : packState.available
                    ? 'Not installed. AIDr. is using your device’s built-in redaction.'
                    : 'Not available in this build.'}
              </Text>
            </View>
            {packState.installed ? <Pill label="Ready" tone="kept" /> : null}
          </Row>
          {packState.available ? (
            <Button
              label={packState.installed ? 'Remove pack' : 'Install pack (~40 MB)'}
              kind="secondary"
              onPress={async () => {
                if (packState.installed) await redactionPack.remove();
                else await redactionPack.install();
                setPackState(await redactionPack.status());
              }}
              accessibilityHint="Stronger redaction of names and identifiers in clinical text. Runs entirely on this device."
            />
          ) : null}
        </Card>
      </Section>

      {/* ── Audit traces ─────────────────────────────────────────────────── */}
      <Section label="Audit traces · private">
        <Card raised style={{ gap: space.sm }}>
          <Row>
            <FileClock size={17} color={t.colors.accent} />
            <Text variant="title" style={{ flex: 1 }}>Run traces</Text>
          </Row>
          <Text variant="caption" tone="soft">
            Optional. When on, each completed run appends a timestamped line to a private dataset you
            choose. Traces record timings, the model and a payload hash — never your text, health
            values or documents.
          </Text>
          <Text variant="caption" tone="muted">
            {s.auditTraceDataset ? `Writing to ${s.auditTraceDataset}` : 'Off'}
          </Text>
        </Card>
      </Section>

      {/* ── Privacy log ──────────────────────────────────────────────────── */}
      <Section label="Privacy log">
        <Card raised style={{ gap: space.sm }}>
          <Row style={{ gap: space.xs, flexWrap: 'wrap' }}>
            <Pill label="Redacted before cloud" tone="accent" />
          </Row>
          <Text variant="caption" tone="soft">
            Redacted document text and normalized health summaries are sent to {s.model} under your
            own account to generate results. Redaction is automated, so review your text first.
          </Text>
          <Text variant="caption" tone="soft">
            Notes you write and any patterns AIDr. notices stay on your device. They are never shared
            with us or used to train anything.
          </Text>
          <Divider />
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="body" tone="soft">Runs recorded</Text>
            <Text variant="bodyMedium">
              {privacy.total} · {privacy.local} stayed local
            </Text>
          </Row>
          <Divider />
          <ToggleRow
            title={`Share with ${s.model}`}
            description="Required to run cloud workflows. Turn off to keep everything on-device; AIDr. asks again before the next run."
            value={s.cloudEnabled}
            onValueChange={(v) => s.set('cloudEnabled', v)}
          />
        </Card>
      </Section>

      {/* ── Shared exports ───────────────────────────────────────────────── */}
      <Section label="Shared exports">
        <Card raised style={{ gap: space.sm }}>
          <Row>
            <Share2 size={17} color={t.colors.accent} />
            <Text variant="title" style={{ flex: 1 }}>
              {exports.length === 0 ? 'No active clinician exports' : `${exports.length} export${exports.length === 1 ? '' : 's'}`}
            </Text>
          </Row>
          {exports.length === 0 ? (
            <Text variant="caption" tone="muted">
              Create one from a completed run or a brief.
            </Text>
          ) : (
            exports.map((e) => (
              <View key={e.id}>
                <Divider />
                <Row style={{ marginTop: space.sm, justifyContent: 'space-between' }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="bodyMedium">{e.label}</Text>
                    <Text variant="caption" tone="muted">
                      {e.revokedAt ? 'Revoked' : `Expires ${new Date(e.expiresAt).toLocaleDateString()}`}
                    </Text>
                  </View>
                  {!e.revokedAt ? (
                    <Pressable
                      onPress={async () => {
                        await exportsRepo.revoke(e.id);
                        setExports(await exportsRepo.list());
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Revoke ${e.label}`}
                      style={{ minHeight: MIN_TARGET, justifyContent: 'center' }}
                    >
                      <Text variant="bodyMedium" tone="accent">Revoke</Text>
                    </Pressable>
                  ) : null}
                </Row>
              </View>
            ))
          )}
          <Text variant="caption" tone="muted">
            Revoking stops future access. It cannot pull back a file or screenshot someone already
            saved.
          </Text>
        </Card>
      </Section>

      {/* ── Analytics ────────────────────────────────────────────────────── */}
      <Section label="Analytics">
        <Card raised style={{ gap: space.sm }}>
          <Row>
            <ChartNoAxesColumn size={17} color={t.colors.accent} />
            <View style={{ flex: 1 }}>
              <ToggleRow
                title="Share anonymous usage analytics"
                description="Screens viewed, features used, crash counts. Never your health data, documents or anything you type. No ads, no cross-app tracking."
                value={s.analyticsConsent}
                onValueChange={(v) => s.set('analyticsConsent', v)}
              />
            </View>
          </Row>
        </Card>
      </Section>

      {/* ── AI account ───────────────────────────────────────────────────── */}
      <Section label="AI account">
        <Card raised style={{ gap: space.sm }}>
          <Row>
            {s.cloudEnabled ? <Cloud size={17} color={t.colors.accent} /> : <CloudOff size={17} color={t.colors.inkMuted} />}
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="title">{apiKeyMask === 'Not set' ? 'Not connected' : 'Connected'}</Text>
              <Text variant="caption" tone="muted">API key {apiKeyMask}</Text>
            </View>
          </Row>
          <Button
            label={apiKeyMask === 'Not set' ? 'Connect your AI account' : 'Replace key'}
            kind="secondary"
            onPress={() => router.push('/settings/ai-account')}
          />
          <Text variant="caption" tone="muted">
            Runs use your own account. The key is stored in this device’s secure keystore and is never
            included in logs, crash reports or exports.
          </Text>
        </Card>
      </Section>

      {/* ── Health source ────────────────────────────────────────────────── */}
      <Section label={sourceName}>
        <Card raised style={{ gap: space.sm }}>
          <Row>
            <IdCard size={17} color={t.colors.accent} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="title">
                {connection === 'connected' ? 'Connected'
                  : connection === 'partial' ? 'Partly connected'
                  : connection === 'unavailable' ? 'Not available on this device'
                  : 'Not connected'}
              </Text>
              <Text variant="caption" tone="muted">
                {availability?.state === 'unsupported'
                  ? availability.reason
                  : `AIDr. reads ${sourceName} only, never writes. You choose exactly which data types it can read.`}
              </Text>
            </View>
          </Row>

          {sources.length > 0 ? (
            <>
              <Divider />
              <Text variant="eyebrow" tone="muted">CONNECTED SOURCES</Text>
              {sources.map((src) => (
                <Row key={src.localId} style={{ justifyContent: 'space-between' }}>
                  <Text variant="body">{src.displayName}</Text>
                  <Text variant="caption" tone="muted">
                    {src.lastSync ? new Date(src.lastSync).toLocaleDateString() : 'No recent data'}
                  </Text>
                </Row>
              ))}
              <Text variant="caption" tone="muted">
                When two sources record the same activity, AIDr. uses the highest-priority one rather
                than adding them together.
              </Text>
            </>
          ) : null}

          <Button
            label={connection === 'notConnected' ? `Connect ${sourceName}` : `Manage access in ${sourceName}`}
            kind="secondary"
            onPress={() =>
              connection === 'notConnected'
                ? connect('dailyReads')
                : require('../../services/health').healthAdapter().openPlatformSettings()
            }
          />
        </Card>
      </Section>

      {/* ── Local data ───────────────────────────────────────────────────── */}
      <Section label="Local data">
        <Card raised style={{ gap: space.sm }}>
          <Row>
            <Download size={17} color={t.colors.inkMuted} />
            <Text variant="body" style={{ flex: 1 }}>Export a copy of everything</Text>
          </Row>
          <Divider />
          <Pressable
            onPress={onDeleteEverything}
            accessibilityRole="button"
            accessibilityLabel="Delete all local data"
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: MIN_TARGET }}
          >
            <Trash2 size={17} color={t.colors.removedFg} />
            <Text variant="bodyMedium" style={{ color: t.colors.removedFg, flex: 1 }}>
              Delete all local data
            </Text>
          </Pressable>
        </Card>
      </Section>

      {/* ── About ────────────────────────────────────────────────────────── */}
      <Section label="About">
        <Card raised style={{ gap: space.sm }}>
          <Row>
            <Info size={17} color={t.colors.accent} />
            <Text variant="title" style={{ flex: 1 }}>AIDr.</Text>
          </Row>
          <Text variant="caption" tone="soft">{DISCLAIMER}</Text>
          <Row style={{ gap: space.sm, flexWrap: 'wrap' }}>
            <Button
              label="Privacy policy"
              kind="secondary"
              full={false}
              onPress={() => Linking.openURL('https://aidr.app/privacy')}
            />
            <Button
              label="Medical disclaimer"
              kind="secondary"
              full={false}
              onPress={() => Linking.openURL('https://aidr.app/disclaimer')}
            />
          </Row>
          <Text variant="caption" tone="muted">AIDr. v{APP_VERSION}</Text>
        </Card>
      </Section>
    </Screen>
  );
}

function ChoiceTile({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={{
        flex: 1,
        minHeight: MIN_TARGET,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: space.xs,
        borderRadius: radius.field,
        backgroundColor: selected ? t.colors.accentSoft : t.colors.surfaceSunken,
        borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth,
        borderColor: selected ? t.colors.accent : t.colors.hairline,
      }}
    >
      <Text variant="caption" tone={selected ? 'accent' : 'soft'}>
        {selected ? `${label} ✓` : label}
      </Text>
    </Pressable>
  );
}

function formatTime(h: number, m: number): string {
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}
