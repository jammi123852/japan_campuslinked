import { useCt } from '@/lib/contentTranslate';
import { router } from 'expo-router';
import { View } from 'react-native';

import { Pill, Row, T } from '@/components/ui';
import { useI18n } from '@/i18n';
import type { PostSummary } from '@/lib/api';
import { space } from '@/theme/tokens';
import { formatPostTime } from './usePosts';

/** 게시글 목록 한 줄 (커뮤니티·강의 상세·홈 공용) */
export function PostRow({ post, testID }: { post: PostSummary; testID?: string }) {
  const { t, locale } = useI18n();
  const ct = useCt();
  return (
    <Row
      testID={testID ?? `post-${post.id}`}
      title={ct(post.title)}
      numberOfLines={2}
      chevron
      onPress={() => router.push({ pathname: '/post', params: { id: String(post.id) } })}
      subtitle={
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: space.xs }}>
          <Pill text={t.community.categories[post.category]} />
          {post.isSample ? <Pill text={t.community.sample} tone="warning" /> : null}
          {post.isDemo ? <Pill text={t.demoContent.badge} tone="warning" /> : null}
          <T variant="sub" tone="tertiary">
            {post.author ?? t.community.anonymous}
          </T>
          <T variant="sub" tone="tertiary" style={{ fontVariant: ['tabular-nums'] }}>
            {formatPostTime(post.createdAt, locale)}
          </T>
          <T variant="sub" tone="accent" style={{ fontWeight: '600' }}>
            {t.community.comments(post.commentCount)}
          </T>
        </View>
      }
    />
  );
}
