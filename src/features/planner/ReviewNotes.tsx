import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { T } from '@/components/ui';
import { useCourseName } from '@/data/useCourseName';
import { useI18n } from '@/i18n';
import { colors, space } from '@/theme/tokens';

import type { ReviewNote } from './builderLogic';

/** 대안 안 과목의 커뮤니티 후기 종합. 숫자는 앱 집계, 저장된 AI 요약이 있으면 함께 보여 준다. 누르면 근거 후기로 간다 */
export function ReviewNotes({ notes, testID }: { notes: ReviewNote[]; testID?: string }) {
  const { t, locale } = useI18n();
  const cn = useCourseName();
  if (!notes.length) return null;
  return (
    <View testID={testID} style={{ marginTop: space.sm }}>
      <T variant="sub" style={{ fontWeight: '700' }}>{t.builder.reviewNotesTitle}</T>
      {notes.map((n) => (
        <Pressable key={n.id} testID={`review-note-${n.id}`} accessibilityRole="link" onPress={() => router.push({ pathname: '/course', params: { id: n.id } })} style={({ pressed }) => [{ paddingVertical: 3 }, pressed && { backgroundColor: colors.surfacePressed }]}>
          <T variant="sub">
            <T variant="sub" style={{ fontWeight: '600' }}>{cn(n.name)}{n.isKyoyo ? ` (${t.builder.kyoyo})` : ''}: </T>
            {n.tags.length ? n.tags.map((x) => t.builder.reviewTag[x]).join(', ') : t.builder.reviewNoSignal}
          </T>
          <T variant="caption" tone="tertiary">{t.builder.reviewBasis(n.n, n.demo, n.workload, n.difficulty, n.small, n.mixed, n.posts)}</T>
          {n.betterThan ? <T variant="caption" tone="accent">{t.builder.reviewBetter(cn(n.betterThan.name), n.workload ?? 0, n.betterThan.workload)}</T> : null}
          {n.overview ? <T variant="caption" tone="secondary" numberOfLines={2}>{t.digest.aiLabel}: {locale === 'ja' ? n.overview.ja : n.overview.ko}</T> : null}
        </Pressable>
      ))}
      <T variant="caption" tone="tertiary">{t.builder.reviewNotesNote}</T>
    </View>
  );
}
