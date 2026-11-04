import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Block, BlockHeader, Button, Gap, Notice, Pill, T } from '@/components/ui';
import { formatShortDateTime, useI18n } from '@/i18n';
import { ApiError, generateCourseSummary, getCourseSummary, summarizeSyllabus, type CourseSummaryState, type SharedReview, type SyllabusPoint } from '@/lib/api';
import { apiErrorText } from '@/features/community/usePosts';
import { useApp } from '@/state/AppContext';
import { colors, space } from '@/theme/tokens';

/**
 * 강의 상세의 후기 요약. 숫자는 프로그램 집계, 글 정리만 AI.
 * 원문이 바뀌면 옛 요약은 '오래됨'으로만 표시하고 내용은 보여 주지 않는다.
 */
export function ReviewInsight({ lectureId, reviews, refreshKey }: { lectureId: string; reviews: SharedReview[]; refreshKey: number }) {
  const { profile } = useApp();
  const { t, locale } = useI18n();
  const [state, setState] = useState<CourseSummaryState | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    getCourseSummary(lectureId)
      .then((s) => {
        setState(s);
        setLoadErr(null);
      })
      .catch((e) => setLoadErr(apiErrorText(t, e)));
  }, [lectureId, t]);
  useEffect(load, [load, refreshKey]);

  const generate = async () => {
    if (busy) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    setErr(null);
    try {
      setState(await generateCourseSummary(profile?.nickname ?? 'guest', lectureId, ctl.signal));
    } catch (e) {
      if (!(e instanceof ApiError && e.kind === 'aborted')) setErr(apiErrorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  if (loadErr) return null;
  if (!state) return null;
  const d = state.digest;
  if (d.count === 0) return null;
  const s = state.summary?.[locale];
  const aspectText = (['assignment', 'project', 'presentation', 'attendance', 'exam'] as const).filter((k) => d.aspects[k]?.mentioned || d.aspects[k]?.denied).map((k) => t.digest.aspect(t.digest.aspects[k], d.aspects[k].mentioned, d.aspects[k].denied));
  const evidence = reviews.filter((r) => state.summary?.evidenceReviewIds.includes(r.id));
  const aspectNames = (pick: (a: CourseSummaryState['digest']['aspects'][string]) => boolean) => (['assignment', 'project', 'presentation', 'attendance', 'exam'] as const).filter((k) => d.aspects[k] && pick(d.aspects[k])).map((k) => t.digest.aspects[k]).join(', ');
  const repeatedNames = aspectNames((a) => !!a.repeated);
  const singleNames = aspectNames((a) => a.singleHelpful != null);
  return (
    <>
      <Block testID="course-review-insight">
        <BlockHeader title={t.digest.title} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginBottom: space.xs }}>
          {d.demoIncluded && d.demoCount ? <Pill text={t.demoContent.badge} tone="warning" /> : null}
          {d.workload?.mixed || d.difficulty?.mixed ? <Pill text={t.digest.mixedPill} /> : null}
        </View>
        <T variant="sub" testID="insight-counts">{t.digest.counts(d.realCount, d.demoIncluded ? d.demoCount : 0)}</T>
        <T variant="sub" tone="secondary" testID="insight-stats">{t.digest.stats(d.workload, d.difficulty)}</T>
        {d.smallSample ? <T variant="caption" tone="tertiary">{t.digest.small}</T> : null}
        {aspectText.length ? <T variant="caption" tone="secondary" style={{ marginTop: space.xs }}>{aspectText.join(' · ')}</T> : null}
        {d.missing.length ? <T variant="caption" tone="tertiary">{t.digest.missing(d.missing.map((k) => t.digest.aspects[k as keyof typeof t.digest.aspects]).join(', '))}</T> : null}
        {d.excludedPostCount ? <T variant="caption" tone="tertiary" testID="insight-excluded">{t.digest.excluded(d.excludedPostCount)}</T> : null}
        {d.excludedReviewCount ? <T variant="caption" tone="tertiary" testID="insight-excluded-reviews">{t.digest.excludedReviews(d.excludedReviewCount)}</T> : null}
        {d.weighted && d.weighted.helpfulTotal > 0 ? (
          <View testID="insight-weighted" style={{ marginTop: space.xs }}>
            <T variant="caption" tone="secondary">{t.digest.weighted(d.weighted.workload, d.weighted.difficulty, d.weighted.helpfulTotal)}</T>
            <T variant="caption" tone="tertiary">{t.digest.weightedNote}</T>
          </View>
        ) : null}
        {repeatedNames ? <T variant="caption" tone="secondary" testID="insight-repeated">{t.digest.repeatedAspects(repeatedNames)}</T> : null}
        {singleNames ? <T variant="caption" tone="secondary" testID="insight-single">{t.digest.singleAspects(singleNames)}</T> : null}
        {state.status === 'stale' ? <View testID="insight-stale"><Notice tone="warning" text={t.digest.stale} /></View> : null}
        {state.status === 'reactions_changed' ? <View testID="insight-reactions-changed"><Notice tone="warning" text={t.digest.reactionsChanged} /></View> : null}
        {s ? (
          <View style={{ marginTop: space.sm }} testID="insight-ai">
            <Pill text={t.digest.aiLabel} tone="accent" />
            <T variant="sub" style={{ marginTop: space.xs }}>{s.overview}</T>
            <T variant="caption" tone="secondary">{t.digest.workloadLabel}: {s.workload}</T>
            <T variant="caption" tone="secondary">{t.digest.difficultyLabel}: {s.difficulty}</T>
            <T variant="caption" tone="secondary">{t.digest.evaluationLabel}: {s.evaluation}</T>
            {s.good.length ? <T variant="caption" tone="secondary">{t.digest.good}: {s.good.join(' / ')}</T> : null}
            {s.caution.length ? <T variant="caption" tone="secondary">{t.digest.caution}: {s.caution.join(' / ')}</T> : null}
            {s.split.length ? <T variant="caption" tone="secondary">{t.digest.split}: {s.split.join(' / ')}</T> : null}
            {s.repeated?.length ? <T variant="caption" tone="secondary">{t.digest.repeated}: {s.repeated.join(' / ')}</T> : null}
            {s.helpfulNotes?.length ? <T variant="caption" tone="secondary" testID="insight-helpful-notes">{t.digest.helpfulNotes}: {s.helpfulNotes.join(' / ')}</T> : null}
            {s.missingInfo?.length ? <T variant="caption" tone="tertiary">{t.digest.missingInfo}: {s.missingInfo.join(' / ')}</T> : null}
            {state.updatedAt ? <T variant="caption" tone="tertiary" testID="insight-meta">{t.digest.meta(state.version ?? 0, locale === 'ja' ? '日本語' : '한국어', formatShortDateTime(state.updatedAt, locale))}</T> : null}
            {evidence.length ? <Button testID="insight-evidence" label={showEvidence ? t.digest.evidenceHide : t.digest.evidenceShow(evidence.length)} variant="text" size="md" onPress={() => setShowEvidence(!showEvidence)} /> : null}
            {showEvidence ? evidence.map((r) => <T key={r.id} variant="caption" tone="tertiary" testID={`insight-evidence-${r.id}`}>• {r.body}</T>) : null}
          </View>
        ) : null}
        {busy ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm }}>
            <ActivityIndicator color={colors.accent} accessibilityLabel={t.common.loading} />
            <T variant="sub" tone="secondary">{t.digest.generating}</T>
            <Button testID="insight-cancel" label={t.common.cancel} variant="tertiary" size="md" onPress={() => abort.current?.abort()} />
          </View>
        ) : state.status !== 'fresh' ? (
          <Button testID="insight-generate" label={state.status === 'stale' || state.status === 'reactions_changed' ? t.digest.refresh : t.digest.generate} variant="tertiary" size="md" icon="sparkles-outline" onPress={generate} />
        ) : null}
        {err ? <Notice tone="danger" text={err} /> : null}
      </Block>
      <Gap />
    </>
  );
}

/** 강의계획서 AI 요약: 항목마다 원문 인용을 붙이고, 인용이 원문에 없으면 표시한다 */
export function SyllabusSummary({ lectureId, source }: { lectureId: string; source: string }) {
  const { profile } = useApp();
  const { t, locale } = useI18n();
  const [points, setPoints] = useState<SyllabusPoint[] | null>(null);
  const [cached, setCached] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const run = async () => {
    if (busy) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    setErr(null);
    try {
      const r = await summarizeSyllabus(profile?.nickname ?? 'guest', lectureId, source, ctl.signal);
      setPoints(r.points);
      setCached(r.cached);
    } catch (e) {
      if (!(e instanceof ApiError && e.kind === 'aborted')) setErr(apiErrorText(t, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View testID="syllabus-ai" style={{ marginTop: space.sm }}>
      {!points && !busy ? <Button testID="syllabus-ai-run" label={t.syllabusAi.run} variant="tertiary" size="md" icon="sparkles-outline" onPress={run} /> : null}
      {!points && !busy ? <T variant="caption" tone="tertiary">{t.syllabusAi.note}</T> : null}
      {busy ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <ActivityIndicator color={colors.accent} accessibilityLabel={t.common.loading} />
          <T variant="sub" tone="secondary">{t.syllabusAi.running}</T>
          <Button testID="syllabus-ai-cancel" label={t.common.cancel} variant="tertiary" size="md" onPress={() => abort.current?.abort()} />
        </View>
      ) : null}
      {err ? <Notice tone="danger" text={err} /> : null}
      {points ? (
        <View testID="syllabus-ai-result">
          <Pill text={t.digest.aiLabel} tone="accent" />
          {cached ? <T variant="caption" tone="tertiary">{t.syllabusAi.cached}</T> : null}
          {points.map((p, i) => (
            <View key={i} style={{ marginTop: space.sm }}>
              <T variant="sub" style={{ fontWeight: '700' }}>{t.syllabusAi.topics[p.topic]}</T>
              <T variant="sub">{locale === 'ja' ? p.ja : p.ko}</T>
              <T variant="caption" tone={p.evidenceFound ? 'tertiary' : 'danger'}>{p.evidenceFound ? t.noticeAi.evidence(p.evidence) : t.noticeAi.evidenceMissing}</T>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
