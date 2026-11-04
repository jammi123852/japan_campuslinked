import { ContentText } from '@/components/ContentText';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCourseName } from '@/data/useCourseName';
import { useCallback, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Block, BlockHeader, Button, Chip, Columns, EmptyText, Gap, Notice, Pill, Row, Screen, SourceBadge, T } from '@/components/ui';
import { findFaculty } from '@/data/faculties';
import { findLecture, LECTURES } from '@/data/lectures';
import { PostRow } from '@/features/community/PostRow';
import { apiErrorText, usePosts } from '@/features/community/usePosts';
import { checkAddLecture, lectureToEntries } from '@/features/lectures/lectureLogic';
import { summarizeReviews } from '@/features/lectures/reviewSummary';
import { HelpfulButton } from '@/features/lectures/HelpfulButton';
import { useLectureReviews } from '@/features/lectures/useLectureReviews';
import { formatDate, useI18n } from '@/i18n';
import { toggleLecture, useSaved } from '@/services/savedRepository';
import { loadEditableTimetable, newEntryId, saveTimetable } from '@/services/timetableRepository';
import { useApp } from '@/state/AppContext';
import { colors, gutter, space } from '@/theme/tokens';

/** 정적 웹 빌드에서 강의마다 HTML 을 만들어 직접 접속·새로고침이 되게 한다 */
export function generateStaticParams(): { id: string }[] {
  return LECTURES.map((l) => ({ id: l.id }));
}

type AddResult = { tone: 'info' | 'warning'; text: string; added: boolean } | null;

export default function LectureDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useApp();
  const { t, locale } = useI18n();
  const cn = useCourseName();
  const lecture = findLecture(id);
  const { state: questions, reload } = usePosts({ lectureId: lecture?.id ?? '__none__' });
  // 질문을 쓰고 돌아왔을 때 목록을 다시 불러온다
  const { state: shared, reload: reloadReviews } = useLectureReviews(lecture?.id);
  useFocusEffect(
    useCallback(() => {
      reload();
      reloadReviews();
    }, [reload, reloadReviews]),
  );
  const saved = useSaved(session);
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState<AddResult>(null);

  if (!lecture) {
    return (
      <Screen edges={['bottom']}>
        <EmptyText text={t.lectures.notFound} />
      </Screen>
    );
  }

  const isFavorite = saved.favorites.some((x) => x.lectureId === lecture.id);
  const isLater = saved.later.some((x) => x.lectureId === lecture.id);
  const sharedList = shared.kind === 'ok' ? shared.data : [];
  const mine = sharedList.find((r) => r.mine);
  const summary = summarizeReviews(sharedList);
  const totalReviews = lecture.reviews.length + sharedList.length;
  const openReviewForm = () =>
    router.push({ pathname: '/review-edit', params: mine ? { lectureId: lecture.id, id: String(mine.id) } : { lectureId: lecture.id } });

  const meetingText = lecture.meetings.map((m) => t.lectures.meeting(t.common.weekdays[m.weekday], m.period)).join(', ');

  const addToTimetable = async () => {
    if (!session) return;
    setAdding(true);
    try {
      const { entries } = await loadEditableTimetable(session, t);
      const check = checkAddLecture(lecture, entries);
      if (check.kind === 'duplicate') {
        setResult({ tone: 'info', text: t.lectures.duplicate, added: false });
      } else if (check.kind === 'conflict') {
        const list = check.conflicts
          .map((c) => `${t.lectures.meeting(t.common.weekdays[c.weekday], c.period)} ${cn(c.courseName)}`)
          .join(', ');
        setResult({ tone: 'warning', text: t.lectures.conflict(list), added: false });
      } else {
        await saveTimetable(session, [...entries, ...lectureToEntries(lecture, lecture.name[locale], newEntryId)]);
        setResult({ tone: 'info', text: t.lectures.added, added: true });
      }
    } finally {
      setAdding(false);
    }
  };

  return (
    <Screen
      edges={['bottom']}
      footer={
        <>
          {result && <Notice tone={result.tone} text={result.text} />}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button testID="add-lecture" label={t.lectures.addToTimetable} icon="add-circle-outline" onPress={addToTimetable} loading={adding} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                testID="ask-lecture"
                label={t.lectures.ask}
                icon="chatbubble-ellipses-outline"
                variant="secondary"
                onPress={() => router.push({ pathname: '/post-new', params: { lectureId: lecture.id } })}
              />
            </View>
          </View>
          {result?.added || result?.text === t.lectures.duplicate ? (
            <Button testID="view-calendar" label={t.lectures.viewCalendar} variant="text" size="md" onPress={() => router.push('/calendar')} />
          ) : null}
        </>
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs }}>
        <SourceBadge source={lecture.source} />
      </View>
      <T variant="display" header testID="lecture-title">
        {lecture.name[locale]}
      </T>
      <T variant="body" tone="secondary" style={{ marginTop: space.xs, marginBottom: space.md }}>
        {lecture.instructor[locale]}
      </T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: space.md }}>
        <Chip
          testID="toggle-favorite"
          onGray
          icon={isFavorite ? 'star' : 'star-outline'}
          label={t.saved.favoriteAdd}
          accessibilityLabel={isFavorite ? t.saved.favoriteRemove : t.saved.favoriteAdd}
          selected={isFavorite}
          onPress={() => session && toggleLecture(session, 'favorites', lecture.id)}
        />
        <Chip
          testID="toggle-later"
          onGray
          icon={isLater ? 'bookmark' : 'bookmark-outline'}
          label={t.saved.laterAdd}
          accessibilityLabel={isLater ? t.saved.laterRemove : t.saved.laterAdd}
          selected={isLater}
          onPress={() => session && toggleLecture(session, 'later', lecture.id)}
        />
      </View>

      <Columns
        first={
          <>
            <Block flush>
              <View style={{ paddingHorizontal: gutter }}>
                <Row title={t.lectures.faculty} right={<T variant="body" tone="secondary">{findFaculty(lecture.facultyId)?.name ?? '-'}</T>} />
                <Row title={t.lectures.target} right={<T variant="body" tone="secondary">{t.lectures.grades(lecture.grades)}</T>} />
                <Row title={t.lectures.schedule} right={<T variant="body" tone="secondary" testID="lecture-schedule">{meetingText}</T>} />
                <Row title={t.lectures.room} right={<T variant="body" tone="secondary">{lecture.room}</T>} />
                <Row title={t.lectures.filterAttendance} right={<T variant="body" tone="secondary">{t.lectures.attendance[lecture.attendance]}</T>} />
              </View>
            </Block>

            <Gap />
            <Block>
              <BlockHeader title={t.lectures.summary} />
              <Row
                title={t.lectures.evaluation}
                subtitle={t.lectures.evalLine(lecture.evaluation.exam, lecture.evaluation.report, lecture.evaluation.participation)}
              />
              <Row title={t.lectures.workload} right={<T variant="body" tone="secondary">{t.lectures.level[lecture.workload]}</T>} />
              <Row title={t.lectures.difficulty} right={<T variant="body" tone="secondary">{t.lectures.diffLevel[lecture.difficulty]}</T>} />
              <Row
                title={t.lectures.syllabus}
                right={
                  <T variant="body" tone="tertiary" testID="syllabus">
                    {lecture.syllabusUrl ? lecture.syllabusUrl : t.lectures.syllabusNone}
                  </T>
                }
              />
            </Block>

            <Gap />
            <Block>
              <BlockHeader title={t.reviewList.summaryTitle} />
              {summary ? (
                <View testID="review-summary">
                  <T variant="sub" tone="tertiary" style={{ marginBottom: space.xs }}>
                    {t.reviewList.summaryBasis(summary.count)}
                  </T>
                  <Row title={t.lectures.workload} right={<T variant="body" tone="secondary">{`${summary.workload}/5`}</T>} />
                  <Row title={t.lectures.difficulty} right={<T variant="body" tone="secondary">{`${summary.difficulty}/5`}</T>} />
                  <Row title={t.reviewForm.attendance} right={<T variant="body" tone="secondary">{t.lectures.attendance[summary.attendance]}</T>} />
                  <Row title={t.reviewForm.evaluation} right={<T variant="body" tone="secondary">{t.reviewForm.evaluationKinds[summary.evaluation]}</T>} />
                </View>
              ) : (
                <EmptyText text={t.reviewList.summaryNone} />
              )}
            </Block>
          </>
        }
        second={
          <>
            <Block>
              <BlockHeader title={t.lectures.reviews(totalReviews)} testID="reviews-header" />
              <Button testID="write-review" label={mine ? t.reviewList.editMine : t.reviewList.write} icon="create-outline" variant="secondary" size="md" onPress={openReviewForm} />
              {shared.kind === 'loading' ? (
                <ActivityIndicator color={colors.accent} style={{ marginVertical: space.md }} accessibilityLabel={t.reviewList.loading} />
              ) : shared.kind === 'error' ? (
                <View style={{ marginTop: space.md }}>
                  <Notice tone="warning" text={t.reviewList.unavailable(apiErrorText(t, shared.error))} />
                  <Button label={t.community.retry} variant="tertiary" size="md" onPress={reloadReviews} />
                </View>
              ) : sharedList.length === 0 ? (
                <EmptyText text={lecture.reviews.length > 0 ? t.reviewList.onlySample : t.reviewList.none} />
              ) : null}
              {sharedList.map((rv) => (
                <View key={`u-${rv.id}`} style={{ paddingVertical: space.md }} testID={`review-${rv.id}`}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginBottom: space.xs }}>
                    <Pill text={rv.mine ? t.reviewList.mine : t.reviewList.user} tone={rv.mine ? 'accent' : 'neutral'} />
                    {rv.isDemo ? <Pill text={t.demoContent.badge} tone="warning" /> : null}
                    <T variant="sub" tone="tertiary">
                      {t.lectures.reviewMeta(rv.grade, rv.takenYear, formatDate(rv.createdAt, locale))}
                      {rv.updatedAt !== rv.createdAt ? ` · ${t.reviewList.edited}` : ''}
                    </T>
                  </View>
                  <T variant="sub" tone="secondary" style={{ marginBottom: space.xs }}>
                    {t.reviewList.line(
                      t.lectures.attendance[rv.attendance],
                      t.reviewForm.evaluationKinds[rv.evaluation],
                      t.lectures.level[rv.workload],
                      t.lectures.diffLevel[rv.difficulty],
                    )}
                  </T>
                  <ContentText text={rv.body} testID={`review-body-${rv.id}`} />
                  <HelpfulButton review={rv} />
                </View>
              ))}
              {lecture.reviews.length > 0 ? (
                <View style={{ marginTop: space.md }}>
                  <SourceBadge source={lecture.source} />
                </View>
              ) : null}
              {lecture.reviews.map((rv) => (
                <View key={rv.id} style={{ paddingVertical: space.md }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.xs }}>
                    <T variant="sub" tone="tertiary">
                      {t.lectures.reviewMeta(rv.grade, rv.takenYear, rv.createdAt)}
                    </T>
                    <T variant="sub" tone="accent" style={{ fontWeight: '600' }}>
                      {t.lectures.rating(rv.rating)}
                    </T>
                  </View>
                  <T variant="body">{rv.body[locale]}</T>
                </View>
              ))}
            </Block>

            <Gap />
            <Block flush>
              <View style={{ paddingHorizontal: gutter, paddingTop: space.md }}>
                <BlockHeader title={t.lectures.questions} />
              </View>
              <View style={{ paddingHorizontal: gutter, paddingBottom: space.sm }}>
                {questions.kind === 'loading' ? (
                  <ActivityIndicator color={colors.accent} style={{ marginVertical: space.lg }} accessibilityLabel={t.community.loading} />
                ) : questions.kind === 'error' ? (
                  <>
                    <EmptyText text={apiErrorText(t, questions.error)} />
                    <Button label={t.community.retry} variant="tertiary" size="md" onPress={reload} />
                  </>
                ) : questions.data.length === 0 ? (
                  <EmptyText text={t.lectures.noQuestions} />
                ) : (
                  questions.data.map((p) => <PostRow key={p.id} post={p} />)
                )}
              </View>
            </Block>
          </>
        }
      />
    </Screen>
  );
}
