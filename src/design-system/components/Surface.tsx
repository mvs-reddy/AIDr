import React from 'react';
import {
  View,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, space, elevation } from '../tokens';
import { useTheme } from '../theme';
import { Eyebrow } from './Text';

/** Page scaffold. Owns canvas colour, safe areas, keyboard avoidance and scroll. */
export function Screen({
  children,
  scroll = true,
  footer,
  /** Extra bottom padding so content clears the floating tab bar. */
  tabBarInset = false,
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  footer?: React.ReactNode;
  tabBarInset?: boolean;
  contentStyle?: ViewStyle;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  const padding: ViewStyle = {
    paddingHorizontal: space.lg,
    paddingTop: insets.top + space.sm,
    paddingBottom: (tabBarInset ? 108 : space.xl) + insets.bottom,
  };

  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[padding, contentStyle]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, padding, contentStyle]}>{children}</View>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: t.colors.canvas }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {body}
      {footer ? <StickyFooter>{footer}</StickyFooter> : null}
    </KeyboardAvoidingView>
  );
}

/** Hairline-topped action shelf that pins the primary CTA above the home indicator. */
export function StickyFooter({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingHorizontal: space.lg,
        paddingTop: space.sm,
        paddingBottom: Math.max(insets.bottom, space.sm) + space.xs,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: t.colors.hairline,
        backgroundColor: t.colors.canvas,
      }}
    >
      {children}
    </View>
  );
}

interface CardProps extends ViewProps {
  /** `sunken` for informational notes, `ink` for the dark hero CTA card. */
  fill?: 'surface' | 'sunken' | 'ink';
  padded?: boolean;
  raised?: boolean;
}

export function Card({ fill = 'surface', padded = true, raised, style, ...rest }: CardProps) {
  const t = useTheme();
  const bg =
    fill === 'ink' ? t.colors.ink : fill === 'sunken' ? t.colors.surfaceSunken : t.colors.surface;
  return (
    <View
      style={[
        {
          backgroundColor: bg,
          borderRadius: radius.card,
          padding: padded ? space.lg : 0,
          borderWidth: fill === 'surface' ? StyleSheet.hairlineWidth : 0,
          borderColor: t.colors.hairline,
        },
        raised && elevation.card,
        style,
      ]}
      {...rest}
    />
  );
}

/** Eyebrow + spacing wrapper used for every `SECTION LABEL` grouping. */
export function Section({
  label,
  children,
  gap = space.sm,
  top = space.xl,
}: {
  label?: string;
  children: React.ReactNode;
  gap?: number;
  top?: number;
}) {
  return (
    <View style={{ marginTop: top }}>
      {label ? <Eyebrow style={{ marginBottom: space.sm }}>{label}</Eyebrow> : null}
      <View style={{ gap }}>{children}</View>
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const t = useTheme();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: t.colors.hairline,
        marginLeft: inset,
      }}
    />
  );
}

/** Rows inside a grouped card (Settings, redaction preview, onboarding checklist). */
export function Row({
  children,
  style,
  ...rest
}: ViewProps) {
  return (
    <View
      style={[{ flexDirection: 'row', alignItems: 'center', gap: space.sm }, style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
