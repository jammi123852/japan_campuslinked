import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { useWide, type IconName } from '@/components/ui';
import { useI18n } from '@/i18n';
import { refreshInbox } from '@/services/inboxRepository';
import { useApp } from '@/state/AppContext';
import { colors, fonts } from '@/theme/tokens';

const TABS: { name: 'index' | 'search' | 'community' | 'calendar' | 'mypage'; key: 'home' | 'search' | 'community' | 'calendar' | 'mypage'; icon: IconName; iconActive: IconName }[] = [
  { name: 'index', key: 'home', icon: 'home-outline', iconActive: 'home' },
  { name: 'search', key: 'search', icon: 'search-outline', iconActive: 'search' },
  { name: 'community', key: 'community', icon: 'chatbubbles-outline', iconActive: 'chatbubbles' },
  { name: 'calendar', key: 'calendar', icon: 'calendar-clear-outline', iconActive: 'calendar-clear' },
  { name: 'mypage', key: 'mypage', icon: 'person-outline', iconActive: 'person' },
];

export default function TabLayout() {
  const { t } = useI18n();
  const { session, profile } = useApp();
  const nickname = profile?.nickname;
  const wide = useWide();
  // 앱이 다시 앞으로 올 때 앱 안 알림 확인 (최소 간격은 refreshInbox 가 지킨다)
  useEffect(() => {
    if (!session || !nickname) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refreshInbox(session, nickname).catch(() => undefined);
    });
    return () => sub.remove();
  }, [session, nickname]);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
        // PC 폭: 왼쪽 세로 메뉴(아이콘 옆 글자), 폰: 하단 탭
        ...(wide
          ? {
              tabBarPosition: 'left' as const,
              tabBarVariant: 'material' as const,
              tabBarLabelPosition: 'beside-icon' as const,
              tabBarActiveBackgroundColor: colors.accentSoft,
            }
          : null),
        // 웹은 기본 높이(48)에서 라벨이 잘려 높이를 지정. 네이티브는 safe area 를 포함한 기본 계산을 쓴다
        tabBarStyle: [
          { backgroundColor: colors.surface, borderTopColor: colors.divider },
          wide
            ? { width: 232, minWidth: 232, borderRightWidth: 1, borderRightColor: colors.divider, paddingTop: 24, paddingHorizontal: 12 }
            : Platform.OS === 'web'
              ? { height: 60, paddingTop: 6, paddingBottom: 6 }
              : null,
        ],
        tabBarLabelStyle: wide
          ? { fontSize: 15, lineHeight: 22, fontWeight: '600', fontFamily: fonts.sans, marginLeft: 12 }
          : { fontSize: 11, lineHeight: 15, fontWeight: '600', flexShrink: 0, fontFamily: fonts.sans },
        ...(wide ? { tabBarItemStyle: { borderRadius: 12, marginVertical: 2, paddingHorizontal: 12, justifyContent: 'flex-start' as const, minHeight: 48 } } : null),
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t.tabs[tab.key],
            tabBarButtonTestID: `tab-${tab.name}`,
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? tab.iconActive : tab.icon} size={24} color={String(color)} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
