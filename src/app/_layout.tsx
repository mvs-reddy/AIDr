import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import {
  Newsreader_500Medium,
  Newsreader_500Medium_Italic,
} from '@expo-google-fonts/newsreader';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';

import { ThemeProvider, useTheme } from '../design-system/theme';
import { useSettings } from '../state/settingsStore';
import { useHealth } from '../state/healthStore';
import { openDatabase, ensureVault } from '../services/persistence/db';
import { registerResponseHandler } from '../services/notifications/medicationScheduler';
import { redactionService } from '../services/redaction/RedactionService';
import { AppState } from 'react-native';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Newsreader_500Medium,
    Newsreader_500Medium_Italic,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  useEffect(() => {
    (async () => {
      await openDatabase();
      await ensureVault();
      await useHealth.getState().bootstrap();
      if (fontsLoaded) await SplashScreen.hideAsync();
    })();
  }, [fontsLoaded]);

  useEffect(() => registerResponseHandler(), []);

  // §9.2 — the reversible redaction map must not outlive the foreground session.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') redactionService.dispose();
    });
    return () => sub.remove();
  }, []);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <Navigator />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Navigator() {
  const t = useTheme();
  const router = useRouter();
  const segments = useSegments();
  const onboardingComplete = useSettings((s) => s.onboardingComplete);

  useEffect(() => {
    const inOnboarding = segments[0] === 'onboarding';
    if (!onboardingComplete && !inOnboarding) router.replace('/onboarding');
    if (onboardingComplete && inOnboarding) router.replace('/');
  }, [onboardingComplete, segments, router]);

  return (
    <>
      <StatusBar style={t.isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.colors.canvas },
          animation: t.reduceMotion ? 'none' : 'slide_from_right',
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="workflow/[kind]" />
        <Stack.Screen name="run/[id]" />
        <Stack.Screen
          name="note/new"
          options={{ presentation: 'modal', animation: t.reduceMotion ? 'none' : 'slide_from_bottom' }}
        />
      </Stack>
    </>
  );
}
