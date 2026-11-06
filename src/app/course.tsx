import { weekdayPeriod } from '@/lib/officialText';
import { useCourseTitle, useTr } from '@/lib/translate';
import { useCourseName } from '@/data/useCourseName';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';

import { Chip, Block, BlockHeader, Button, Columns, EmptyText, Gap, IconButton, Notice, Pill, Row, Screen, SourceBadge, T } from '@/components/ui';
import { checkAddOfficial, cohortApplies, officialToEntries } from '@/features/academic/academicLogic';
import { PostRow } from '@/features/community/PostRow';
import { apiErrorText, usePosts } from '@/features/community/usePosts';
import { useLectureReviews } from '@/features/lectures/useLectureReviews';
import { ReviewInsight, SyllabusSummary } from '@/features/lectures/CourseInsight';
import { HelpfulButton } from '@/features/lectures/HelpfulButton';
import { Collapsible } from '@/components/Collapsible';
import { useCt } from '@/lib/contentTranslate';
import { categoryLabel, courseCohort, deptCodeOf, officialCourseById, quartersForEntry, suggestCategory } from '@/features/official/courseLogic';
import { computeProgress, pickRule } from '@/features/records/gradLogic';
import { usePeriodLabel } from '@/features/academic/PeriodBar';
import { deptKeyOf, SourceLine } from '@/features/official/SourceLine';
import { useShowcase } from '@/features/official/showcase';
import type { OfficialCourse } from '@/features/official/types';
import { useOfficial, useSyllabus } from '@/features/official/useOfficial';
import { toggleLecture, useSaved } from '@/services/savedRepository';
import { useI18n } from '@/i18n';
import { newRecordId, upsertRecord, useRecords } from '@/services/recordsRepository';
import { loadEditableTimetable, newEntryId, saveTimetable } from '@/services/timetableRepository';
import { useApp } from '@/state/AppContext';
import { colors, gutter, space } from '@/theme/tokens';

/**
 * 공식 강의(개설 분반) 상세. 주소: /course?id=rs26-xxxx
 * 시간표 원문에서 확인한 사실만 보여 주고, 강의계획서 상세가 없는 분반은 '미등록'으로 둔다.
 */
export default function OfficialCourseScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { session, profile } = useApp();
  const { t, locale } = useI18n();
  const cn = useCourseName();
  const tr = useTr();
  const ct = useCourseTitle();
  const contentTr = useCt();
  const [insightKey, setInsightKey] = useState(0);
  const [showAllReviews, setShowAllReviews] = useState(false);
  const state = useOfficial();
  const label = usePeriodLabel();
  const c0 = state.kind === 'ok' ? officialCourseById(state.data, id) : undefined;
  const syl = useSyllabus(c0?.id, c0?.hasSyllabus);
  const { state: questions, reload: reloadQ } = usePosts({ lectureId: c0?.id ?? 'none', limit: 5 });
  const { state: reviews, reload: reloadR } = useLectureReviews(c0?.id);
  const saved = useSaved(session);
  const showcase = useShowcase();
  const sample = c0 ? showcase?.courses[c0.id] : undefined;
  useFocusEffect(
    useCallback(() => {
      reloadQ();
      reloadR();
      setInsightKey((k) => k + 1);
    }, [reloadQ, reloadR]),
  );
  const { records } = useRecords(session);
  const [msg, setMsg] = useState<{ tone: 'info' | 'warning'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (state.kind === 'loading') {
    return (
      <Screen edges={['bottom']}>
        <ActivityIndicator color={colors.accent} style={{ marginTop: space.huge }} accessibilityLabel={t.official.loading} />
      </Screen>
    );
  }
  if (state.kind !== 'ok') {
    return (
      <Screen layout="reading" edges={['bottom']}>
        <Notice tone="warning" text={state.kind === 'missing' ? t.official.missing : t.official.loadError} />
      </Screen>
    );
  }
  const data = state.data;
  const c: OfficialCourse | undefined = c0;
  if (!c) {
    return (
      <Screen layout="reading" edges={['bottom']}>
        <EmptyText text={t.lectures.notFound} />
      </Screen>
    );
  }
  const year = data.calendar.year;
  const deptCode = deptCodeOf(profile?.facultyId, profile?.departmentId);
  const cohort = c.cohortRanges ? courseCohort(c, profile?.admissionYear, deptCode) : cohortApplies(c.cohort, profile?.admissionYear);
  const dk = deptKeyOf(profile?.facultyId, profile?.departmentId);
  const rulePicked = pickRule(dk ? data.departments[dk]?.rules : undefined, profile?.admissionYear, profile?.courseName);
  const suggest = suggestCategory(c, rulePicked?.rule);
  const now = rulePicked ? computeProgress(records, rulePicked, 'current') : null;
  const shortNow = suggest && now ? now.categories.find((x) => x.id === suggest)?.short ?? null : null;
  const entryQ = quartersForEntry(c);
  const siblings = c.code ? data.courses.filter((x) => x.code === c.code && x.id !== c.id).slice(0, 6) : [];
  const isFav = saved.favorites.some((x) => x.lectureId === c.id);
  const officialCredits = c.credits ?? c.syllabus?.credits ?? null;
  const inRecords = records.some((r) => r.officialId === c.id);
  const periodsText = c.meetings
    .map((m) => {
      const time = data.periods.items.find((p) => p.period === m.period);
      return `${t.lectures.meeting(t.common.weekdays[m.weekday], m.period)}${time ? ` ${time.start}–${time.end}` : ''}`;
    })
    .join(', ');

  const add = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const { entries } = await loadEditableTimetable(session, t);
      const check = checkAddOfficial(c, year, entries);
      if (check.kind === 'duplicate') setMsg({ tone: 'info', text: t.official.duplicate });
      else if (check.kind === 'conflict')
        setMsg({
          tone: 'warning',
          text: t.official.conflict(
            check.conflicts
              .map((x) => `${t.lectures.meeting(t.common.weekdays[x.weekday], x.period)} ${cn(x.courseName)}${x.unclassified ? ` ${t.official.conflictUnclassified}` : ''}`)
              .join(', '),
          ),
        });
      else {
        await saveTimetable(session, [...entries, ...officialToEntries(c, year, data.periods.items, newEntryId)]);
        setMsg({ tone: entryQ.assumed ? 'warning' : 'info', text: `${t.official.added(label({ year, quarter: entryQ.quarters[0] }))}${entryQ.assumed ? ` ${t.official.quarterAssumed}` : ''}` });
      }
    } finally {
      setBusy(false);
    }
  };

  const addRecord = async () => {
    if (!session || inRecords) return;
    const now = new Date().toISOString();
    // 인정 영역은 자동으로 정하지 않는다(미분류) — 사용자가 이수 기록에서 고른다
    await upsertRecord(session, {
      id: newRecordId(),
      year,
      quarters: entryQ.quarters,
      name: c.name,
      code: c.code ?? c.syllabus?.code ?? null,
      section: c.section,
      credits: officialCredits,
      category: 'unknown',
      suggestedCategory: suggest,
      status: 'planned',
      confirmedAt: null,
      officialId: c.id,
      note: '',
      createdAt: now,
      updatedAt: now,
    });
  };

  return (
    <Screen
      edges={['bottom']}
      footer={
        <>
          {msg && <Notice tone={msg.tone} text={msg.text} />}
          <T variant="caption" tone="tertiary" style={{ marginBottom: space.sm }}>
            {t.official.planOnly}
          </T>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button testID="course-add" label={t.official.add} icon="add-circle-outline" onPress={add} loading={busy} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                testID="course-add-record"
                label={inRecords ? t.records.inRecords : t.records.addPlanned}
                icon="school-outline"
                variant="secondary"
                onPress={addRecord}
                disabled={inRecords}
              />
            </View>
          </View>
          {msg && msg.tone === 'info' ? <Button label={t.lectures.viewCalendar} variant="text" size="md" onPress={() => router.push('/calendar')} /> : null}
        </>
      }
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.xs }}>
        <SourceBadge source={{ kind: 'official_public', verification: c.review.length ? 'needs_review' : 'needs_review' }} />
        {c.mark ? <Pill text={t.official.marks[c.mark]} tone="accent" /> : <Pill text={t.official.marks.none} />}
        {c.track ? <Pill text={t.official.tracks[c.track]} /> : null}
        <View style={{ flex: 1 }} />
        <IconButton testID="course-fav" icon={isFav ? 'star' : 'star-outline'} label={isFav ? t.saved.favoriteRemove : t.saved.favoriteAdd} onPress={() => session && toggleLecture(session, 'favorites', c.id)} />
      </View>
      <T variant="display" header testID="course-title">
        {ct(c.name)}
      </T>
      <T variant="body" tone="secondary" style={{ marginTop: space.xs, marginBottom: space.lg }}>
        {[c.section ? `[${c.section}]` : '', c.instructor ?? ''].join(' ').trim()}
      </T>
      {c.review.filter((r) => r !== 'credits_unknown' && r !== 'quarter_unknown').length ? <Notice tone="warning" text={c.review.map((r) => t.official.reviewItems[r] ?? t.official.reviewFlag).filter((x, i, a) => a.indexOf(x) === i).join(' ')} /> : null}

      <Columns
        first={
          <>
            <Block flush>
              <View style={{ paddingHorizontal: gutter }}>
                <Row title={t.official.meetings} right={<T variant="body" tone="secondary" testID="course-meetings">{periodsText}</T>} />
                <Row title={t.official.quarters} right={<T variant="body" tone="secondary">{c.quarters.length === 0 && !c.term ? t.official.quarterUnknown : `${year} ${c.term ? t.period.terms[c.term] : ''} ${c.quarters.join('·')}`}</T>} />
                <Row title={t.official.rooms} right={<T variant="body" tone="secondary">{c.rooms.join(', ') || '-'}</T>} />
                {c.rooms.length ? (
                  <View testID="course-rooms-map" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {c.rooms.slice(0, 4).map((r) => <Chip key={r} testID={`course-room-${r}`} icon="map-outline" label={r} onPress={() => router.push({ pathname: '/campus', params: { room: r } })} />)}
                  </View>
                ) : null}
                <Row title={t.official.yearRow} right={<T variant="body" tone="secondary">{c.year ? t.common.grade(c.year) : (c.grade ?? '-')}</T>} />
                <Row
                  title={t.official.cohort}
                  subtitle={
                    <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xs, flexWrap: 'wrap' }}>
                      <T variant="sub" tone="tertiary">
                        {c.cohort || t.official.cohortNotPrinted}
                      </T>
                      <Pill
                        text={cohort === true ? t.official.cohortYes : cohort === false ? t.official.cohortNo : t.official.cohortUnknown}
                        tone={cohort === true ? 'success' : cohort === false ? 'danger' : 'neutral'}
                      />
                    </View>
                  }
                />
                {c.note ? <Row title={t.official.note} subtitle={c.note} /> : null}
                {c.schedule ? <Row title={t.official.intensive} subtitle={[c.schedule.term, c.schedule.dates.join(', '), c.schedule.room, c.schedule.note].filter(Boolean).join('\n')} /> : null}
                {c.categoryRaw ? <Row title={t.official.categoryRaw} subtitle={c.categoryRaw} /> : null}
                {(c.applies ?? []).length ? (
                  <Row
                    title={t.official.appliesBy}
                    subtitle={(c.applies ?? [])
                      .map((a) => `${a.dept}${a.gfbp ? ' GFBP' : ''}: ${[a.mark, ...a.heads].filter(Boolean).join(' / ') || t.official.cohortNotPrinted}`)
                      .filter((x, i, arr) => arr.indexOf(x) === i)
                      .slice(0, 8)
                      .join('\n')}
                  />
                ) : null}
              </View>
              <View style={{ paddingHorizontal: gutter, paddingBottom: space.md }}>
                {(c.sources ?? [c.source]).filter(Boolean).slice(0, 3).map((x) => (
                  <SourceLine key={`${x.id}-${x.page}`} data={data} id={x.id} page={x.page} />
                ))}
                <SourceLine data={data} id="SYLALL" />
                <SourceLine data={data} id={data.periods.source.id} page={data.periods.source.page} />
              </View>
            </Block>
          </>
        }
        second={
          <>
            <Block>
              <BlockHeader title={t.official.syllabus} />
              {syl.loading ? (
                <ActivityIndicator color={colors.accent} accessibilityLabel={t.official.loading} />
              ) : syl.detail ? (
                <View testID="course-syllabus">
                  <SyllabusSummary lectureId={c.id} source={[syl.detail.outline, syl.detail.evaluation, syl.detail.criteria, syl.detail.rules, syl.detail.prep, ...syl.detail.plan].filter(Boolean).join('\n')} />
                  <Row title={t.official.code} right={<T variant="body" tone="secondary">{c.code ?? '-'}</T>} />
                  <Row title={t.official.credits} right={<T variant="body" tone="secondary">{officialCredits != null ? String(officialCredits) : '-'}</T>} />
                  {c.creditType || c.kind ? <Row title={t.official.kind} subtitle={[...new Set([c.subjectType, c.kind, c.creditType].filter(Boolean))].map((x) => tr(x)).join(' · ')} /> : null}
                  {syl.detail.outline ? <Row title={t.official.summaryLabel} subtitle={<Collapsible text={tr(syl.detail.outline)} variant="sub" tone="secondary" testID="syl-outline" />} /> : null}
                  {syl.detail.goals ? <Row title={t.official.goals} subtitle={<Collapsible text={tr(syl.detail.goals)} variant="sub" tone="secondary" testID="syl-goals" />} /> : null}
                  {syl.detail.evaluation ? <Row title={t.official.evaluation} subtitle={<Collapsible text={tr(syl.detail.evaluation)} variant="sub" tone="secondary" testID="syl-evaluation" />} /> : null}
                  {syl.detail.textbooks.length ? <Row title={t.official.textbook} subtitle={syl.detail.textbooks.map((b) => `${tr(b.title)}${b.isbn ? ` (ISBN ${b.isbn})` : ''}`).join('\n')} /> : syl.detail.textbookNote ? <Row title={t.official.textbook} subtitle={tr(syl.detail.textbookNote)} /> : null}
                  {syl.detail.assigned.length ? <Row title={t.official.assigned} subtitle={syl.detail.assigned.map((b) => tr(b.title)).join('\n')} /> : null}
                  {syl.detail.prereq ? <Row title={t.official.restriction} subtitle={tr(syl.detail.prereq)} /> : null}
                  {syl.detail.rules ? <Row title={t.official.classRules} subtitle={<Collapsible text={tr(syl.detail.rules)} variant="sub" tone="secondary" testID="syl-rules" />} /> : null}
                  {syl.detail.prep ? <Row title={t.official.prep} subtitle={<Collapsible text={tr(syl.detail.prep)} variant="sub" tone="secondary" testID="syl-prep" />} /> : null}
                  {syl.detail.plan.length ? <Row title={t.official.plan} subtitle={syl.detail.plan.map((x, i) => `${i + 1}. ${tr(x)}`).join('\n')} /> : null}
                  <T variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>
                    {t.official.checkedAt(syl.detail.checkedAt)}
                  </T>
                  <T variant="caption" tone="tertiary">
                    {t.official.officialVsStudent}
                  </T>
                </View>
              ) : c.syllabus && c.syllabus.summary ? (
                <View testID="course-syllabus">
                  <Row title={t.official.code} right={<T variant="body" tone="secondary">{c.syllabus.code}</T>} />
                  <Row title={t.official.credits} right={<T variant="body" tone="secondary">{String(c.syllabus.credits)}</T>} />
                  <Row title={t.official.kind} subtitle={tr(c.syllabus.kind)} />
                  <Row title={t.official.summaryLabel} subtitle={tr(c.syllabus.summary)} />
                  <Row title={t.official.evaluation} subtitle={tr(c.syllabus.evaluation)} />
                  {c.syllabus.textbook ? <Row title={t.official.textbook} subtitle={tr(c.syllabus.textbook)} /> : null}
                  {c.syllabus.restriction ? <Row title={t.official.restriction} subtitle={tr(c.syllabus.restriction)} /> : null}
                  {c.syllabus.prerequisite ? <Row title={t.official.prerequisite} subtitle={tr(c.syllabus.prerequisite)} /> : null}
                  {c.syllabus.note ? <T variant="caption" tone="tertiary">{tr(c.syllabus.note)}</T> : null}
                </View>
              ) : (
                <>
                  {c.code ? <Row title={t.official.code} right={<T variant="body" tone="secondary">{c.code}</T>} /> : null}
                  <EmptyText text={t.official.syllabusNone} />
                </>
              )}
              <Button testID="course-syllabus-search" label={t.official.syllabusSearch} icon="open-outline" variant="tertiary" size="md" onPress={() => Linking.openURL(data.sources.SYL.url)} />
              <T variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>
                {t.official.syllabusLinkNote}
              </T>
            </Block>
            <Gap />
            <Block testID="course-fit">
              <BlockHeader title={t.official.fitTitle} />
              {suggest ? (
                <T variant="body" testID="course-fit-text">{t.official.fitLine(categoryLabel(suggest, rulePicked?.rule, t.records.categories, locale), shortNow)}</T>
              ) : (
                <T variant="body" tone="secondary">{rulePicked ? t.official.fitUnknown : t.official.fitNoRule}</T>
              )}
              <T variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>{t.official.fitNote}</T>
              <Button testID="course-open-planner" label={t.official.openPlanner} variant="text" size="md" icon="git-compare-outline" onPress={() => router.push('/planner')} />
            </Block>
            <Gap />
            {c.hasSyllabus ? (
              <>
                <Block testID="course-ops">
                  <Pill text={t.official.opsBadge} tone="accent" />
                  <T variant="headline" style={{ marginTop: space.sm }}>{t.official.opsTitle(ct(c.name))}</T>
                  <T variant="sub" tone="secondary" style={{ marginTop: space.xs }}>
                    {[c.ay, c.section ? `[${c.section}]` : '', c.instructor].filter(Boolean).join(' ')}
                  </T>
                  {syl.detail?.outline ? <T variant="body" numberOfLines={4} style={{ marginTop: space.sm }}>{tr(syl.detail.outline)}</T> : null}
                  {syl.detail?.evaluation ? <T variant="sub" tone="secondary" numberOfLines={3} style={{ marginTop: space.sm }}>{t.official.evaluation}: {tr(syl.detail.evaluation)}</T> : null}
                  <T variant="caption" tone="tertiary" style={{ marginTop: space.sm }}>{t.official.opsNote(syl.detail?.checkedAt ?? data.collectedAt)}</T>
                </Block>
                <Gap />
              </>
            ) : null}
            {sample ? (
              <>
                <Block testID="course-showcase">
                  <Pill text={t.showcase.badge} tone="warning" />
                  <T variant="headline" style={{ marginTop: space.sm }}>{t.showcase.summaryTitle(sample.reviews.length)}</T>
                  <T variant="sub" tone="secondary" testID="course-showcase-stats" style={{ marginTop: space.xs }}>
                    {t.showcase.stats((sample.reviews.reduce((a, r) => a + r.difficulty, 0) / sample.reviews.length).toFixed(1), (sample.reviews.reduce((a, r) => a + r.workload, 0) / sample.reviews.length).toFixed(1))}
                  </T>
                  {sample.aiSummary ? (
                    <View testID="course-showcase-ai" style={{ marginTop: space.sm }}>
                      <T variant="sub" style={{ fontWeight: '700' }}>{t.showcase.aiTitle}</T>
                      <T variant="body" style={{ marginTop: space.xs }}>{locale === 'ja' ? sample.aiSummary.ja : sample.aiSummary.ko}</T>
                    </View>
                  ) : null}
                  {sample.reviews.map((r, i) => (
                    <Row key={i} title={locale === 'ko' ? r.ko : r.ja} subtitle={`${t.official.reviewMeta(r.year, r.grade, r.workload, r.difficulty)}`} />
                  ))}
                  {sample.questions.length ? <T variant="sub" style={{ fontWeight: '700', marginTop: space.md }}>{t.showcase.questions}</T> : null}
                  {sample.questions.map((q, i) => (
                    <Row key={i} title={`Q. ${locale === 'ko' ? q.ko : q.ja}`} subtitle={[...q.answers.map((a) => `A. ${locale === 'ko' ? a.ko : a.ja}`), q.answers.length ? '' : t.showcase.noAnswer].filter(Boolean).join('\n')} />
                  ))}
                  <T variant="caption" tone="tertiary" style={{ marginTop: space.sm }}>{t.showcase.note}</T>
                </Block>
                <Gap />
              </>
            ) : null}
            <Block testID="course-questions">
              <BlockHeader title={t.official.questions} />
              {questions.kind === 'loading' ? (
                <ActivityIndicator color={colors.accent} accessibilityLabel={t.community.loading} />
              ) : questions.kind === 'error' ? (
                <Notice tone="warning" text={apiErrorText(t, questions.error)} />
              ) : questions.data.length === 0 ? (
                <EmptyText text={t.official.questionsNone} />
              ) : (
                questions.data.map((p) => <PostRow key={p.id} post={p} />)
              )}
              <Button testID="course-ask" label={t.official.ask} variant="tertiary" size="md" icon="create-outline" onPress={() => router.push({ pathname: '/post-new', params: { lectureId: c.id } })} />
            </Block>
            <Gap />
            {reviews.kind === 'ok' ? <ReviewInsight lectureId={c.id} reviews={reviews.data} refreshKey={insightKey} /> : null}
            <Block testID="course-reviews">
              <BlockHeader title={t.lectures.reviews(reviews.kind === 'ok' ? reviews.data.length : 0)} />
              {reviews.kind === 'loading' ? (
                <ActivityIndicator color={colors.accent} accessibilityLabel={t.community.loading} />
              ) : reviews.kind === 'error' ? (
                <Notice tone="warning" text={apiErrorText(t, reviews.error)} />
              ) : reviews.data.length === 0 ? (
                <EmptyText text={t.official.reviewsNone} />
              ) : (
                (showAllReviews ? reviews.data : reviews.data.slice(0, 5)).map((r) => (
                  <View key={r.id}>
                    <Row key={r.id} testID={`course-review-${r.id}`} title={contentTr(r.body)} numberOfLines={3} subtitle={t.official.reviewMeta(r.takenYear, r.grade, r.workload, r.difficulty)} onPress={r.mine ? () => router.push({ pathname: '/review-edit', params: { lectureId: c.id, id: String(r.id) } }) : undefined} />
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, alignItems: 'center' }}>
                      {r.isDemo ? <Pill text={t.demoContent.badge} tone="warning" /> : null}
                      <HelpfulButton review={r} onChanged={() => setInsightKey((k) => k + 1)} />
                      {r.mine ? <Button testID={`course-review-edit-${r.id}`} label={t.reviewList.editMine} variant="text" size="md" onPress={() => router.push({ pathname: '/review-edit', params: { lectureId: c.id, id: String(r.id) } })} /> : null}
                    </View>
                  </View>
                ))
              )}
              {reviews.kind === 'ok' && reviews.data.length > 5 && !showAllReviews ? <Button testID="course-reviews-more" label={t.official.more(reviews.data.length - 5)} variant="text" size="md" onPress={() => setShowAllReviews(true)} /> : null}
              {reviews.kind === 'ok' && reviews.data.some((r) => r.isDemo) ? <T variant="caption" tone="tertiary" testID="helpful-demo-note">{t.helpful.demoNote}</T> : null}
              <T variant="caption" tone="tertiary" testID="helpful-limit-note">{t.helpful.limitNote}</T>
              <Button testID="course-write-review" label={t.reviewForm.newTitle} variant="tertiary" size="md" icon="chatbubble-ellipses-outline" onPress={() => router.push({ pathname: '/review-edit', params: { lectureId: c.id } })} />
              <T variant="caption" tone="tertiary">{t.official.reviewScope}</T>
            </Block>
            {siblings.length ? (
              <>
                <Gap />
                <Block testID="course-siblings">
                  <BlockHeader title={t.official.siblings} />
                  {siblings.map((x) => (
                    <Row key={x.id} title={`${cn(x.name)}${x.section ? ` [${x.section}]` : ''}`} subtitle={[x.instructor, weekdayPeriod(x.wp, locale)].filter(Boolean).join(' · ')} chevron onPress={() => router.push({ pathname: '/course', params: { id: x.id } })} />
                  ))}
                  <T variant="caption" tone="tertiary">{t.official.siblingsNote}</T>
                </Block>
              </>
            ) : null}
          </>
        }
      />
    </Screen>
  );
}
