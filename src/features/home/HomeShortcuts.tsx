import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { T, useWide, type IconName } from '@/components/ui';
import { useI18n } from '@/i18n';
import { colors, gutter, radius, space } from '@/theme/tokens';

type Key = 'campus' | 'builder' | 'planner' | 'graduation' | 'records' | 'checklist' | 'notice' | 'scholarship' | 'career' | 'department' | 'import' | 'saved' | 'search';

const ITEMS: { key: Key; href: Href; icon: IconName; bg: string; fg: string }[] = [
  { key: 'builder', href: '/plan-builder', icon: 'grid', bg: colors.accentSoft, fg: colors.accentSoftText },
  { key: 'campus', href: '/campus', icon: 'map', bg: colors.successSoft, fg: colors.successText },
  { key: 'graduation', href: '/graduation', icon: 'school', bg: colors.successSoft, fg: colors.successText },
  { key: 'notice', href: '/notice', icon: 'megaphone', bg: colors.dangerSoft, fg: colors.dangerText },
  { key: 'checklist', href: '/checklist', icon: 'checkbox', bg: colors.infoSoft, fg: colors.infoText },
  { key: 'planner', href: '/planner', icon: 'layers', bg: colors.accentSoft, fg: colors.accentSoftText },
  { key: 'records', href: '/records', icon: 'document-text', bg: colors.warningSoft, fg: colors.warningText },
  { key: 'scholarship', href: '/scholarship', icon: 'wallet', bg: colors.successSoft, fg: colors.successText },
  { key: 'career', href: '/career', icon: 'briefcase', bg: colors.infoSoft, fg: colors.infoText },
  { key: 'department', href: '/department', icon: 'business', bg: colors.warningSoft, fg: colors.warningText },
  { key: 'import', href: '/timetable-import', icon: 'camera', bg: colors.dangerSoft, fg: colors.dangerText },
  { key: 'search', href: '/search', icon: 'search', bg: colors.infoSoft, fg: colors.infoText },
  { key: 'saved', href: '/saved', icon: 'bookmark', bg: colors.accentSoft, fg: colors.accentSoftText },
];

/** 홈의 기능 바로가기: 마이페이지까지 들어가지 않고 바로 연다. 폰은 가로로 넘기고 PC 는 줄바꿈 */
export function HomeShortcuts() {
  const { t } = useI18n();
  const wide = useWide();
  const items = ITEMS.map((it) => (
    <Pressable
      key={it.key}
      testID={`home-shortcut-${it.key}`}
      accessibilityRole="button"
      accessibilityLabel={t.shortcuts[it.key]}
      onPress={() => router.push(it.href)}
      style={({ pressed }) => [styles.item, pressed && { opacity: 0.6 }]}
    >
      <View style={[styles.icon, { backgroundColor: it.bg }]}>
        <Ionicons name={it.icon} size={24} color={it.fg} />
      </View>
      <T variant="caption" numberOfLines={2} style={styles.label}>{t.shortcuts[it.key]}</T>
    </Pressable>
  ));
  return wide ? (
    <View testID="home-shortcuts" style={styles.wrap}>{items}</View>
  ) : (
    <ScrollView testID="home-shortcuts" horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      {items}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { marginHorizontal: -gutter, marginBottom: space.xl },
  scrollContent: { paddingHorizontal: gutter, gap: space.xs },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginBottom: space.xl },
  item: { width: 72, alignItems: 'center', paddingVertical: space.xs },
  icon: { width: 48, height: 48, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center' },
  label: { textAlign: 'center', marginTop: space.xs, color: colors.text },
});
