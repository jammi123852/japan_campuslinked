import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LocaleProvider, useI18n } from '@/i18n';
import { AppProvider, useApp } from '@/state/AppContext';
import { useWide } from '@/components/ui';
import { GlobalActions } from '@/components/GlobalActions';
import { colors, fonts } from '@/theme/tokens';

function RootNavigator() {
  const { ready, session, profile } = useApp();
  const { t } = useI18n();

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} accessibilityLabel={t.common.loading} />
      </View>
    );
  }

  const signedIn = session != null;
  const onboarded = signedIn && profile != null;

  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text, fontSize: 17, fontWeight: '600', fontFamily: fonts.sans },
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      {/* 로그인 + 프로필 등록 완료 */}
      <Stack.Protected guard={onboarded} redirectTo={signedIn ? '/onboarding' : '/welcome'}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="profile-edit" options={{ title: t.profile.editTitle }} />
        <Stack.Screen name="notifications" options={{ title: t.notifications.title }} />
        <Stack.Screen name="timetable-import" options={{ title: t.timetable.importPhoto }} />
        <Stack.Screen name="timetable-entry" options={{ title: t.timetable.entryAdd }} />
        <Stack.Screen name="lecture/[id]" options={{ title: t.lectures.detailTitle }} />
        <Stack.Screen name="post-new" options={{ title: t.community.newTitle, headerStyle: { backgroundColor: colors.surface } }} />
        <Stack.Screen name="post" options={{ title: t.community.postTitle }} />
        <Stack.Screen name="review-edit" options={{ title: t.reviewForm.newTitle, headerStyle: { backgroundColor: colors.surface } }} />
        <Stack.Screen name="saved" options={{ title: t.saved.title }} />
        <Stack.Screen name="event-edit" options={{ title: t.schedule.newTitle, headerStyle: { backgroundColor: colors.surface } }} />
        <Stack.Screen name="notification-settings" options={{ title: t.inbox.settingsTitle }} />
        <Stack.Screen name="course" options={{ title: t.official.detailTitle }} />
        <Stack.Screen name="records" options={{ title: t.records.title }} />
        <Stack.Screen name="graduation" options={{ title: t.grad.title }} />
        <Stack.Screen name="my-exams" options={{ title: t.exams.title }} />
        <Stack.Screen name="notice" options={{ title: t.noticeAi.title }} />
        <Stack.Screen name="department" options={{ title: t.dept.title }} />
        <Stack.Screen name="planner" options={{ title: t.planner.title }} />
        <Stack.Screen name="plan-builder" options={{ title: t.builder.title }} />
        <Stack.Screen name="campus" options={{ title: t.campus.title }} />
        <Stack.Screen name="checklist" options={{ title: t.checklist.title }} />
        <Stack.Screen name="career" options={{ title: t.career.title }} />
        <Stack.Screen name="scholarship" options={{ title: t.scholarship.title }} />
      </Stack.Protected>

      {/* 로그인 + 프로필 미등록 */}
      <Stack.Protected guard={signedIn && !onboarded} redirectTo={signedIn ? '/' : '/welcome'}>
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      </Stack.Protected>

      {/* 로그인 전 */}
      <Stack.Protected guard={!signedIn} redirectTo={onboarded ? '/' : '/onboarding'}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

/**
 * PC 웹 전체 확대: 발표 화면에서 글자·버튼이 잘 보이고 양쪽 여백이 줄도록 폭에 비례해 키운다.
 * 폰 폭(WIDE_MIN 미만)과 앱은 바꾸지 않는다.
 */
export function wideZoom(width: number) {
  if (width < 1024) return 1;
  return Math.min(1.3, 1 + ((width - 1024) / 896) * 0.2);
}

function useWideZoom() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const apply = () => {
      const root = document.getElementById('root');
      if (root) (root.style as unknown as { zoom: string }).zoom = String(Math.round(wideZoom(window.innerWidth) * 100) / 100);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);
}

export default function RootLayout() {
  useWideZoom();
  // 폰 크기 웹은 가운데 폰 폭(480) 열, PC 폭(WIDE_MIN 이상)은 화면 전체를 쓰고 왼쪽 메뉴 배치
  const wide = useWide();
  const narrowColumn = Platform.OS === 'web' && !wide;
  return (
    <SafeAreaProvider>
      <LocaleProvider>
        <AppProvider>
          <StatusBar style="dark" />
          {/* 폰 크기 웹 미리보기는 폰 폭 열로 가운데 둔다. PC 폭은 전체 화면(본문 폭은 Screen 이 제한) */}
          {narrowColumn ? (
            <View style={{ flex: 1, backgroundColor: colors.divider, alignItems: 'center' }}>
              <View style={{ flex: 1, width: '100%', maxWidth: 480, backgroundColor: colors.bg }}>
                <RootNavigator />
                <GlobalActions />
              </View>
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <RootNavigator />
              <GlobalActions />
            </View>
          )}
        </AppProvider>
      </LocaleProvider>
    </SafeAreaProvider>
  );
}
