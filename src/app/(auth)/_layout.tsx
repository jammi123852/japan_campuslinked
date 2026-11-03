import { Stack } from 'expo-router';

import { useI18n } from '@/i18n';
import { colors } from '@/theme/tokens';

// 그룹 (auth) 로 리다이렉트될 때 처음 보여 줄 화면
export const unstable_settings = { anchor: 'welcome' };

export default function AuthLayout() {
  const { t } = useI18n();
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text, fontSize: 17, fontWeight: '600' },
        headerStyle: { backgroundColor: colors.surface },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.surface },
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" options={{ title: t.auth.signInTitle }} />
      <Stack.Screen name="sign-up" options={{ title: t.auth.signUpTitle }} />
      <Stack.Screen name="reset-password" options={{ title: t.auth.resetTitle }} />
      <Stack.Screen name="school-entry" options={{ title: t.schoolEntry.title }} />
    </Stack>
  );
}
