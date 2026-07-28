import React from 'react';
import {
  Pressable,
  TextInput,
  View,
  Switch,
  ActivityIndicator,
  StyleSheet,
  type TextInputProps,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { ArrowRight, Check } from 'lucide-react-native';
import { radius, space, MIN_TARGET, HIT_SLOP } from '../tokens';
import { useTheme } from '../theme';
import { Text, Eyebrow } from './Text';

type ButtonKind = 'primary' | 'secondary' | 'quiet';

export function Button({
  label,
  onPress,
  kind = 'primary',
  icon,
  trailingArrow,
  disabled,
  loading,
  full = true,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  icon?: React.ReactNode;
  trailingArrow?: boolean;
  disabled?: boolean;
  loading?: boolean;
  full?: boolean;
  accessibilityHint?: string;
}) {
  const t = useTheme();
  const bg =
    kind === 'primary' ? t.colors.ink : kind === 'secondary' ? t.colors.surface : 'transparent';
  const fg = kind === 'primary' ? t.colors.onInk : t.colors.ink;

  return (
    <Pressable
      onPress={() => {
        if (disabled || loading) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      style={({ pressed }) => [
        {
          minHeight: MIN_TARGET + 12,
          alignSelf: full ? 'stretch' : 'flex-start',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: trailingArrow ? 'space-between' : 'center',
          gap: space.xs,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          borderRadius: radius.cta,
          backgroundColor: bg,
          borderWidth: kind === 'secondary' ? StyleSheet.hairlineWidth : 0,
          borderColor: t.colors.border,
          opacity: disabled ? 0.45 : pressed ? 0.88 : 1,
        },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        {icon}
        <Text variant="title" style={{ color: fg }} maxScale={1.5}>
          {label}
        </Text>
      </View>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : trailingArrow ? (
        <ArrowRight size={20} color={fg} />
      ) : null}
    </Pressable>
  );
}

/** `+ SLEEP`, `+ ENERGY` … multi-select focus chips on every workflow form. */
export function FocusChip({
  label,
  selected,
  onToggle,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onToggle();
      }}
      hitSlop={HIT_SLOP}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: MIN_TARGET - 8,
        paddingHorizontal: space.md,
        paddingVertical: space.xs,
        borderRadius: radius.chip,
        backgroundColor: selected ? t.colors.accentSoft : t.colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: selected ? t.colors.accent : t.colors.border,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {/* Glyph, not colour alone — §15 accessibility rule. */}
      {selected ? (
        <Check size={13} color={t.colors.accent} strokeWidth={3} />
      ) : (
        <Text variant="eyebrow" tone="muted" maxScale={1.4}>
          +
        </Text>
      )}
      <Text variant="eyebrow" tone={selected ? 'accent' : 'soft'} maxScale={1.4}>
        {label.toUpperCase()}
      </Text>
    </Pressable>
  );
}

export function Field({
  label,
  multiline,
  minHeight,
  ...rest
}: TextInputProps & { label: string; minHeight?: number }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text variant="caption" tone="muted" style={{ letterSpacing: 0.6 }}>
        {label.toUpperCase()}
      </Text>
      <TextInput
        multiline={multiline}
        placeholderTextColor={t.colors.inkMuted}
        accessibilityLabel={label}
        style={{
          backgroundColor: t.colors.surface,
          borderRadius: radius.field,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: t.colors.border,
          paddingHorizontal: space.md,
          paddingTop: space.sm + 2,
          paddingBottom: space.sm + 2,
          minHeight: minHeight ?? (multiline ? 108 : MIN_TARGET + 8),
          color: t.colors.ink,
          fontFamily: 'Inter_400Regular',
          fontSize: 16 * Math.min(t.fontScale, 1.6),
          lineHeight: 23 * Math.min(t.fontScale, 1.6),
          textAlignVertical: multiline ? 'top' : 'center',
        }}
        {...rest}
      />
    </View>
  );
}

export function ToggleRow({
  title,
  description,
  value,
  onValueChange,
  disabled,
}: {
  title: string;
  description?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        minHeight: MIN_TARGET,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyMedium">{title}</Text>
        {description ? (
          <Text variant="caption" tone="muted">
            {description}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={title}
        accessibilityHint={description}
        trackColor={{ false: t.colors.surfaceSunken, true: t.colors.accentSoft }}
        thumbColor={value ? t.colors.accent : t.colors.surface}
      />
    </View>
  );
}

/** Radio-style row used in onboarding's readiness checklist and source pickers. */
export function SelectRow({
  title,
  description,
  selected,
  onPress,
}: {
  title: string;
  description?: string;
  selected: boolean;
  onPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={title}
      accessibilityHint={description}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        minHeight: MIN_TARGET + 8,
        paddingVertical: space.xs,
      }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: selected ? t.colors.accent : 'transparent',
          borderWidth: selected ? 0 : 1.5,
          borderColor: t.colors.border,
        }}
      >
        {selected ? <Check size={14} color={t.colors.onAccent} strokeWidth={3} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="title">{title}</Text>
        {description ? (
          <Text variant="caption" tone="muted">
            {description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export { Eyebrow };
