import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { Block, Button, EmptyText, Gap, Notice, Pill, Row, Screen, Segmented, T } from '@/components/ui';
import { findLecture } from '@/data/lectures';
import { isOfficialId, lectureRoute, useAnyLecture } from '@/features/official/useAnyLecture';
import { formatDate, useI18n } from '@/i18n';
import { ApiError, getPost } from '@/lib/api';
import { toggleBookmark, toggleLecture, useSaved } from '@/services/savedRepository';
import { useApp } from '@/state/AppContext';
import { space } from '@/theme/tokens';

type Tab = 'favorites' | 'later' | 'bookmarks';
const TABS: Tab[] = ['favorites', 'later', 'bookmarks'];
/** 북마크한 글 확인 결과. 연결 실패(unavailable)와 실제 삭제(deleted)를 구분한다 */
type PostCheck = 'ok' | 'deleted' | 'unavailable';

/** 마이페이지 → 저장한 것. 주소: /saved?tab=bookmarks (직접 접속·새로고침 가능) */
function SavedOfficialRow({ id, which, savedAt }: { id: string; which: string; savedAt: string }) {
  const { t, locale } = useI18n();
  const info = useAnyLecture(id);
  if (!info?.title) return <Row testID={`saved-${which}-${id}`} title={t.saved.officialMissing} subtitle={t.saved.savedAt(formatDate(savedAt, locale))} />;
  return (
    <Row
      testID={`saved-${which}-${id}`}
      title={info.title}
      numberOfLines={2}
      chevron
      subtitle={`${info.subtitle ?? ''} · ${t.saved.savedAt(formatDate(savedAt, locale))}`}
      onPress={() => router.push(lectureRoute(id))}
    />
  );
}

export default function SavedScreen() {
  const { session } = useApp();
  const { t, locale } = useI18n();
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab: Tab = TABS.includes(params.tab as Tab) ? (params.tab as Tab) : 'favorites';
  const saved = useSaved(session);
  const [checks, setChecks] = useState<Record<number, PostCheck>>({});

  const bookmarkIds = saved.bookmarks.map((b) => b.postId).join(',');
  // 북마크 탭을 열 때마다 글이 아직 있는지 확인한다. 확인 실패로 북마크를 지우지는 않는다
  useFocusEffect(
    useCallback(() => {
      if (tab !== 'bookmarks' || !bookmarkIds) return;
      let alive = true;
      const ids = bookmarkIds.split(',').map(Number);
      Promise.all(
        ids.map((id) =>
          getPost(id)
            .then(() => [id, 'ok'] as const)
            .catch((e: unknown) => [id, e instanceof ApiError && e.status === 404 ? 'deleted' : 'unavailable'] as const),
        ),
      ).then((list) => alive && setChecks(Object.fromEntries(list)));
      return () => {
        alive = false;
      };
    }, [tab, bookmarkIds]),
  );

  const lectureList = (list: { lectureId: string; savedAt: string }[], which: 'favorites' | 'later', empty: string) =>
    list.length === 0 ? (
      <EmptyText text={empty} />
    ) : (
      list.map((x) => {
        if (isOfficialId(x.lectureId)) return <SavedOfficialRow key={x.lectureId} id={x.lectureId} which={which} savedAt={x.savedAt} />;
        const lec = findLecture(x.lectureId);
        return lec ? (
          <Row
            key={x.lectureId}
            testID={`saved-${which}-${x.lectureId}`}
            title={lec.name[locale]}
            numberOfLines={2}
            chevron
            subtitle={`${lec.instructor[locale]} · ${t.saved.savedAt(formatDate(x.savedAt, locale))}`}
            onPress={() => router.push({ pathname: '/lecture/[id]', params: { id: lec.id } })}
          />
        ) : (
          <Row
            key={x.lectureId}
            title={t.saved.lectureMissing}
            subtitle={x.lectureId}
            right={<Button label={t.saved.remove} variant="tertiary" size="md" onPress={() => session && toggleLecture(session, which, x.lectureId)} />}
          />
        );
      })
    );

  return (
    <Screen layout="reading" edges={['bottom']}>
      <Segmented<Tab>
        label={t.saved.title}
        testIDPrefix="saved-tab"
        value={tab}
        onChange={(v) => router.setParams({ tab: v })}
        options={TABS.map((v) => ({ value: v, label: t.saved[v] }))}
      />
      <Gap size={space.lg} />
      <Block>
        {tab === 'favorites' && lectureList(saved.favorites, 'favorites', t.saved.emptyFavorites)}
        {tab === 'later' && lectureList(saved.later, 'later', t.saved.emptyLater)}
        {tab === 'bookmarks' &&
          (saved.bookmarks.length === 0 ? (
            <EmptyText text={t.saved.emptyBookmarks} />
          ) : (
            saved.bookmarks.map((b) => {
              const check = checks[b.postId];
              return (
                <View key={b.postId} testID={`saved-bookmark-${b.postId}`}>
                  <Row
                    title={b.title}
                    numberOfLines={2}
                    chevron={check !== 'deleted'}
                    onPress={check === 'deleted' ? undefined : () => router.push({ pathname: '/post', params: { id: String(b.postId) } })}
                    subtitle={
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: space.xs }}>
                        {check === 'deleted' ? <Pill text={t.saved.postDeleted} tone="danger" /> : null}
                        <T variant="sub" tone="tertiary">
                          {t.saved.savedAt(formatDate(b.savedAt, locale))}
                        </T>
                      </View>
                    }
                  />
                  {check === 'deleted' ? (
                    <Button
                      testID={`unsave-${b.postId}`}
                      label={t.saved.bookmarkRemove}
                      variant="tertiary"
                      size="md"
                      onPress={() => session && toggleBookmark(session, { id: b.postId, title: b.title })}
                    />
                  ) : null}
                </View>
              );
            })
          ))}
      </Block>
      {tab === 'bookmarks' && Object.values(checks).includes('unavailable') ? (
        <>
          <Gap />
          <Notice tone="warning" text={t.saved.postUnavailable} />
        </>
      ) : null}
      <Gap />
      <T variant="caption" tone="secondary">
        {t.saved.deviceNote}
      </T>
    </Screen>
  );
}
