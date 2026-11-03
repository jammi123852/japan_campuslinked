import { router } from 'expo-router';
import { useCourseName } from '@/data/useCourseName';
import { useCt } from '@/lib/contentTranslate';
import { View } from 'react-native';

import { Button, Pill, Row, T } from '@/components/ui';
import { useI18n } from '@/i18n';
import type { AppSession } from '@/data/types';
import { setEventDone } from '@/services/scheduleRepository';
import { space } from '@/theme/tokens';
import { dueState, isDeadlineKind, type PersonalEvent } from './scheduleLogic';

/** 일정 한 줄 (캘린더 날짜 목록). 누르면 수정 화면, 과제·시험은 완료/완료 취소 버튼 */
export function EventRow({ event, session, today, nowMinutes }: { event: PersonalEvent; session: AppSession; today: string; nowMinutes: number }) {
  const { t } = useI18n();
  const cn = useCourseName();
  const ct = useCt();
  const st = dueState(event, today, nowMinutes).state;
  return (
    <View testID={`event-${event.id}`}>
      <Row
        title={ct(event.title)}
        numberOfLines={2}
        chevron
        onPress={() => router.push({ pathname: '/event-edit', params: { id: event.id } })}
        subtitle={
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: space.xs }}>
            <Pill text={t.schedule.kinds[event.kind]} tone={event.kind === 'personal' ? 'neutral' : 'accent'} />
            {event.reference ? <Pill text={t.noticeAi.referencePill} /> : null}
            {isDeadlineKind(event.kind) && st === 'done' ? <Pill text={t.schedule.done} tone="success" /> : null}
            {isDeadlineKind(event.kind) && st === 'overdue' ? <Pill text={t.schedule.overdue} tone="danger" /> : null}
            <T variant="sub" tone="tertiary" style={{ fontVariant: ['tabular-nums'] }}>
              {event.time ? (event.endTime ? `${event.time}–${event.endTime}` : event.time) : t.schedule.allDay}
            </T>
            {event.course ? (
              <T variant="sub" tone="tertiary" numberOfLines={1}>
                {cn(event.course.name)}
              </T>
            ) : null}
          </View>
        }
      />
      {isDeadlineKind(event.kind) ? (
        <View style={{ alignSelf: 'flex-start', marginBottom: space.sm }}>
          <Button
            testID={`event-done-${event.id}`}
            label={event.done ? t.schedule.markUndone : t.schedule.markDone}
            icon={event.done ? 'arrow-undo-outline' : 'checkmark-circle-outline'}
            variant="tertiary"
            size="md"
            onPress={() => setEventDone(session, event.id, !event.done)}
          />
        </View>
      ) : null}
    </View>
  );
}
