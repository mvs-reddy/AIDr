import React from 'react';
import { Text as RNText, StyleSheet, type TextProps, type TextStyle } from 'react-native';
import { type } from '../tokens';
import { useTheme } from '../theme';

type Variant = keyof typeof type;
type Tone = 'ink' | 'soft' | 'muted' | 'accent' | 'onInk' | 'onAccent';

interface Props extends TextProps {
  variant?: Variant;
  tone?: Tone;
  /** Caps the OS scale for this element so a long display line cannot push a CTA off-screen. */
  maxScale?: number;
  center?: boolean;
}

export function Text({
  variant = 'body',
  tone = 'ink',
  maxScale = 1.9,
  center,
  style,
  ...rest
}: Props) {
  const t = useTheme();
  const spec = type[variant];
  const scale = Math.min(t.fontScale, maxScale);

  const color =
    tone === 'soft' ? t.colors.inkSoft
    : tone === 'muted' ? t.colors.inkMuted
    : tone === 'accent' ? t.colors.accent
    : tone === 'onInk' ? t.colors.onInk
    : tone === 'onAccent' ? t.colors.onAccent
    : t.colors.ink;

  const resolved: TextStyle = {
    fontFamily: spec.family,
    fontSize: spec.size * scale,
    lineHeight: spec.lineHeight * scale,
    letterSpacing: spec.letterSpacing,
    color,
    textAlign: center ? 'center' : undefined,
  };

  return (
    <RNText
      // We scale manually so `maxScale` is honoured; disable the double-scale.
      allowFontScaling={false}
      style={[resolved, style]}
      {...rest}
    />
  );
}

/** `WORKFLOW`, `STEP 3 · PRIVACY`, `START A WORKFLOW`. Always accent-toned. */
export function Eyebrow({ children, tone = 'accent', ...rest }: Props) {
  return (
    <Text variant="eyebrow" tone={tone} maxScale={1.5} {...rest}>
      {String(children).toUpperCase()}
    </Text>
  );
}

/**
 * The signature type treatment: a serif headline where one word carries the
 * accent in italic — "Prepare for your *visit*." Pass the emphasis word
 * separately rather than parsing markup, so translators keep control of order.
 */
export function DisplayTitle({
  lead,
  emphasis,
  trail = '.',
  small,
}: {
  lead: string;
  emphasis?: string;
  trail?: string;
  small?: boolean;
}) {
  const t = useTheme();
  const base = small ? 'displaySm' : 'display';
  return (
    <Text variant={base as Variant} maxScale={1.45} accessibilityRole="header">
      {lead}
      {emphasis ? (
        <RNText
          allowFontScaling={false}
          style={{
            fontFamily: type.displayItalic.family,
            fontStyle: 'italic',
            color: t.colors.accent,
          }}
        >
          {emphasis}
        </RNText>
      ) : null}
      {trail}
    </Text>
  );
}

export const textStyles = StyleSheet.create({
  paragraphGap: { marginTop: 8 },
});
