import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton, T } from '@/components/ui';
import { useI18n } from '@/i18n';
import { useInbox } from '@/services/inboxRepository';
import { useApp } from '@/state/AppContext';
import { colors, space } from '@/theme/tokens';

/** 언어 전환 + 알림 버튼. 모든 화면에서 같은 자리(오른쪽 위)에 겹쳐 보인다 */
export const GLOBAL_ACTIONS_WIDTH = 104;

function Bell() {
  const { session } = useApp();
  const { t } = useI18n();
  const { unread } = useInbox(session);
  return <IconButton testID="open-inbox" icon="notifications-outline" label={t.home.inbox(unread)} badge={unread} onPress={() => router.push('/notifications')} />;
}

export function GlobalActions() {
  const { ready, session, profile } = useApp();
  const { t, locale, setLocale } = useI18n();
  const insets = useSafeAreaInsets();
  if (!ready) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 10 }]}>
      <Pressable
        testID="global-locale"
        accessibilityRole="button"
        accessibilityLabel={t.mypage.language}
        onPress={() => setLocale(locale === 'ko' ? 'ja' : 'ko')}
        style={({ pressed }) => [styles.localeBtn, pressed && { backgroundColor: colors.divider }]}
      >
        <T variant="caption" style={{ fontWeight: '700' }}>{locale === 'ko' ? '日本語' : '한국어'}</T>
      </Pressable>
      {session && profile ? <Bell /> : <View style={{ width: 44 }} />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: space.sm, flexDirection: 'row', alignItems: 'center', gap: space.xs, zIndex: 100 },
  localeBtn: { minHeight: 36, minWidth: 52, paddingHorizontal: space.sm, alignItems: 'center', justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: colors.divider, backgroundColor: colors.surface },
});
