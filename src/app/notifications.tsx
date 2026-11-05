import { useCt } from '@/lib/contentTranslate';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { Block, Button, EmptyText, Gap, Notice, Pill, Row, Screen, SourceBadge, T } from '@/components/ui';
import { findLecture } from '@/data/lectures';
import { officialCourseById } from '@/features/official/courseLogic';
import { isOfficialId, lectureRoute } from '@/features/official/useAnyLecture';
import { useOfficial } from '@/features/official/useOfficial';
import { formatDateTime, formatShortDateTime, useI18n } from '@/i18n';
import { refreshInbox, useInbox, type InboxEntry } from '@/services/inboxRepository';
import { useApp } from '@/state/AppContext';
import { colors, space } from '@/theme/tokens';

/** 앱 안 알림함 (푸시 알림 아님). 화면에 들어올 때 서버를 확인하고(30초 간격 제한), 새로고침으로 바로 확인한다 */
export default function NotificationsScreen() {
  const { session, profile } = useApp();
  const { t, locale } = useI18n();
  const ct = useCt();
  const { state, entries, unread, markRead } = useInbox(session);
  const [refreshing, setRefreshing] = useState(false);
  const nickname = profile?.nickname ?? 'guest';

  useFocusEffect(
    useCallback(() => {
      if (session) refreshInbox(session, nickname).catch(() => undefined);
    }, [session, nickname]),
  );

  const refresh = async () => {
    if (!session) return;
    setRefreshing(true);
    await refreshInbox(session, nickname, true).finally(() => setRefreshing(false));
  };

  const official = useOfficial();
  const title = (e: InboxEntry) => {
    if (e.kind === 'answer') return t.inbox.answer(ct(e.postTitle ?? ''));
    if (e.kind === 'review') {
      const lec = findLecture(e.lectureId);
      if (lec) return t.inbox.review(lec.name[locale]);
      const oc = official.kind === 'ok' && e.lectureId ? officialCourseById(official.data, e.lectureId) : undefined;
      return oc ? t.inbox.review(oc.name) : t.inbox.targetMissing;
    }
    if (e.kind === 'deadline') return t.inbox.deadline(e.days ?? 0, e.event?.title ?? '', e.event?.kind);
    return e.sample?.title ?? '';
  };

  const open = async (e: InboxEntry) => {
    await markRead([e.id]);
    const target = e.target;
    if (!target) return;
    if (target.type === 'post') router.push({ pathname: '/post', params: { id: String(target.id) } });
    else if (target.type === 'lecture' && (findLecture(target.id) || isOfficialId(target.id))) router.push(lectureRoute(target.id));
    else if (target.type === 'event') router.push({ pathname: '/event-edit', params: { id: target.id } });
  };

  const errorText =
    state?.lastError === 'not_configured' ? t.inbox.errNotConfigured : state?.lastError === 'network' ? t.inbox.errNetwork : state?.lastError === 'http' ? t.inbox.errHttp : null;

  return (
    <Screen layout="reading" edges={['bottom']}>
      <Notice text={t.inbox.inAppNote} />
      {errorText ? <Notice tone="warning" text={errorText} /> : null}
      <Block style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingVertical: space.md, marginBottom: space.md }}>
        <Button testID="inbox-refresh" label={t.inbox.refresh} icon="refresh" variant="tertiary" size="md" loading={refreshing} onPress={refresh} />
        <Button
          testID="inbox-read-all"
          label={t.inbox.markAll}
          variant="tertiary"
          size="md"
          disabled={unread === 0}
          onPress={() => markRead(entries.filter((e) => !e.read).map((e) => e.id))}
        />
        <Button testID="inbox-settings" label={t.inbox.settings} icon="settings-outline" variant="tertiary" size="md" onPress={() => router.push('/notification-settings')} />
      </Block>
      {state?.lastCheckedAt ? (
        <T variant="caption" tone="secondary" style={{ marginBottom: space.sm }}>
          {t.inbox.lastChecked(formatShortDateTime(state.lastCheckedAt, locale))}
        </T>
      ) : null}
      <Block flush>
        <View style={{ paddingHorizontal: 20 }}>
          {entries.length === 0 ? (
            <EmptyText text={t.notifications.empty} />
          ) : (
            entries.map((e) => (
              <Row
                key={e.id}
                testID={`inbox-${e.id}`}
                title={title(e)}
                numberOfLines={3}
                chevron={e.target != null}
                onPress={() => open(e)}
                left={<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: e.read ? 'transparent' : colors.accent }} />}
                subtitle={
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: space.xs }}>
                    {e.kind === 'sample' ? <SourceBadge source={{ kind: 'demo' }} /> : null}
                    {!e.read ? <Pill text={t.inbox.unread} tone="accent" /> : null}
                    {e.sample ? (
                      <T variant="sub" tone="tertiary">
                        {e.sample.body}
                      </T>
                    ) : null}
                    {e.createdAt ? (
                      <T variant="sub" tone="tertiary">
                        {formatDateTime(e.createdAt, locale)}
                      </T>
                    ) : null}
                  </View>
                }
              />
            ))
          )}
        </View>
      </Block>
      <Gap />
    </Screen>
  );
}
