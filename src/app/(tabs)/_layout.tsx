import React from 'react';
import { View, Pressable, StyleSheet, Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { House, BookOpen, Settings as Cog } from 'lucide-react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

import { useTheme } from '../../design-system/theme';
import { Text } from '../../design-system/components/Text';
import { radius, space, elevation, MIN_TARGET } from '../../design-system/tokens';

const ICONS = { index: House, journal: BookOpen, settings: Cog } as const;
const LABELS = { index: 'Home', journal: 'Journal', settings: 'Settings' } as const;

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <FloatingTabBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="journal" options={{ title: 'Journal' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}

function FloatingTabBar({ state, navigation }: BottomTabBarProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.wrapper,
        { bottom: Math.max(insets.bottom, space.sm), left: space.lg, right: space.lg },
        elevation.floating,
      ]}
    >
      <BlurView
        intensity={Platform.OS === 'ios' ? 34 : 0}
        tint={t.isDark ? 'dark' : 'light'}
        style={[
          styles.bar,
          {
            backgroundColor: t.isDark ? 'rgba(34,38,31,0.92)' : 'rgba(251,249,245,0.93)',
            borderColor: t.colors.hairline,
          },
        ]}
      >
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const Icon = ICONS[route.name as keyof typeof ICONS] ?? House;
          const label = LABELS[route.name as keyof typeof LABELS] ?? route.name;

          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
              style={[
                styles.item,
                focused && { backgroundColor: t.colors.accentSoft },
              ]}
            >
              <Icon
                size={20}
                color={focused ? t.colors.accent : t.colors.inkMuted}
                strokeWidth={focused ? 2.4 : 1.9}
              />
              <Text
                variant="bodyMedium"
                tone={focused ? 'accent' : 'muted'}
                maxScale={1.3}
                numberOfLines={1}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'absolute', borderRadius: radius.tabBar, overflow: 'hidden' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: space.xs,
    paddingVertical: space.xs,
    borderRadius: radius.tabBar,
    borderWidth: StyleSheet.hairlineWidth,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: MIN_TARGET,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.chip,
  },
});
