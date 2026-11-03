import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { MonthCalendar } from '@/components/MonthCalendar';
import { TimetableGrid } from '@/components/TimetableGrid';
import { Block, BlockHeader, Button, EmptyText, Gap, IconButton, Notice, Screen, Segmented, T } from '@/components/ui';
import type { TimetableEntry } from '@/data/types';
import { copyToPeriod, entriesForPeriod, entryInPeriod, periodKey, removeFromPeriod } from '@/features/academic/academicLogic';
import { PeriodBar, shiftQuarter, usePeriodLabel } from '@/features/academic/PeriodBar';
import { useOfficial } from '@/features/official/useOfficial';
import { EventRow } from '@/features/schedule/EventRow';
import { eventsOn } from '@/features/schedule/scheduleLogic';
import { useI18n } from '@/i18n';
import { confirmDestructive } from '@/lib/confirm';
import { academicNow, parseDateKey, shiftMonth, weekdayOf } from '@/lib/dates';
import { useEvents } from '@/services/scheduleRepository';
import { usePeriod } from '@/services/periodRepository';
import { loadEditableTimetable, newEntryId, saveTimetable, useTimetableVersion } from '@/services/timetableRepository';
import { useApp } from '@/state/AppContext';
import { space } from '@/theme/tokens';

type View_ = 'week' | 'month';

/** 캘린더 탭: 주간 시간표 / 월간 일정. 주소 /calendar?view=month&date=2026-11-05 로 직접 접속 가능 */
export default function CalendarScreen() {
  const { session } = useApp();
  const { t } = useI18n();
  const params = useLocalSearchParams<{ view?: string; date?: string }>();
  const view: View_ = params.view === 'month' ? 'month' : 'week';
  const version = useTimetableVersion();
  const [state, setState] = useState<{ entries: TimetableEntry[]; isSample: boolean } | null>(null);
  const { events } = useEvents(session);
  const now = academicNow();
  const [selected, setSelected] = useState(() => (params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : now.date));
  const [ym, setYm] = useState(() => {
    const p = parseDateKey(selected);
    return { year: p.year, month: p.month };
  });

  // 탭이 이미 열려 있어도 주소의 날짜로 이동한다 (공지 화면의 '월간 일정표 보기' 등)
  const [seenDate, setSeenDate] = useState(params.date);
  if (params.date !== seenDate) {
    setSeenDate(params.date);
    if (params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
      const p = parseDateKey(params.date);
      setSelected(params.date);
      setYm({ year: p.year, month: p.month });
    }
  }

  useEffect(() => {
    if (!session) return;
    let alive = true;
    loadEditableTimetable(session, t).then((r) => alive && setState(r));
    return () => {
      alive = false;
    };
  }, [session, t, version]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (events ?? []).forEach((e) => (c[e.date] = (c[e.date] ?? 0) + 1));
    return c;
  }, [events]);

  const official = useOfficial();
  const per = usePeriod(session, official.kind === 'ok' ? official.data : null);
  const periodLabel = usePeriodLabel();
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const allEntries = state?.entries ?? [];
  // 선택한 학년도·쿼터의 수업만 (기간 미지정 수업은 보존해서 함께 보여 줌)
  const entries = per.period ? entriesForPeriod(allEntries, per.period) : allEntries;
  const unclassified = allEntries.filter((e) => !e.term).length;
  const prevPeriod = per.period ? shiftQuarter(per.period, -1) : null;
  const copyPrev = async () => {
    if (!session || !per.period || !prevPeriod) return;
    const copied = copyToPeriod(allEntries, prevPeriod, per.period, newEntryId).filter(
      // 이미 이 기간에 같은 수업(같은 강의 id 또는 같은 칸·이름)이 있으면 다시 넣지 않는다
      (c) => !allEntries.some((e) => entryInPeriod(e, per.period!) === 'yes' && (c.lectureId ? e.lectureId === c.lectureId : e.courseName === c.courseName && e.weekday === c.weekday && e.period === c.period)),
    );
    if (copied.length === 0) return setCopyMsg(t.period.copyNone);
    await saveTimetable(session, [...allEntries, ...copied]);
    setCopyMsg(t.period.copyDone(copied.length));
  };
  const resetPeriod = () => {
    if (!session || !per.period) return;
    const period = per.period;
    const label = periodLabel(period);
    confirmDestructive(t.period.resetPeriod(label), t.period.resetPeriodBody(label, entries.length), { ok: t.common.ok, cancel: t.common.cancel }, async () => {
      await saveTimetable(session, removeFromPeriod(allEntries, period));
      setCopyMsg(t.period.resetDone(entries.length));
    });
  };
  const resetAll = () => {
    if (!session) return;
    confirmDestructive(t.period.resetAll, t.period.resetAllBody(allEntries.length), { ok: t.common.ok, cancel: t.common.cancel }, async () => {
      await saveTimetable(session, []);
      setCopyMsg(t.period.resetDone(allEntries.length));
    });
  };
  const select = (key: string) => {
    setSelected(key);
    const p = parseDateKey(key);
    setYm({ year: p.year, month: p.month });
  };
  const moveMonth = (delta: number) => setYm((cur) => shiftMonth(cur.year, cur.month, delta));
  const sel = parseDateKey(selected);
  const dayEvents = eventsOn(events ?? [], selected);

  return (
    <Screen>
      <T variant="display" header style={{ marginTop: space.sm, marginBottom: space.lg }}>
        {t.tabs.calendar}
      </T>
      <Segmented<View_>
        label={t.tabs.calendar}
        testIDPrefix="cal-view"
        value={view}
        onChange={(v) => router.setParams({ view: v })}
        options={[
          { value: 'week', label: t.schedule.viewWeek },
          { value: 'month', label: t.schedule.viewMonth },
        ]}
      />
      <Gap size={space.lg} />

      {view === 'week' ? (
        <>
          {session ? <PeriodBar session={session} period={per.period} today={per.today} source={per.source} /> : null}
          <Block>
            <BlockHeader title={t.timetable.title} />
            {state?.isSample && <Notice tone="warning" text={t.timetable.sampleNote} />}
            {per.period && per.today && periodKey(per.period) < periodKey(per.today.period) ? <Notice text={t.period.pastNote} /> : null}
            {unclassified > 0 ? <Notice tone="warning" text={t.period.unclassifiedNote(unclassified)} /> : null}
            {state && entries.length === 0 ? <EmptyText text={t.timetable.empty} /> : null}
            <Gap size={space.sm} />
            <TimetableGrid
              entries={entries}
              onPressEntry={(e) => router.push({ pathname: '/timetable-entry', params: { id: e.id } })}
              onPressEmpty={(weekday, period) =>
                router.push({ pathname: '/timetable-entry', params: { weekday: String(weekday), period: String(period) } })
              }
            />
            <Gap size={space.lg} />
            {/* 칸을 눌러 수업 하나를 고치는 것과 다른 흐름: 조건을 정해 완성 시간표를 고른다 */}
            <Button testID="open-plan-builder" label={t.builder.open} icon="grid-outline" variant="secondary" onPress={() => router.push('/plan-builder')} />
            <T variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>{t.builder.openHint}</T>
            <Button testID="open-planner-virtual" label={t.planner.open} variant="text" size="md" onPress={() => router.push('/planner')} />
            <Gap size={space.sm} />
            <Button testID="open-import" label={t.timetable.importPhoto} icon="camera-outline" onPress={() => router.push('/timetable-import')} />
            <Gap size={space.sm} />
            <View>
              <Button testID="add-entry" label={t.timetable.addManual} variant="tertiary" onPress={() => router.push('/timetable-entry')} />
              <T variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>{t.builder.openCalendarHint}</T>
            </View>
            <Gap size={space.sm} />
            <Gap size={space.sm} />
            <Button testID="cal-notice" label={t.noticeAi.open} variant="tertiary" size="md" onPress={() => router.push('/notice')} />
            {per.period && prevPeriod ? (
              <>
                <Gap size={space.sm} />
                <Button testID="copy-prev-period" label={t.period.copyFrom(periodLabel(prevPeriod))} variant="text" size="md" onPress={copyPrev} />
              </>
            ) : null}
            {copyMsg ? <Notice text={copyMsg} /> : null}
            {per.period && entries.length > 0 ? (
              <Button testID="reset-period" label={t.period.resetPeriod(periodLabel(per.period))} variant="dangerText" size="md" onPress={resetPeriod} />
            ) : null}
            {allEntries.length > 0 ? <Button testID="reset-all" label={t.period.resetAll} variant="dangerText" size="md" onPress={resetAll} /> : null}
          </Block>
        </>
      ) : (
        <>
          <Block>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.sm }}>
              <IconButton testID="month-prev" icon="chevron-back" label={t.schedule.prevMonth} onPress={() => moveMonth(-1)} />
              <T variant="title" header testID="month-title" style={{ flex: 1, textAlign: 'center' }}>
                {t.schedule.monthTitle(ym.year, ym.month)}
              </T>
              <IconButton testID="month-next" icon="chevron-forward" label={t.schedule.nextMonth} onPress={() => moveMonth(1)} />
            </View>
            <MonthCalendar year={ym.year} month={ym.month} selected={selected} today={now.date} counts={counts} onSelect={select} />
            <Gap size={space.sm} />
            <Button testID="month-today" label={t.schedule.today} variant="text" size="md" onPress={() => select(now.date)} />
          </Block>
          <Gap />
          <Block>
            <BlockHeader title={t.schedule.dayTitle(sel.month, sel.day, t.common.weekdays[weekdayOf(selected)])} testID="day-title" />
            {dayEvents.length === 0 ? (
              <EmptyText text={t.schedule.noEvents} />
            ) : (
              session && dayEvents.map((e) => <EventRow key={e.id} event={e} session={session} today={now.date} nowMinutes={now.minutes} />)
            )}
            <Gap size={space.sm} />
            <Button testID="add-event" label={t.schedule.add} icon="add" onPress={() => router.push({ pathname: '/event-edit', params: { date: selected } })} />
          </Block>
          <Gap />
          <T variant="caption" tone="secondary">
            {t.schedule.tzNote} {t.schedule.deviceNote}
          </T>
        </>
      )}

    </Screen>
  );
}
