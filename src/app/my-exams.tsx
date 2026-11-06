import { useEffect, useState } from 'react';
import { useCourseName } from '@/data/useCourseName';
import { ActivityIndicator, View } from 'react-native';

import { Block, Button, EmptyText, Gap, Notice, Pill, Row, Screen, T } from '@/components/ui';
import type { TimetableEntry } from '@/data/types';
import { entriesForPeriod } from '@/features/academic/academicLogic';
import { matchExams, type ExamMatchStatus } from '@/features/academic/examLogic';
import { SourceLine } from '@/features/official/SourceLine';
import type { OfficialExam } from '@/features/official/types';
import { useOfficial } from '@/features/official/useOfficial';
import { useI18n } from '@/i18n';
import { newEventId, upsertEventBySource } from '@/services/scheduleRepository';
import { loadEditableTimetable, useTimetableVersion } from '@/services/timetableRepository';
import { useApp } from '@/state/AppContext';
import { colors, gutter, space } from '@/theme/tokens';

const TONE: Record<ExamMatchStatus, 'success' | 'warning' | 'neutral' | 'danger'> = {
  matched: 'success',
  multiple: 'warning',
  needs_check: 'warning',
  not_found: 'neutral',
  out_of_scope: 'neutral',
};

/** 내 시간표(2026 3Q)와 공식 시험표 대조. 학생이 고른 시험만 일정에 저장한다. 주소: /my-exams */
export default function MyExamsScreen() {
  const { session } = useApp();
  const { t } = useI18n();
  const cn = useCourseName();
  const official = useOfficial();
  const version = useTimetableVersion();
  const [entries, setEntries] = useState<TimetableEntry[] | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!session) return;
    let alive = true;
    loadEditableTimetable(session, t).then((r) => alive && setEntries(r.entries));
    return () => {
      alive = false;
    };
  }, [session, t, version]);

  if (official.kind === 'loading' || !entries) {
    return (
      <Screen edges={['bottom']}>
        <ActivityIndicator color={colors.accent} style={{ marginTop: space.huge }} />
      </Screen>
    );
  }
  if (official.kind !== 'ok') {
    return (
      <Screen layout="reading" edges={['bottom']}>
        <Notice tone="warning" text={official.kind === 'missing' ? t.official.missing : t.official.loadError} />
      </Screen>
    );
  }
  const data = official.data;
  const target = { year: data.calendar.year, quarter: '3Q' as const };
  const inScope = entriesForPeriod(entries, target);
  const matches = matchExams(inScope, data.courses, data.exams, '3Q');

  const save = async (x: OfficialExam) => {
    if (!session) return;
    const time = data.examPeriods.items.find((p) => p.period === x.period);
    const now = new Date().toISOString();
    const r = await upsertEventBySource(session, {
      id: newEventId(),
      sourceKey: `exam:${x.id}`,
      title: t.exams.examTitle(x.name),
      kind: 'exam',
      date: x.date,
      time: time?.start ?? null,
      course: null,
      memo: [t.exams.room(x.room), t.exams.items(x.items), x.nameNote ?? ''].filter(Boolean).join('\n'),
      notify: true,
      done: false,
      createdAt: now,
      updatedAt: now,
    });
    setSaved((s) => ({ ...s, [x.id]: t.exams.saved[r] }));
  };

  return (
    <Screen layout="reading" edges={['bottom']}>
      <Notice text={t.exams.scope} />
      <Notice tone="warning" text={`${t.exams.priority} ${t.exams.remote}`} />
      {inScope.length === 0 ? (
        <Block>
          <EmptyText text={t.exams.noTimetable} />
        </Block>
      ) : (
        matches.map((m) => (
          <View key={m.key}>
            <Block testID={`exam-match-${m.officialId ?? m.courseName}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
                <T variant="headline" style={{ flexShrink: 1 }}>
                  {cn(m.courseName)}
                </T>
                <Pill text={t.exams.statuses[m.status]} tone={TONE[m.status]} />
              </View>
              {m.status === 'not_found' ? (
                <T variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>
                  {t.exams.notFoundNote}
                </T>
              ) : null}
              {m.exams.map((x) => {
                const time = data.examPeriods.items.find((p) => p.period === x.period);
                return (
                  <View key={x.id} style={{ marginTop: space.sm, marginHorizontal: -gutter }}>
                    <Row
                      title={t.exams.when(x.date, x.period, time ? `${time.start}–${time.end}` : '?')}
                      subtitle={[`${x.instructor} · ${t.exams.slots(x.slots.join(', '))}`, t.exams.room(x.room), t.exams.items(x.items), x.nameNote ?? ''].filter(Boolean).join('\n')}
                    />
                    {m.status === 'matched' || m.status === 'multiple' || m.status === 'needs_check' ? (
                      <View style={{ paddingHorizontal: gutter }}>
                        <Button testID={`exam-save-${x.id}`} label={t.exams.save} icon="calendar-outline" variant={m.status === 'matched' ? 'secondary' : 'tertiary'} size="md" onPress={() => save(x)} />
                        {saved[x.id] ? <Notice text={saved[x.id]} /> : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}
              <SourceLine data={data} id="F013" page={1} />
            </Block>
            <Gap />
          </View>
        ))
      )}
      <SourceLine data={data} id={data.examPeriods.source.id} page={data.examPeriods.source.page} />
    </Screen>
  );
}
