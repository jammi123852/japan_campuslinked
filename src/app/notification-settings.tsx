import { View } from 'react-native';

import { Block, Gap, Notice, Pill, Row, Screen, T } from '@/components/ui';
import type { InboxKind } from '@/features/inbox/inboxLogic';
import { useI18n } from '@/i18n';
import { setInboxSettings, useInbox } from '@/services/inboxRepository';
import { useApp } from '@/state/AppContext';
import { space } from '@/theme/tokens';

const KINDS: InboxKind[] = ['answer', 'review', 'deadline'];

/** 알림 종류별 켜기·끄기. 이 기기에만 저장. 앱 안 알림이며 푸시가 아님을 안내한다 */
export default function NotificationSettingsScreen() {
  const { session } = useApp();
  const { t } = useI18n();
  const { state } = useInbox(session);
  const label = { answer: t.inbox.kindAnswer, review: t.inbox.kindReview, deadline: t.inbox.kindDeadline };
  const hint = { answer: t.inbox.kindAnswerHint, review: t.inbox.kindReviewHint, deadline: t.inbox.kindDeadlineHint };

  return (
    <Screen layout="reading" edges={['bottom']}>
      <Notice tone="warning" text={t.inbox.settingsNote} />
      <Block flush>
        <View style={{ paddingHorizontal: 20 }}>
          {state &&
            KINDS.map((k) => {
              const on = state.settings[k];
              return (
                <Row
                  key={k}
                  testID={`setting-${k}`}
                  title={label[k]}
                  subtitle={hint[k]}
                  role="button"
                  onPress={() => session && setInboxSettings(session, { ...state.settings, [k]: !on })}
                  right={<Pill text={on ? t.inbox.on : t.inbox.off} tone={on ? 'accent' : 'neutral'} />}
                />
              );
            })}
        </View>
      </Block>
      <Gap size={space.md} />
      <T variant="caption" tone="secondary">
        {t.inbox.settingsDevice}
      </T>
    </Screen>
  );
}
