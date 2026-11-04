import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { Block, Button, Chip, EmptyText, Notice, Row, Screen, Segmented, T, TextField } from '@/components/ui';
import { deptCodeOf } from '@/features/official/courseLogic';
import { PublicMinNotice } from '@/features/official/OfficialSearch';
import type { OpsPostMeta } from '@/features/official/types';
import { loadOpsPosts, useOfficial } from '@/features/official/useOfficial';
import { useApp } from '@/state/AppContext';
import { PostRow } from '@/features/community/PostRow';
import { apiErrorText, usePosts } from '@/features/community/usePosts';
import { useI18n } from '@/i18n';
import { POST_CATEGORIES, type PostCategory } from '@/lib/api';
import { colors, gutter, space } from '@/theme/tokens';

/** 운영팀 공식자료 정리글 목록. 학생 게시글·후기와 섞지 않는다 */
function OpsList() {
  const { t } = useI18n();
  const { profile } = useApp();
  const official = useOfficial();
  const [posts, setPosts] = useState<OpsPostMeta[] | null>(null);
  const [mine, setMine] = useState(true);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(30);
  useEffect(() => {
    loadOpsPosts().then(setPosts);
  }, []);
  if (official.kind === 'missing') return <PublicMinNotice pm={official.publicMin} />;
  if (official.kind !== 'ok' || !posts) return <ActivityIndicator color={colors.accent} accessibilityLabel={t.community.loading} />;
  const dept = deptCodeOf(profile?.facultyId, profile?.departmentId);
  const byId = new Map(official.data.courses.map((c) => [c.id, c]));
  const n = q.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  const rows = posts
    .map((p) => ({ p, c: byId.get(p.offeringId) }))
    .filter((x) => x.c && (!mine || !dept || (x.c.depts ?? []).includes(dept)) && (!n || x.p.title.normalize('NFKC').toLowerCase().replace(/\s+/g, '').includes(n)));
  return (
    <>
      <Notice text={t.community.opsLead} />
      <TextField testID="ops-search" label={t.community.opsSearch} value={q} onChangeText={setQ} autoCorrect={false} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: space.sm }}>
        <Chip onGray testID="ops-mine" label={t.community.opsMineOnly} selected={mine} onPress={() => setMine(true)} />
        <Chip onGray testID="ops-all" label={t.community.opsAll} selected={!mine} onPress={() => setMine(false)} />
      </View>
      <Block flush>
        <View style={{ paddingHorizontal: gutter }}>
          {rows.length === 0 ? <EmptyText text={t.community.opsEmpty} /> : null}
          {rows.slice(0, limit).map(({ p, c }) => (
            <Row
              key={p.id}
              testID={`ops-${p.offeringId}`}
              title={`${p.title}${c!.section ? ` [${c!.section}]` : ''}`}
              numberOfLines={2}
              chevron
              onPress={() => router.push({ pathname: '/course', params: { id: p.offeringId } })}
              subtitle={`${c!.instructor ?? ''} · ${t.community.opsMeta(p.rev, p.updatedAt)}`}
            />
          ))}
        </View>
      </Block>
      {rows.length > limit ? <Button testID="ops-more" label={t.community.opsMore(rows.length - limit)} variant="text" size="md" onPress={() => setLimit((v) => v + 30)} /> : null}
    </>
  );
}

export default function CommunityScreen() {
  const { t } = useI18n();
  const [tab, setTab] = useState<'posts' | 'ops'>('posts');
  const [category, setCategory] = useState<PostCategory | null>(null);
  const [searchText, setSearchText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(searchText.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchText]);
  const { state, reload } = usePosts({ category, q, limit: q ? 100 : undefined });
  // 다른 화면(글쓰기·상세)에서 돌아오면 다시 불러온다
  useFocusEffect(useCallback(() => reload(), [reload]));

  return (
    <Screen layout="reading">
      <View style={styles.head}>
        <T variant="display" header style={{ flex: 1 }}>
          {t.community.title}
        </T>
        <View>
          <Button testID="new-post" label={t.community.write} icon="create-outline" size="md" onPress={() => router.push('/post-new')} />
        </View>
      </View>
      <T variant="sub" tone="secondary" style={{ marginBottom: space.md }}>
        {t.community.shared}
      </T>

      <Segmented<'posts' | 'ops'>
        label={t.community.title}
        testIDPrefix="community-tab"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'posts', label: t.community.tabPosts },
          { value: 'ops', label: t.community.tabOps },
        ]}
      />
      <View style={{ height: space.md }} />
      {tab === 'ops' ? <OpsList /> : null}
      {tab === 'posts' ? (
      <>
      <TextField testID="community-search" label={t.community.searchLabel} value={searchText} onChangeText={setSearchText} placeholder={t.community.searchPlaceholder} autoCorrect={false} />
      {q && state.kind === 'ok' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm, marginTop: -space.sm, marginBottom: space.sm }}>
          <T variant="sub" tone="secondary" testID="community-search-count">{t.community.searchCount(state.data.length)}</T>
          <Button testID="community-search-clear" label={t.community.searchClear} variant="text" size="md" onPress={() => setSearchText('')} />
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hScroll} contentContainerStyle={styles.hScrollContent}>
        <Chip onGray testID="cat-all" label={t.community.all} selected={category == null} onPress={() => setCategory(null)} />
        {POST_CATEGORIES.map((c) => (
          <Chip onGray key={c} testID={`cat-${c}`} label={t.community.categories[c]} selected={category === c} onPress={() => setCategory(c)} />
        ))}
      </ScrollView>

      <Block flush>
        <View style={{ paddingHorizontal: gutter }}>
          {state.kind === 'loading' ? (
            <View style={{ paddingVertical: space.xl, alignItems: 'center' }}>
              <ActivityIndicator color={colors.accent} accessibilityLabel={t.community.loading} />
            </View>
          ) : state.kind === 'error' ? (
            <View style={{ paddingVertical: space.md }}>
              <Notice tone="danger" text={apiErrorText(t, state.error)} />
              <Button testID="retry-posts" label={t.community.retry} variant="tertiary" size="md" onPress={reload} />
            </View>
          ) : state.data.length === 0 ? (
            <EmptyText text={q ? t.community.searchNone : t.community.empty} />
          ) : (
            state.data.map((p) => <PostRow key={p.id} post={p} />)
          )}
        </View>
      </Block>
      {state.kind === 'ok' ? (
        <Button testID="refresh-posts" label={t.community.refresh} variant="text" size="md" icon="refresh" onPress={reload} />
      ) : null}
      </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm, marginBottom: space.sm },
  hScroll: { marginHorizontal: -gutter, marginBottom: space.md },
  hScrollContent: { paddingHorizontal: gutter },
});
