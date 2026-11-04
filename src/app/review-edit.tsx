import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useLayoutEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Chip, Notice, Screen, Segmented, T, TextField } from '@/components/ui';
import type { AttendanceMethod } from '@/data/lectures';
import { useAnyLecture } from '@/features/official/useAnyLecture';
import { apiErrorText } from '@/features/community/usePosts';
import { useI18n } from '@/i18n';
import {
  ApiError,
  createReview,
  deleteReview,
  listReviews,
  newClientId,
  REVIEW_EVALUATIONS,
  REVIEW_LIMITS,
  updateReview,
  type ReviewEvaluation,
  type SharedReview,
} from '@/lib/api';
import { confirmDestructive } from '@/lib/confirm';
import { academicNow } from '@/lib/dates';
import { useApp } from '@/state/AppContext';
import { colors, gutter, space } from '@/theme/tokens';

const ATTENDANCE: AttendanceMethod[] = ['in_person', 'online', 'hybrid'];
const GRADES = [1, 2, 3, 4, 5, 6];
const LEVELS = [1, 2, 3, 4, 5];

interface Draft {
  takenYear: number | null;
  grade: number | null;
  attendance: AttendanceMethod | null;
  evaluation: ReviewEvaluation | null;
  workload: number | null;
  difficulty: number | null;
  body: string;
}
type Errors = Partial<Record<keyof Draft, string>>;

const fromReview = (r: SharedReview): Draft => ({
  takenYear: r.takenYear,
  grade: r.grade,
  attendance: r.attendance,
  evaluation: r.evaluation,
  workload: r.workload,
  difficulty: r.difficulty,
  body: r.body,
});

/** 가로로 넘기는 선택 칩 한 줄 */
function ChoiceRow({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: space.lg }}>
      <T variant="sub" tone="secondary" style={{ fontWeight: '600', marginBottom: space.xs }}>
        {label}
      </T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hScroll} contentContainerStyle={styles.hScrollContent}>
        {children}
      </ScrollView>
      {error ? (
        <T variant="sub" tone="danger" live>
          {error}
        </T>
      ) : null}
    </View>
  );
}

/**
 * 강의 후기 작성·수정. 주소: /review-edit?lectureId=lec-x (작성) / &id=12 (내 후기 수정)
 * 공유 서버에 저장한다. 실패하면 입력은 그대로 두고, 브라우저에 몰래 저장하지 않는다.
 */
export default function ReviewEditScreen() {
  const { profile } = useApp();
  const { t } = useI18n();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ lectureId?: string; id?: string }>();
  const lecture = useAnyLecture(params.lectureId);
  const [editId, setEditId] = useState<number | null>(params.id ? Number(params.id) : null);
  const [draft, setDraft] = useState<Draft>({
    takenYear: null,
    grade: profile?.currentGrade ?? null,
    attendance: null,
    evaluation: null,
    workload: null,
    difficulty: null,
    body: '',
  });
  const [loadingExisting, setLoadingExisting] = useState(Boolean(params.id));
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [clientId] = useState(newClientId);
  const nickname = profile?.nickname ?? 'guest';
  const thisYear = Number(academicNow().date.slice(0, 4));
  const years = [thisYear, thisYear - 1, thisYear - 2, thisYear - 3, thisYear - 4];

  useLayoutEffect(() => {
    navigation.setOptions({ title: editId ? t.reviewForm.editTitle : t.reviewForm.newTitle });
  }, [navigation, editId, t]);

  // 수정: 서버에서 내 후기를 다시 읽어 온다 (다른 사람 후기 id 로 들어오면 찾지 못함)
  useEffect(() => {
    if (!params.id || !lecture) return;
    let alive = true;
    listReviews(lecture.id)
      .then((list) => {
        if (!alive) return;
        const found = list.find((r) => r.id === Number(params.id) && r.mine);
        if (found) setDraft(fromReview(found));
        else {
          setEditId(null);
          setMessage({ tone: 'danger', text: t.reviewForm.notFound });
        }
      })
      .catch((e: unknown) => alive && setMessage({ tone: 'danger', text: apiErrorText(t, e) }))
      .finally(() => alive && setLoadingExisting(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 강의 id 가 바뀔 때만 다시 읽는다
  }, [params.id, lecture?.id, t]);

  if (!lecture || !lecture.title) {
    return (
      <Screen layout="reading" edges={['bottom']}>
        <Notice tone="danger" text={t.lectures.notFound} />
      </Screen>
    );
  }

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const submit = async () => {
    if (saving) return;
    const e: Errors = {};
    const body = draft.body.trim();
    (['takenYear', 'grade', 'attendance', 'evaluation', 'workload', 'difficulty'] as const).forEach((k) => {
      if (draft[k] == null) e[k] = t.reviewForm.errRequired;
    });
    if ([...body].length < REVIEW_LIMITS.min) e.body = t.reviewForm.errBodyShort(REVIEW_LIMITS.min);
    else if ([...body].length > REVIEW_LIMITS.max) e.body = t.reviewForm.errBodyLong(REVIEW_LIMITS.max);
    setErrors(e);
    if (Object.keys(e).length > 0) {
      setMessage({ tone: 'danger', text: t.reviewForm.errCheck });
      return;
    }
    const input = {
      takenYear: draft.takenYear!,
      grade: draft.grade!,
      attendance: draft.attendance!,
      evaluation: draft.evaluation!,
      workload: draft.workload!,
      difficulty: draft.difficulty!,
      body,
    };
    setSaving(true);
    setMessage(null);
    try {
      if (editId) await updateReview(nickname, editId, input);
      else await createReview(nickname, lecture.id, { ...input, clientId, offering: lecture.official ? (lecture.subtitle ?? null) : null });
      // 서버 저장이 확인된 뒤에만 상세로 돌아간다 (상세가 다시 불러와 목록·요약에 반영)
      router.back();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // 이미 쓴 후기가 있으면 그 후기를 수정하도록 바꾼다 (지금 입력한 내용은 그대로 둔다)
        const list = await listReviews(lecture.id).catch(() => []);
        const existing = list.find((r) => r.mine);
        if (existing) setEditId(existing.id);
        setMessage({ tone: 'info', text: t.reviewForm.already });
      } else if (err instanceof ApiError && err.status === 403) {
        setMessage({ tone: 'danger', text: t.reviewForm.forbidden });
      } else if (err instanceof ApiError && err.status === 404) {
        setEditId(null);
        setMessage({ tone: 'danger', text: `${t.reviewForm.notFound} ${t.community.keptInput}` });
      } else {
        setMessage({ tone: 'danger', text: `${apiErrorText(t, err)} ${t.community.keptInput}` });
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = () =>
    confirmDestructive(t.reviewForm.deleteConfirmTitle, t.reviewForm.deleteConfirmBody, { ok: t.common.ok, cancel: t.common.cancel }, async () => {
      if (!editId) return;
      setSaving(true);
      try {
        await deleteReview(nickname, editId);
        router.back();
      } catch (err) {
        setMessage({ tone: 'danger', text: err instanceof ApiError && err.status === 403 ? t.reviewForm.forbidden : apiErrorText(t, err) });
      } finally {
        setSaving(false);
      }
    });

  if (loadingExisting) {
    return (
      <Screen layout="reading" edges={['bottom']} background={colors.surface}>
        <ActivityIndicator color={colors.accent} style={{ marginTop: space.huge }} accessibilityLabel={t.common.loading} />
      </Screen>
    );
  }

  return (
    <Screen layout="reading"
      edges={['bottom']}
      background={colors.surface}
      footer={
        <>
          {message && <Notice tone={message.tone} text={message.text} />}
          <Button testID="submit-review" label={editId ? t.reviewForm.save : t.reviewForm.submit} onPress={submit} loading={saving} />
          {editId ? <Button testID="delete-review" label={t.reviewForm.delete} variant="dangerText" size="md" onPress={remove} disabled={saving} /> : null}
        </>
      }
    >
      <T variant="headline" style={{ marginBottom: space.xs }} testID="review-lecture">
        {lecture.title}
        {lecture.subtitle ? ` ${lecture.subtitle}` : ''}
      </T>
      <Notice text={lecture.official ? `${t.reviewForm.noticeOfficial} ${t.reviewForm.rule}` : `${t.reviewForm.notice} ${t.reviewForm.rule}`} />

      <ChoiceRow label={t.reviewForm.takenYear} error={errors.takenYear}>
        {years.map((y) => (
          <Chip key={y} testID={`rv-year-${y}`} label={t.common.year(y)} selected={draft.takenYear === y} onPress={() => set({ takenYear: y })} />
        ))}
      </ChoiceRow>
      <ChoiceRow label={t.reviewForm.grade} error={errors.grade}>
        {GRADES.map((g) => (
          <Chip key={g} testID={`rv-grade-${g}`} label={t.common.grade(g)} selected={draft.grade === g} onPress={() => set({ grade: g })} />
        ))}
      </ChoiceRow>
      {profile ? (
        <T variant="caption" tone="tertiary" style={{ marginTop: -space.md, marginBottom: space.lg }}>
          {t.reviewForm.gradeHint}
        </T>
      ) : null}
      <View style={{ marginBottom: space.lg }}>
        <T variant="sub" tone="secondary" style={{ fontWeight: '600', marginBottom: space.xs }}>
          {t.reviewForm.attendance}
        </T>
        <Segmented<AttendanceMethod>
          label={t.reviewForm.attendance}
          testIDPrefix="rv-att"
          value={draft.attendance}
          onChange={(attendance) => set({ attendance })}
          options={ATTENDANCE.map((a) => ({ value: a, label: t.lectures.attendance[a] }))}
        />
        {errors.attendance ? (
          <T variant="sub" tone="danger" live>
            {errors.attendance}
          </T>
        ) : null}
      </View>
      <ChoiceRow label={t.reviewForm.evaluation} error={errors.evaluation}>
        {REVIEW_EVALUATIONS.map((ev) => (
          <Chip key={ev} testID={`rv-eval-${ev}`} label={t.reviewForm.evaluationKinds[ev]} selected={draft.evaluation === ev} onPress={() => set({ evaluation: ev })} />
        ))}
      </ChoiceRow>
      <ChoiceRow label={t.reviewForm.workload} error={errors.workload}>
        {LEVELS.map((n) => (
          <Chip key={n} testID={`rv-work-${n}`} label={t.lectures.level[n]} selected={draft.workload === n} onPress={() => set({ workload: n })} />
        ))}
      </ChoiceRow>
      <ChoiceRow label={t.reviewForm.difficulty} error={errors.difficulty}>
        {LEVELS.map((n) => (
          <Chip key={n} testID={`rv-diff-${n}`} label={t.lectures.diffLevel[n]} selected={draft.difficulty === n} onPress={() => set({ difficulty: n })} />
        ))}
      </ChoiceRow>
      <TextField
        testID="rv-body"
        label={t.reviewForm.body}
        value={draft.body}
        onChangeText={(body) => set({ body })}
        placeholder={t.reviewForm.bodyPlaceholder}
        multiline
        maxLength={REVIEW_LIMITS.max}
        textAlignVertical="top"
        style={{ height: 160, paddingTop: space.md }}
        error={errors.body}
        hint={t.reviewForm.bodyHint(REVIEW_LIMITS.min, REVIEW_LIMITS.max)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hScroll: { marginHorizontal: -gutter },
  hScrollContent: { paddingHorizontal: gutter },
});
