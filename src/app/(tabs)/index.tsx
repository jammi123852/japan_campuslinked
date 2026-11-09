import { router, useFocusEffect } from 'expo-router';
import { useTr } from '@/lib/translate';
import { useCourseName } from '@/data/useCourseName';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Block, BlockHeader, Button, Columns, EmptyText, Gap, Notice, Pill, Row, Screen, Segmented, SourceBadge, T, useWide } from '@/components/ui';
import { findDepartment, findFaculty, orgShort } from '@/data/faculties';
import { todayWeekday } from '@/data/sampleData';
import type { Notice as NoticeItem, TimetableEntry, UserProfile } from '@/data/types';
import { formatDate, formatShortDateTime, useI18n } from '@/i18n';
import { entriesForPeriod, periodKey } from '@/features/academic/academicLogic';
import { usePeriodLabel } from '@/features/academic/PeriodBar';
import { WeekList } from '@/features/academic/WeekList';
import { itemsForPeriod } from '@/features/checklist/checklistLogic';
import { GLOBAL_ACTIONS_WIDTH } from '@/components/GlobalActions';
import { AssistantPanel } from '@/features/assistant/AssistantPanel';
import { HomeShortcuts } from '@/features/home/HomeShortcuts';
import { useOfficial } from '@/features/official/useOfficial';
import { useChecklist } from '@/services/checklistRepository';
import { usePeriod } from '@/services/periodRepository';
import { PostRow } from '@/features/community/PostRow';
import { usePosts } from '@/features/community/usePosts';
import { upcomingDeadlines, overdueDeadlines } from '@/features/schedule/scheduleLogic';
import { ApiError } from '@/lib/api';
import { STATIC_DEMO } from '@/lib/demo/staticDemo';
import { academicNow } from '@/lib/dates';
import { refreshInbox, useInbox } from '@/services/inboxRepository';
import { useEvents } from '@/services/scheduleRepository';
import { useHomeData } from '@/services/useHomeData';
import { useApp } from '@/state/AppContext';
import { colors, gutter, radius, space } from '@/theme/tokens';

function isRelevant(notice: NoticeItem, p: UserProfile) {
  const target = notice.target;
  if (target.facultyIds?.length && !target.facultyIds.includes(p.facultyId)) return false;
  if (target.departmentIds?.length && !target.departmentIds.includes(p.departmentId)) return false;
  if (target.grades?.length && !target.grades.includes(p.currentGrade)) return false;
  return true;
}

/** 달력 날짜 차이 (모레 23:59 마감 → 2) */
function daysUntil(iso: string, now = new Date()) {
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((startOfDay(new Date(iso)) - startOfDay(now)) / 86_400_000);
}

const minutes = (hhmm?: string) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

type ClassState = 'done' | 'now' | 'next' | 'later';

/** 시작·종료 시각이 있는 수업만 지금/다음을 판정한다 */
function classStates(list: TimetableEntry[], now: Date): ClassState[] {
  const cur = now.getHours() * 60 + now.getMinutes();
  let nextAssigned = false;
  return list.map((c) => {
    const s = minutes(c.startTime);
    const e = minutes(c.endTime);
    if (s == null || e == null) return 'later';
    if (cur >= e) return 'done';
    if (cur >= s) return 'now';
    if (!nextAssigned) {
      nextAssigned = true;
      return 'next';
    }
    return 'later';
  });
}

/** 마감 카드 줄: 폰은 가로로 넘기기, PC 는 줄바꿈해서 모두 보이기 */
function CardRow({ children }: { children: ReactNode }) {
  const wide = useWide();
  return wide ? (
    <View style={styles.wrapRow}>{children}</View>
  ) : (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hScroll} contentContainerStyle={styles.hScrollContent}>
      {children}
    </ScrollView>
  );
}

export default function HomeScreen() {
  const { session, profile } = useApp();
  const { t, locale } = useI18n();
  const tr = useTr();
  const cn = useCourseName();
  const { data, error } = useHomeData(session);
  const official = useOfficial();
  const per = usePeriod(session, official.kind === 'ok' ? official.data : null);
  const periodLabel = usePeriodLabel();
  const checklist = useChecklist(session);
  const [ttView, setTtView] = useState<'today' | 'week'>('today');
  const { state: latest, reload: reloadLatest } = usePosts({ limit: 3 });
  const { events, loaded: eventsLoaded } = useEvents(session);
  const { entries: inboxEntries } = useInbox(session);
  const nickname = profile?.nickname;
  useFocusEffect(
    useCallback(() => {
      reloadLatest();
      // 홈으로 돌아올 때 새 답변·후기 확인 (30초 안에는 다시 부르지 않음)
      if (session && nickname) refreshInbox(session, nickname).catch(() => undefined);
    }, [reloadLatest, session, nickname]),
  );
  // 수업 시작 전 알림이 제때 보이도록 화면을 1분마다 다시 그린다
  const [, setMinuteTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setMinuteTick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  const isDemo = session?.mode === 'demo';

  if (!profile) return null;
  const faculty = findFaculty(profile.facultyId);
  const dept = findDepartment(profile.facultyId, profile.departmentId);
  const now = new Date();
  const today = todayWeekday(now);

  // '오늘'은 학년력의 오늘 쿼터 기준, '이번 주'는 사용자가 고른 기간 기준 (둘을 섞지 않고 화면에 기준을 표시)
  const todayBasis = per.today?.period ?? per.period;
  const weekBasis = per.period;
  const allTimetable = data?.timetable ?? [];
  const todayList = todayBasis ? entriesForPeriod(allTimetable, todayBasis) : allTimetable;
  const weekList = weekBasis ? entriesForPeriod(allTimetable, weekBasis) : allTimetable;
  const todayClasses = todayList.filter((c) => c.weekday === today).sort((a, b) => a.period - b.period);
  const states = classStates(todayClasses, now);
  // 진행 중인 수업이 있으면 그것, 없으면 다음 수업을 강조
  const focusIndex = states.includes('now') ? states.indexOf('now') : states.indexOf('next');
  const focus = focusIndex >= 0 ? todayClasses[focusIndex] : null;
  const allDone = todayClasses.length > 0 && states.every((s) => s === 'done');
  // 홈 알림: 1시간 안에 시작하는 수업 + 가까운 마감(D-1·오늘) + 공지에서 넣은 일정. 앱을 열었을 때 보이며 푸시 알림은 아니다
  const curMinutes = now.getHours() * 60 + now.getMinutes();
  const homeAlerts: { id: string; title: string; subtitle?: string; onPress: () => void }[] = [];
  todayClasses.forEach((c, i) => {
    const start = minutes(c.startTime);
    if (states[i] !== 'next' || start == null || start - curMinutes > 60) return;
    homeAlerts.push({ id: `class-${c.id}`, title: t.home.classSoon(start - curMinutes, c.courseName), subtitle: c.room, onPress: () => router.push('/calendar') });
  });
  // 가까운 일정부터 최대 5개 (나머지는 알림함에서 본다)
  inboxEntries
    .filter((e) => e.kind === 'deadline' && e.event)
    .sort((a, b) => a.sortAt.localeCompare(b.sortAt))
    .slice(0, 5)
    .forEach((e) => {
      const date = e.event!.date;
      homeAlerts.push({ id: e.id, title: t.inbox.deadline(e.days ?? 0, e.event!.title, e.event!.kind), subtitle: `${date}${e.event!.time ? ` ${e.event!.time}${e.event!.endTime ? `–${e.event!.endTime}` : ''}` : ''}`, onPress: () => router.push({ pathname: '/calendar', params: { view: 'month', date } }) });
    });
  const notices = (data?.notices ?? []).filter((n) => isRelevant(n, profile)).slice(0, 3);
  // 마감: 사용자가 일정을 한 번이라도 저장했으면 그 일정만, 아니면(데모) 샘플만. 둘을 섞지 않는다
  const academic = academicNow(now);
  const useSampleDeadlines = isDemo && eventsLoaded && events == null;
  const sampleDeadlines = (data?.deadlines ?? [])
    .filter((d) => new Date(d.dueAt).getTime() >= now.getTime())
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const myDeadlines = upcomingDeadlines(events ?? [], academic.date, academic.minutes);
  const overdue = overdueDeadlines(events ?? [], academic.date, academic.minutes);
  // 큰 문장: 오늘 수업 수 + 지금/다음 수업
  const headline = todayClasses.length === 0 ? t.home.noClassToday : allDone ? t.home.allDone : t.home.headlineClasses(todayClasses.length);
  const focusLine = focus
    ? `${states[focusIndex] === 'now' ? t.home.now : t.home.next} ${t.common.period(focus.period)} ${cn(focus.courseName)}`
    : null;

  return (
    <Screen>
      <View style={styles.topBar}>
        <T variant="sub" tone="secondary" testID="home-affiliation" style={{ flex: 1 }} numberOfLines={1}>
          {orgShort(faculty?.name, locale)} {orgShort(dept?.name, locale)} {t.common.grade(profile.currentGrade)}
        </T>
        {/* 언어 전환·알림 버튼은 모든 화면 공통(GlobalActions)이 이 자리에 겹쳐 보인다 */}
        <View style={{ width: GLOBAL_ACTIONS_WIDTH, height: 44 }} />
      </View>
      {STATIC_DEMO ? (
        <View style={{ marginBottom: space.md }} testID="static-demo-notice">
          <Notice text={t.staticDemo.notice} />
        </View>
      ) : null}

      <View style={styles.hero}>
        <T variant="sub" tone="secondary">
          {t.common.dateShort(now.getMonth() + 1, now.getDate(), t.common.weekdays[today])} {t.home.greeting(profile.nickname)}
        </T>
        <T variant="display" header testID="home-headline" style={{ marginTop: space.xs }}>
          {headline}
        </T>
        {focusLine ? (
          <T variant="headline" tone="accent" testID="home-focus" style={{ marginTop: space.xs }}>
            {focusLine}
          </T>
        ) : null}
      </View>

      <HomeShortcuts />

      {error && <Notice tone="danger" text={t.home.loadError(error)} />}
      {homeAlerts.length > 0 ? (
        <Block testID="home-alerts" style={{ marginBottom: space.md }}>
          <BlockHeader title={t.home.alertsTitle} />
          {homeAlerts.map((a) => (
            <Row key={a.id} testID={`home-alert-${a.id}`} title={a.title} subtitle={a.subtitle} chevron onPress={a.onPress} />
          ))}
        </Block>
      ) : null}
      {!data && !error && <ActivityIndicator color={colors.accent} style={{ marginVertical: space.xxl }} accessibilityLabel={t.common.loading} />}

      {data && (
        <Columns
          first={
            <>
              {/* 마감: 가로 스크롤 */}
              <T variant="title" header style={{ marginBottom: space.md }}>
                {t.home.deadlines}
              </T>
              {useSampleDeadlines ? (
                sampleDeadlines.length === 0 ? (
                  <Block>
                    <EmptyText text={t.home.noDeadlines} />
                  </Block>
                ) : (
                  <>
                    <CardRow>
                      {sampleDeadlines.map((d) => {
                        const days = daysUntil(d.dueAt, now);
                        return (
                          <View key={d.id} style={styles.deadlineCard} testID={`deadline-${d.id}`}>
                            <View style={styles.deadlineTop}>
                              <T variant="headline" tone={days <= 2 ? 'danger' : 'primary'} style={[styles.tabular, { fontWeight: '700' }]}>
                                {t.home.dday(days)}
                              </T>
                              <SourceBadge source={d.source} />
                            </View>
                            <T variant="body" style={{ fontWeight: '600', marginTop: space.xs }} numberOfLines={1}>
                              {d.title}
                            </T>
                            <T variant="sub" tone="tertiary" numberOfLines={1} style={styles.tabular}>
                              {d.courseName} {formatShortDateTime(d.dueAt, locale)}
                            </T>
                          </View>
                        );
                      })}
                    </CardRow>
                    <T variant="caption" tone="secondary" style={{ marginTop: space.sm }}>
                      {t.home.sampleDeadlinesNote}
                    </T>
                  </>
                )
              ) : myDeadlines.length === 0 ? (
                <Block>
                  <EmptyText text={t.home.noDeadlinesUser} />
                </Block>
              ) : (
                <CardRow>
                  {myDeadlines.map(({ event: e, days }) => (
                    <Pressable
                      key={e.id}
                      testID={`deadline-${e.id}`}
                      accessibilityRole="button"
                      onPress={() => router.push({ pathname: '/event-edit', params: { id: e.id } })}
                      style={({ pressed }) => [styles.deadlineCard, pressed && { backgroundColor: colors.surfacePressed }]}
                    >
                      <View style={styles.deadlineTop}>
                        <T variant="headline" tone={days <= 2 ? 'danger' : 'primary'} style={[styles.tabular, { fontWeight: '700' }]}>
                          {t.home.dday(days)}
                        </T>
                        <Pill text={t.schedule.kinds[e.kind]} tone="accent" />
                      </View>
                      <T variant="body" style={{ fontWeight: '600', marginTop: space.xs }} numberOfLines={1}>
                        {tr(e.title)}
                      </T>
                      <T variant="sub" tone="tertiary" numberOfLines={1} style={styles.tabular}>
                        {e.course ? `${cn(e.course.name)} ` : ''}
                        {e.date.slice(5).replace('-', '/')} {e.time ? `${e.time}${e.endTime ? `–${e.endTime}` : ''}` : t.home.allDay}
                      </T>
                    </Pressable>
                  ))}
                </CardRow>
              )}
              {!useSampleDeadlines && overdue.length > 0 ? (
                <Button
                  testID="home-overdue"
                  label={t.home.overdue(overdue.length)}
                  variant="text"
                  size="md"
                  onPress={() => router.push({ pathname: '/calendar', params: { view: 'month', date: overdue[0].date } })}
                />
              ) : null}

              <Gap size={space.xxl} />
              {/* 오늘 수업 */}
              <Block flush>
                <View style={styles.blockPad}>
                  <BlockHeader title={ttView === 'today' ? t.home.today : t.homeTT.weekTitle} />
                  <Segmented<'today' | 'week'>
                    label={t.home.today}
                    testIDPrefix="home-tt"
                    value={ttView}
                    onChange={setTtView}
                    options={[
                      { value: 'today', label: t.homeTT.today },
                      { value: 'week', label: t.homeTT.week },
                    ]}
                  />
                  {(ttView === 'today' ? todayBasis : weekBasis) ? (
                    <T variant="caption" tone="tertiary" style={{ marginTop: space.sm }} testID="home-tt-basis">
                      {ttView === 'today' && per.today
                        ? t.homeTT.basisToday(periodLabel(per.today.period))
                        : t.homeTT.basisSelected(periodLabel((ttView === 'today' ? todayBasis : weekBasis)!))}
                    </T>
                  ) : null}
                </View>
                {ttView === 'week' ? (
                  <View style={{ paddingHorizontal: space.sm, paddingBottom: space.sm, paddingTop: space.sm }}>
                    {allTimetable.length === 0 ? (
                      <View style={styles.blockPadBottom}>
                        <EmptyText text={t.homeTT.noTimetable} />
                      </View>
                    ) : weekList.length === 0 ? (
                      <View style={styles.blockPadBottom}>
                        <EmptyText text={t.homeTT.noClassThisWeek} />
                      </View>
                    ) : (
                      <WeekList entries={weekList} today={today} />
                    )}
                    <Button testID="home-open-calendar" label={t.homeTT.openCalendar} variant="text" size="md" onPress={() => router.push('/calendar')} />
                  </View>
                ) : todayClasses.length === 0 ? (
                  <View style={styles.blockPadBottom}>
                    <EmptyText text={allTimetable.length ? t.home.noClassToday : t.home.noTimetable} />
                    {allTimetable.length === 0 ? (
                      <View style={{ gap: space.xs }}>
                        <Button testID="home-find-course" label={t.home.findCourse} variant="tertiary" size="md" icon="search" onPress={() => router.push('/search')} />
                        <Button testID="home-import" label={t.home.importTimetable} variant="tertiary" size="md" icon="camera-outline" onPress={() => router.push('/timetable-import')} />
                      </View>
                    ) : null}
                  </View>
                ) : (
                  <View style={{ paddingHorizontal: space.sm, paddingBottom: space.sm }}>
                    {todayClasses.map((c, i) => {
                      const st = states[i];
                      const highlighted = i === focusIndex;
                      return (
                        <View key={c.id} style={[styles.classRow, highlighted && styles.classRowFocus]} testID={`class-${c.id}`}>
                          <View style={styles.periodCol}>
                            <T variant="headline" tone={highlighted ? 'accent' : st === 'done' ? 'tertiary' : 'primary'} style={{ fontWeight: '700' }}>
                              {t.common.period(c.period)}
                            </T>
                            {c.startTime ? (
                              <T variant="caption" tone="tertiary" style={styles.tabular}>
                                {c.startTime}
                              </T>
                            ) : null}
                          </View>
                          <View style={{ flex: 1 }}>
                            <T variant="body" tone={st === 'done' ? 'tertiary' : 'primary'} style={{ fontWeight: '600' }} numberOfLines={2}>
                              {cn(c.courseName)}
                            </T>
                            <View style={styles.metaRow}>
                              {st === 'now' || st === 'next' || st === 'done' ? (
                                <Pill text={st === 'now' ? t.home.now : st === 'next' ? t.home.next : t.home.done} tone={st === 'done' ? 'neutral' : 'accent'} />
                              ) : null}
                              {c.room ? (
                                <Pressable testID={`home-room-${c.id}`} accessibilityRole="link" onPress={() => router.push({ pathname: '/campus', params: { room: c.room } })} style={{ minHeight: 28, justifyContent: 'center' }}>
                                  <T variant="sub" tone="accent">
                                    {c.room}
                                  </T>
                                </Pressable>
                              ) : null}
                              <SourceBadge source={c.source} />
                            </View>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </Block>
            </>
          }
          second={
            <>
              {/* 공지 */}
              <Block flush>
                <View style={styles.blockPad}>
                  <BlockHeader title={t.home.notices} />
                </View>
                <View style={styles.listPad}>
                  {!isDemo && official.kind === 'ok' && official.data.notices.length ? (
                    <>
                      {official.data.notices.filter((n) => {
                        // 다른 학부 대상이 제목에 드러난 공지는 빼고, 학부가 안 적힌 공지는 남긴다
                        const m = /([^\s）)]{1,6}学部)/.exec(n.title);
                        return !m || !!faculty?.name.includes(m[1]) || m[1].includes(faculty?.name ?? '-');
                      }).slice(0, 3).map((n) => (
                        <Row key={n.id} testID={`home-official-notice-${n.id}`} title={tr(n.title)} numberOfLines={2} chevron onPress={() => router.push('/notice')} subtitle={t.home.officialNoticeLine(n.org, n.posted ?? '')} />
                      ))}
                      <T variant="caption" tone="tertiary" style={{ marginBottom: space.sm }}>{t.home.officialNoticeNote}</T>
                    </>
                  ) : notices.length === 0 ? (
                    <EmptyText text={t.home.noNotices} />
                  ) : (
                    notices.map((n) => (
                      <Row
                        key={n.id}
                        title={tr(n.title)}
                        numberOfLines={2}
                        subtitle={
                          <View style={[styles.metaRow, { marginTop: space.xs }]}>
                            <SourceBadge source={n.source} />
                            <T variant="sub" tone="tertiary" style={styles.tabular}>
                              {formatDate(n.publishedAt, locale)}
                            </T>
                          </View>
                        }
                      />
                    ))
                  )}
                </View>
              </Block>
              <Gap />
              {/* 학업 준비: 오늘 쿼터의 체크리스트, 시험, 공지 */}
              <Block testID="home-academic">
                <BlockHeader title={t.homeTT.academicTitle} />
                {per.today ? (
                  (() => {
                    const list = itemsForPeriod(checklist.items, periodKey(per.today.period));
                    const open = list.filter((i) => !i.carriedTo && (i.status === 'todo' || i.status === 'doing')).length;
                    const label = periodLabel(per.today.period);
                    return (
                      <T variant="sub" tone="secondary" testID="home-checklist-line" style={{ marginBottom: space.sm }}>
                        {list.length ? t.homeTT.checklistLine(label, open) : t.homeTT.checklistEmpty(label)}
                      </T>
                    );
                  })()
                ) : null}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
                  <Button testID="home-checklist" label={t.checklist.open} variant="tertiary" size="md" onPress={() => router.push('/checklist')} />
                  <Button testID="home-notice" label={t.noticeAi.open} variant="tertiary" size="md" onPress={() => router.push('/notice')} />
                </View>
              </Block>

              {/* 커뮤니티 질문 */}
              <Gap />
              <Block flush>
                <View style={styles.blockPad}>
                  <BlockHeader title={t.home.questions} />
                </View>
                <View style={styles.listPad}>
                  {/* 공유 서버에 연결되면 실제 게시글, 서버 주소가 없으면 기존 샘플, 연결 실패면 실패 안내 */}
                  {latest.kind === 'ok' ? (
                    latest.data.length === 0 ? (
                      <EmptyText text={t.home.noQuestions} />
                    ) : (
                      latest.data.map((p) => <PostRow key={p.id} post={p} testID={`home-post-${p.id}`} />)
                    )
                  ) : latest.kind === 'loading' ? (
                    <ActivityIndicator color={colors.accent} style={{ marginVertical: space.md }} accessibilityLabel={t.community.loading} />
                  ) : !(latest.error instanceof ApiError && latest.error.kind === 'not_configured') ? (
                    <EmptyText text={t.home.questionsUnavailable} />
                  ) : data.posts.length === 0 ? (
                    <EmptyText text={t.home.noQuestions} />
                  ) : (
                    data.posts.slice(0, 3).map((p) => (
                      <Row
                        key={p.id}
                        title={p.title}
                        numberOfLines={2}
                        subtitle={
                          <View style={[styles.metaRow, { marginTop: space.xs }]}>
                            <SourceBadge source={p.source} />
                            <T variant="sub" tone="tertiary">
                              {p.authorDisplay.type === 'anonymous' ? t.home.anonymous : p.authorDisplay.nickname}
                            </T>
                            <T variant="sub" tone="accent" style={{ fontWeight: '600' }}>
                              {t.home.answers(p.answerCount)}
                            </T>
                          </View>
                        }
                      />
                    ))
                  )}
                </View>
              </Block>

            </>
          }
        />
      )}
      {/* 도우미는 홈 맨 아래. 대화가 길어지면 칸 안에서 스크롤한다 */}
      <Gap size={space.xxl} />
      <AssistantPanel />
    </Screen>
  );
}

const styles = StyleSheet.create({
  localeBtn: { minHeight: 36, minWidth: 44, paddingHorizontal: space.sm, alignItems: 'center', justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: colors.divider, marginRight: space.xs },
  topBar: { flexDirection: 'row', alignItems: 'center', marginRight: -space.md },
  hero: { marginTop: space.sm, marginBottom: space.lg },
  blockPad: { paddingHorizontal: gutter, paddingTop: space.md },
  blockPadBottom: { paddingHorizontal: gutter, paddingBottom: space.md },
  listPad: { paddingHorizontal: gutter, paddingBottom: space.sm },
  classRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.control,
  },
  classRowFocus: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.paleBlue },
  periodCol: { width: 56 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm, marginTop: 2 },
  tabular: { fontVariant: ['tabular-nums'] },
  hScroll: { marginHorizontal: -gutter },
  hScrollContent: { paddingHorizontal: gutter, gap: space.md },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  deadlineCard: {
    width: 220,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.block,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  deadlineTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
