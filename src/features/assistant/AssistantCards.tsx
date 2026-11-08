import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';

import { Collapsible } from '@/components/Collapsible';
import { ContentText } from '@/components/ContentText';
import { Button, Chip, EmptyText, Notice, Pill, Row, T, TextField } from '@/components/ui';
import { useCourseName } from '@/data/useCourseName';
import { entryInPeriod, periodKey, type AcademicPeriod } from '@/features/academic/academicLogic';
import { usePeriodLabel } from '@/features/academic/PeriodBar';
import { categoryLabel, deptCodeOf, coursesForDept } from '@/features/official/courseLogic';
import { deptKeyOf } from '@/features/official/SourceLine';
import type { OfficialData } from '@/features/official/types';
import { MiniGrid } from '@/features/planner/MiniGrid';
import type { Plan } from '@/features/planner/plannerLogic';
import { pickRule } from '@/features/records/gradLogic';
import { canSaveDate, dateClock, dateLabel, noticeEvent, noticeText, savePolicy } from '@/features/notice/noticeLogic';
import { useI18n } from '@/i18n';
import { explainPlan, fetchDigests, type CourseDigest, type NoticeAnalysis } from '@/lib/api';
import { useCt } from '@/lib/contentTranslate';
import { academicNow } from '@/lib/dates';
import { useTr } from '@/lib/translate';
import { saveScholarshipAnswers, useScholarshipAnswers } from '@/services/careerRepository';
import { addChecklistItem, useChecklist } from '@/services/checklistRepository';
import { newEventId, upsertEvent, upsertEventBySource, useEvents } from '@/services/scheduleRepository';
import { useTimetableVersion, loadEditableTimetable } from '@/services/timetableRepository';
import { useRecordsVersion } from '@/services/recordsRepository';
import { colors, space } from '@/theme/tokens';

import { AltHighlights } from '@/features/planner/AltHighlights';
import { altHighlights, altReviewNotes, gradEffect } from '@/features/planner/builderLogic';
import { ReviewNotes } from '@/features/planner/ReviewNotes';
import { conditionsFromCall, EMPTY_CONDITIONS, planAnswerMismatch, planFingerprint, planFromConditions, prefEvidence, PREFS, scholarshipView, type PlanConditions, type PlanInput, type PlanOutcome, type Pref } from './assistantLogic';
import { applyPlanInChat, loadPlanInput, noticeSources, runNoticeAnalysis, runTool, undoPlanInChat, type Card, type ToolCtx } from './assistantTools';

const Section = ({ title, children, testID }: { title: string; children: React.ReactNode; testID?: string }) => (
  <View style={{ marginTop: space.md }} testID={testID}>
    <T variant="sub" style={{ fontWeight: '700', marginBottom: space.xs }}>{title}</T>
    {children}
  </View>
);

/** 후기 요약 한 줄: 숫자는 집계값, 데모 후기는 표시 */
export function DigestLine({ d, testID }: { d: CourseDigest | undefined; testID?: string }) {
  const { t } = useI18n();
  if (!d || d.count === 0) return <T variant="caption" tone="tertiary" testID={testID}>{t.digest.none}</T>;
  return (
    <View testID={testID}>
      <T variant="caption" tone="secondary">
        {t.digest.line(d.count, d.demoIncluded ? d.demoCount : 0, d.workload?.avg ?? null, d.difficulty?.avg ?? null)}
      </T>
      {d.smallSample ? <T variant="caption" tone="tertiary">{t.digest.small}</T> : null}
      {d.workload?.mixed || d.difficulty?.mixed ? <T variant="caption" tone="tertiary">{t.digest.mixed}</T> : null}
    </View>
  );
}

function CourseRow({ id, od, d, right }: { id: string; od: OfficialData; d?: CourseDigest; right?: React.ReactNode }) {
  const { t, locale } = useI18n();
  const cn = useCourseName();
  const c = od.courses.find((x) => x.id === id);
  if (!c) return null;
  const when = c.meetings.map((m) => `${t.common.weekdays[m.weekday]}${t.common.period(m.period)}`).join(', ');
  return (
    <Row
      testID={`assistant-course-${id}`}
      title={`${cn(c.name)}${c.section ? ` [${c.section}]` : ''}`}
      numberOfLines={2}
      chevron={!right}
      right={right}
      onPress={() => router.push({ pathname: '/course', params: { id } })}
      subtitle={
        <View>
          <T variant="caption" tone="tertiary">{[c.instructor, when, c.quarters.join('·'), (c.credits ?? c.syllabus?.credits) != null ? t.assistant.credits(c.credits ?? c.syllabus?.credits ?? 0) : null].filter(Boolean).join(' · ')}</T>
          {d !== undefined || locale ? <DigestLine d={d} /> : null}
        </View>
      }
    />
  );
}

function useDigests(ids: string[]) {
  const [state, setState] = useState<Record<string, CourseDigest>>({});
  const key = ids.join(',');
  useEffect(() => {
    let alive = true;
    fetchDigests(key ? key.split(',') : []).then((d) => alive && setState(d)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [key]);
  return state;
}

// ------------------------------------------------------------ 졸업

function GradCard({ card, ctx }: { card: Extract<Card, { type: 'grad' }>; ctx: ToolCtx }) {
  const { t, locale } = useI18n();
  const dk = deptKeyOf(ctx.profile.facultyId, ctx.profile.departmentId);
  const rule = pickRule(dk ? ctx.od.departments[dk]?.rules : undefined, ctx.profile.admissionYear, ctx.profile.courseName);
  const v = card.view;
  const allIds = Object.values(card.recIds).flat();
  const digests = useDigests(allIds);
  if (v.noRule) return <Notice tone="warning" text={t.assistant.gradNoRule} />;
  const label = (id: string) => (id === 'flex' ? t.assistant.flex : rule?.rule.pools?.find((p) => p.id === id)?.label ?? categoryLabel(id, rule?.rule ?? null, t.records.categories, locale));
  return (
    <View testID="assistant-card-grad">
      <T variant="headline" testID="assistant-grad-total">{t.assistant.gradLine(v.earned, v.total, v.totalShort)}</T>
      {v.withEnrolled !== v.earned ? <T variant="sub" tone="secondary">{t.assistant.gradEnrolled(v.withEnrolled, v.totalShortCurrent)}</T> : null}
      {v.rows.length === 0 ? <T variant="sub" tone="secondary">{t.assistant.gradNoShortRows}</T> : null}
      {v.rows.map((r) => (
        <Section key={r.id} title={t.assistant.gradRow(label(r.id), r.short, r.earned, r.min)}>
          {(card.recIds[r.id] ?? []).length === 0 ? <T variant="caption" tone="tertiary">{t.assistant.gradNoCourse}</T> : (card.recIds[r.id] ?? []).map((id) => <CourseRow key={id} id={id} od={ctx.od} d={digests[id]} />)}
        </Section>
      ))}
      {v.unknownCredits > 0 ? <Notice tone="warning" text={t.assistant.gradUnknown(v.unknownCredits)} /> : null}
      <T variant="caption" tone="tertiary" style={{ marginTop: space.sm }}>{t.assistant.gradBasis(ctx.profile.admissionYear ?? 0, v.creditTableOnly)}</T>
      <Button testID="assistant-open-graduation" label={t.assistant.openGraduation} variant="text" size="md" onPress={() => router.push('/graduation')} />
    </View>
  );
}

// ------------------------------------------------------------ 비교

function CompareCard({ ids, ctx }: { ids: string[]; ctx: ToolCtx }) {
  const { t } = useI18n();
  const tr = useTr();
  const cn = useCourseName();
  const digests = useDigests(ids);
  const [syl, setSyl] = useState<Record<string, { outline: string; evaluation: string } | null>>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Record<string, { outline: string; evaluation: string } | null> = {};
      for (const id of ids) {
        const r = await fetch(`/official/syl/${id.slice(1, 3)}.json`).catch(() => null);
        const m = r && r.ok ? ((await r.json().catch(() => null)) as Record<string, { outline: string; evaluation: string }> | null) : null;
        out[id] = m?.[id] ?? null;
      }
      if (alive) setSyl(out);
    })();
    return () => {
      alive = false;
    };
  }, [ids]);
  return (
    <View testID="assistant-card-compare">
      {ids.map((id) => {
        const c = ctx.od.courses.find((x) => x.id === id);
        if (!c) return null;
        const d = digests[id];
        return (
          <View key={id} style={{ paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: colors.divider }} testID={`assistant-compare-${id}`}>
            <T variant="body" style={{ fontWeight: '700' }}>{cn(c.name)}{c.section ? ` [${c.section}]` : ''}</T>
            <T variant="caption" tone="tertiary">{[c.instructor, c.meetings.map((m) => `${t.common.weekdays[m.weekday]}${t.common.period(m.period)}`).join(', '), c.quarters.join('·')].filter(Boolean).join(' · ')}</T>
            <Section title={t.assistant.compareOfficial}>
              {syl[id]?.evaluation ? <Collapsible text={tr(syl[id]!.evaluation)} variant="sub" tone="secondary" threshold={120} lines={3} /> : <T variant="caption" tone="tertiary">{t.assistant.compareNoSyllabus}</T>}
            </Section>
            <Section title={t.assistant.compareReviews}>
              <DigestLine d={d} testID={`assistant-compare-digest-${id}`} />
              {d && d.count ? (
                <T variant="caption" tone="secondary">
                  {[d.aspects.assignment, d.aspects.project, d.aspects.presentation].some((a) => a && a.mentioned + a.denied > 0)
                    ? (['assignment', 'project', 'presentation'] as const).filter((k) => d.aspects[k]?.mentioned || d.aspects[k]?.denied).map((k) => t.digest.aspect(t.digest.aspects[k], d.aspects[k].mentioned, d.aspects[k].denied)).join(' · ')
                    : t.digest.noAspect}
                </T>
              ) : null}
            </Section>
            <Button testID={`assistant-compare-open-${id}`} label={t.assistant.openCourse} variant="text" size="md" onPress={() => router.push({ pathname: '/course', params: { id } })} />
          </View>
        );
      })}
    </View>
  );
}

function ComparePicker({ ctx, onPick }: { ctx: ToolCtx; onPick: (ids: string[]) => void }) {
  const { t } = useI18n();
  const cn = useCourseName();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const list = useMemo(() => {
    const n = q.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
    if (!n) return [];
    const dept = deptCodeOf(ctx.profile.facultyId, ctx.profile.departmentId);
    return coursesForDept(ctx.od.courses, dept).filter((c) => `${c.name}${cn(c.name)}${c.instructor ?? ''}`.normalize('NFKC').toLowerCase().replace(/\s+/g, '').includes(n)).slice(0, 8);
    // cn 은 언어·사전으로만 바뀐다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, ctx.od, ctx.profile]);
  return (
    <View testID="assistant-compare-picker">
      <T variant="sub" tone="secondary">{t.assistant.comparePick}</T>
      <TextField testID="assistant-compare-search" label={t.assistant.compareSearch} value={q} onChangeText={setQ} />
      {list.map((c) => (
        <Chip key={c.id} testID={`assistant-compare-pick-${c.id}`} label={`${cn(c.name)}${c.section ? ` [${c.section}]` : ''}`} selected={sel.includes(c.id)} onPress={() => setSel(sel.includes(c.id) ? sel.filter((x) => x !== c.id) : [...sel, c.id].slice(-3))} />
      ))}
      {q && list.length === 0 ? <EmptyText text={t.official.noResult} /> : null}
      <Button testID="assistant-compare-run" label={t.assistant.compareRun(sel.length)} disabled={sel.length < 2} onPress={() => onPick(sel)} />
    </View>
  );
}

// ------------------------------------------------------------ 계획

function PlanCard({ card, ctx, answer, onUpdate, onStale, onMismatch }: { card: Extract<Card, { type: 'plan' }>; ctx: ToolCtx; answer?: string; onUpdate: (c: PlanConditions) => void; onStale: () => void; onMismatch: () => void }) {
  const { t, locale } = useI18n();
  const cn = useCourseName();
  const label = usePeriodLabel();
  const ttVersion = useTimetableVersion();
  const recVersion = useRecordsVersion();
  const target: AcademicPeriod = useMemo(() => ({ year: card.targetYear, quarter: card.targetQuarter }), [card.targetYear, card.targetQuarter]);
  const [cond, setCond] = useState<PlanConditions>({ ...EMPTY_CONDITIONS, ...card.conditions });
  const [out, setOut] = useState<{ o: PlanOutcome; digests: Record<string, CourseDigest>; rule: PlanInput['rule']; records: PlanInput['records']; picked: PlanInput['picked'] } | null>(null);
  const [preview, setPreview] = useState<Plan | null>(null);
  const [applied, setApplied] = useState<{ recordIds: string[]; added: number } | null>(null);
  const [undone, setUndone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ai, setAi] = useState<{ busy: boolean; text: string | null; err: string | null }>({ busy: false, text: null, err: null });
  const [baseGrid, setBaseGrid] = useState<{ weekday: number; period: number }[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const input = await loadPlanInput(ctx, target);
      const o = planFromConditions(input, cond);
      if (alive) {
        setOut({ o, digests: input.digests, rule: input.rule, records: input.records, picked: input.picked });
        setBaseGrid(input.timetable.filter((e) => entryInPeriod(e, target) !== 'no').map((e) => ({ weekday: e.weekday, period: e.period })));
      }
    })().catch((e) => alive && setErr(String(e)));
    return () => {
      alive = false;
    };
    // ctx 는 대화 시작 때 정해진다. 조건·시간표·기록이 바뀌면 다시 계산한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cond, target, ttVersion, recVersion]);

  // 다시 계산한 결과가 답변 때와 다르면 AI 문장을 오래됨으로 표시하고, 이전 설명을 지운다
  const version = out ? planFingerprint(out.o) : null;
  const [explainedAt, setExplainedAt] = useState<string | null>(null);
  const stale = !!version && version !== card.calcVersion;
  useEffect(() => {
    if (stale && !card.answerStale) onStale();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale]);
  useEffect(() => {
    if (out && answer && !stale && !card.answerMismatch && planAnswerMismatch(answer, out.o)) onMismatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const change = (patch: Partial<PlanConditions>) => {
    const next = { ...cond, ...patch };
    setCond(next);
    onUpdate(next);
    setPreview(null);
    setAi({ busy: false, text: null, err: null });
  };
  const togglePref = (p: Pref) => change({ prefs: cond.prefs.includes(p) ? cond.prefs.filter((x) => x !== p) : [...cond.prefs, p] });

  const apply = async (p: Plan) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await applyPlanInChat(ctx, target, p.courseIds);
      setApplied(r);
      setUndone(false);
      setPreview(null);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    if (!applied || busy) return;
    setBusy(true);
    try {
      if (await undoPlanInChat(ctx.session, applied.recordIds)) {
        setUndone(true);
        setApplied(null);
      }
    } finally {
      setBusy(false);
    }
  };
  const explain = async () => {
    if (!out || ai.busy) return;
    setAi({ busy: true, text: null, err: null });
    try {
      const cand = Object.values(out.o.plans.flatMap((p) => p.courseIds).reduce<Record<string, string>>((a, id) => ({ ...a, [id]: id }), {})).map((id) => {
        const c = out.o.candidates[id];
        const d = out.digests[id];
        return { id, name: cn(c.course.name), facts: [c.requirement, c.fillsCategory, c.credits != null ? `${c.credits}credits` : '', d?.count ? `reviews=${d.count}${d.smallSample ? '(few)' : ''} workload=${d.workload?.avg}` : 'reviews=0'].filter(Boolean).join(', ') };
      });
      const r = await explainPlan(ctx.profile.nickname ?? 'guest', { wish: t.assistant.condText(cond, t), lang: locale, candidates: cand, plans: out.o.plans.map((p) => ({ id: p.id, courseIds: p.courseIds, facts: `days=${p.metrics.days}, gapMin=${p.metrics.gapMinutes}, credits=${p.creditsKnown}` })) });
      setExplainedAt(version);
      setAi({ busy: false, text: [r.wishSummary, ...r.planNotes.map((n) => n.text), ...r.cautions].filter(Boolean).join('\n'), err: null });
    } catch {
      setAi({ busy: false, text: null, err: t.assistant.explainFail });
    }
  };

  return (
    <View testID="assistant-card-plan">
      <T variant="sub" tone="secondary">{t.assistant.planTarget(label(target))}</T>
      <Section title={t.assistant.condTitle} testID="assistant-conditions">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {[0, 1, 2, 3, 4].map((d) => (
            <Chip key={d} testID={`assistant-cond-day-${d}`} label={t.assistant.condDay(t.common.weekdays[d])} selected={cond.excludeWeekdays.includes(d)} onPress={() => change({ excludeWeekdays: cond.excludeWeekdays.includes(d) ? cond.excludeWeekdays.filter((x) => x !== d) : [...cond.excludeWeekdays, d] })} />
          ))}
          <Chip testID="assistant-cond-first" label={t.assistant.condFirst} selected={cond.avoidPeriods.includes(1)} onPress={() => change({ avoidPeriods: cond.avoidPeriods.includes(1) ? cond.avoidPeriods.filter((x) => x !== 1) : [...cond.avoidPeriods, 1] })} />
          <Chip testID="assistant-cond-required" label={t.assistant.condRequired} selected={cond.keepRequired} onPress={() => change({ keepRequired: !cond.keepRequired })} />
          <Chip testID="assistant-cond-need" label={t.assistant.condNeed} selected={cond.needOnly} onPress={() => change({ needOnly: !cond.needOnly })} />
          <Chip testID="assistant-cond-gaps" label={t.assistant.condGaps} selected={cond.minimizeGaps} onPress={() => change({ minimizeGaps: !cond.minimizeGaps })} />
          <Chip testID="assistant-cond-days" label={t.assistant.condFewerDays} selected={cond.fewerDays} onPress={() => change({ fewerDays: !cond.fewerDays })} />
          <Chip testID="assistant-cond-lunch" label={t.assistant.condLunch} selected={cond.lunch} onPress={() => change({ lunch: !cond.lunch })} />
          {PREFS.map((p) => (
            <Chip key={p} testID={`assistant-cond-${p}`} label={t.assistant.prefs[p]} selected={cond.prefs.includes(p)} onPress={() => togglePref(p)} />
          ))}
        </View>
        <TextField
          testID="assistant-cond-credit"
          label={t.assistant.condCredit}
          keyboardType="number-pad"
          value={cond.creditGoal ? String(cond.creditGoal) : ''}
          onChangeText={(v) => {
            const n = Number(v.replace(/\D/g, ''));
            change({ creditGoal: n > 0 && n <= 30 ? n : null });
          }}
        />
      </Section>
      {!out ? <ActivityIndicator color={colors.accent} accessibilityLabel={t.common.loading} /> : (
        <>
          {out.o.conflicts.length ? (
            <View testID="assistant-plan-conflicts">
              <Notice tone="warning" text={t.assistant.conflictTitle(out.o.conflicts.map((c) => `${cn(c.name)} (${t.assistant.conflictReason[c.reason]}${c.with ? `: ${cn(c.with)}` : ''})`).join(', '))} />
            </View>
          ) : null}
          {out.o.relax.length ? (
            <Section title={t.assistant.relaxTitle} testID="assistant-plan-relax">
              {out.o.relax.map((r, i) => (
                <Chip
                  key={i}
                  testID={`assistant-relax-${r.key}${r.day ?? r.period ?? ''}`}
                  label={t.assistant.relax(r.key === 'day' ? t.assistant.condDay(t.common.weekdays[r.day!]) : r.key === 'period' ? t.common.period(r.period!) : t.assistant.relaxKeys[r.key as 'keepRequired' | 'needOnly' | 'lunch'], r.usableAfter)}
                  onPress={() => change(r.key === 'day' ? { excludeWeekdays: cond.excludeWeekdays.filter((x) => x !== r.day) } : r.key === 'period' ? { avoidPeriods: cond.avoidPeriods.filter((x) => x !== r.period) } : { [r.key]: false })}
                />
              ))}
            </Section>
          ) : null}
          {out.o.empty ? <EmptyText text={t.assistant.planEmpty} /> : null}
          {out.o.plans.map((p, i) => (
            <View key={p.id} style={{ marginTop: space.md, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.divider }} testID={`assistant-plan-${i}`}>
              <T variant="body" style={{ fontWeight: '700' }} testID={`assistant-plan-${i}-line`}>{t.assistant.planLine(i + 1, p.courseIds.length, p.creditsKnown, p.metrics.days, p.metrics.gapMinutes)}</T>
              <AltHighlights h={altHighlights(out.o.plans.map((x) => ({ id: x.id, m: { ...x.metrics, gradFilled: gradEffect(out.records, out.picked, x.courseIds.map((id) => out.o.candidates[id]).filter(Boolean), target.year).filled } })))[p.id]} testID={`assistant-plan-${i}-highlights`} />
              <ReviewNotes notes={altReviewNotes(out.o.plans.map((x) => ({ id: x.id, courses: x.courseIds.map((id) => out.o.candidates[id]).filter(Boolean) })), out.digests)[p.id] ?? []} testID={`assistant-plan-${i}-review-notes`} />
              <MiniGrid fixed={baseGrid} added={p.courseIds.flatMap((id) => out.o.candidates[id]?.course.meetings ?? [])} blocked={new Set()} />
              {p.courseIds.map((id) => {
                const c = out.o.candidates[id];
                const d = out.digests[id];
                const ev = prefEvidence(d, cond.prefs);
                return (
                  <View key={id} style={{ paddingVertical: space.xs }} testID={`assistant-plan-${i}-course-${id}`}>
                    <T variant="sub" style={{ fontWeight: '600' }}>{cn(c.course.name)}{c.course.section ? ` [${c.course.section}]` : ''}</T>
                    <T variant="caption" tone="secondary">{t.assistant.planOfficial(t.planner.reasons[c.requirement], c.credits, c.fillsCategory ? categoryLabel(c.fillsCategory, out.rule, t.records.categories, locale) : null, out.o.forcedIds.includes(id))}</T>
                    <DigestLine d={d} testID={`assistant-plan-digest-${id}`} />
                    {cond.prefs.length ? <T variant="caption" tone="tertiary">{cond.prefs.map((x) => `${t.assistant.prefs[x]}: ${ev[x] === 'has' ? t.assistant.prefHas : t.digest.noPref}`).join(' · ')}</T> : null}
                    <Button testID={`assistant-plan-open-${id}`} label={t.assistant.reviewEvidence} variant="text" size="md" onPress={() => router.push({ pathname: '/course', params: { id } })} />
                  </View>
                );
              })}
              {preview?.id === p.id ? (
                <View testID="assistant-plan-preview">
                  <Notice text={t.assistant.planPreview(p.courseIds.length, p.creditsKnown)} />
                  <View style={{ flexDirection: 'row', gap: space.sm }}>
                    <Button testID="assistant-plan-confirm" label={t.assistant.planConfirm} size="md" onPress={() => apply(p)} loading={busy} />
                    <Button testID="assistant-plan-cancel" label={t.common.cancel} size="md" variant="tertiary" onPress={() => setPreview(null)} />
                  </View>
                </View>
              ) : !applied ? (
                <Button testID={`assistant-plan-apply-${i}`} label={t.assistant.planApply} variant="secondary" size="md" onPress={() => setPreview(p)} />
              ) : null}
            </View>
          ))}
          {applied ? (
            <View testID="assistant-plan-applied">
              <Notice text={t.assistant.planApplied(applied.added)} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                <Button testID="assistant-plan-undo" label={t.planner.undo} size="md" variant="tertiary" icon="arrow-undo-outline" onPress={undo} loading={busy} />
                <Button testID="assistant-plan-calendar" label={t.homeTT.openCalendar} size="md" variant="text" onPress={() => router.push('/calendar')} />
              </View>
            </View>
          ) : undone ? <Notice text={t.planner.undone} /> : null}
          {out.o.plans.length ? (
            <View style={{ marginTop: space.sm }}>
              <Button testID="assistant-plan-explain" label={t.assistant.explain} variant="tertiary" size="md" icon="sparkles-outline" onPress={explain} loading={ai.busy} />
              {ai.text && explainedAt === version ? <T variant="sub" testID="assistant-plan-explain-text" style={{ marginTop: space.xs }}>{ai.text}</T> : null}
              {ai.err ? <Notice tone="danger" text={ai.err} /> : null}
            </View>
          ) : null}
        </>
      )}
      {err ? <Notice tone="danger" text={err} /> : null}
    </View>
  );
}

// ------------------------------------------------------------ 장학금

function ScholarshipCard({ ctx }: { ctx: ToolCtx }) {
  const { t } = useI18n();
  const tr = useTr();
  const answers = useScholarshipAnswers(ctx.session);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const now = academicNow();
  const list = ctx.od.scholarships ?? [];
  const view = scholarshipView(list, answers, now.date, now.minutes);
  const openCount = view.filter((v) => v.recruit === 'open').length;
  const askKeys = [...new Set(view.filter((v) => v.recruit !== 'closed').flatMap((v) => v.unknown))];
  const addToChecklist = async (id: string, title: string) => {
    const basis = ctx.today?.period ?? ctx.period;
    if (!basis) return;
    const r = await addChecklistItem(ctx.session, { periodKey: periodKey(basis), kind: 'scholarship', ref: id, title });
    setMsg({ ...msg, [id]: r === 'added' ? t.assistant.added : t.assistant.exists });
  };
  return (
    <View testID="assistant-card-scholarship">
      <T variant="body" style={{ fontWeight: '700' }} testID="assistant-scholarship-line">{openCount ? t.assistant.schOpen(openCount) : t.assistant.schNone}</T>
      <T variant="caption" tone="tertiary">{t.assistant.schScope(list.length)}</T>
      {askKeys.length ? (
        <Section title={t.assistant.schAsk}>
          {askKeys.map((k) => (
            <View key={k} style={{ marginBottom: space.xs }}>
              <T variant="sub">{t.scholarship.q[k]}</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                <Chip testID={`assistant-sch-${k}-yes`} label={t.scholarship.yes} onPress={() => saveScholarshipAnswers(ctx.session, { ...answers, [k]: true })} />
                <Chip testID={`assistant-sch-${k}-no`} label={t.scholarship.no} onPress={() => saveScholarshipAnswers(ctx.session, { ...answers, [k]: false })} />
              </View>
            </View>
          ))}
        </Section>
      ) : null}
      {view.map((v) => {
        const s = list.find((x) => x.id === v.id)!;
        const url = ctx.od.sources[s.source.id]?.url;
        return (
          <View key={v.id} style={{ marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.divider }} testID={`assistant-sch-${v.id}`}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginBottom: space.xs }}>
              <Pill text={t.assistant.recruit[v.recruit]} tone={v.recruit === 'open' ? 'success' : 'neutral'} />
              {v.recruit !== 'closed' ? <Pill text={t.scholarship.verdict[v.verdict]} tone={v.verdict === 'candidate' ? 'accent' : v.verdict === 'not' ? 'danger' : 'warning'} /> : null}
            </View>
            <T variant="sub" style={{ fontWeight: '600' }}>{tr(s.title)}</T>
            <T variant="caption" tone="tertiary">{t.assistant.schDeadline(tr(s.deadlineText))}</T>
            {v.recruit !== 'closed' ? (
              <>
                {v.unmet.length ? <T variant="caption" tone="danger">{t.assistant.schUnmet(v.unmet.map((k) => t.scholarship.q[k]).join(' / '))}</T> : null}
                {v.unknown.length ? <T variant="caption" tone="secondary">{t.assistant.schUnknown(v.unknown.map((k) => t.scholarship.q[k]).join(' / '))}</T> : null}
                {s.documents.length ? <T variant="caption" tone="secondary">{t.assistant.schDocs(s.documents.map((d) => tr(d)).join(', '))}</T> : null}
                <Button testID={`assistant-sch-add-${v.id}`} label={t.assistant.addChecklist} variant="tertiary" size="md" onPress={() => addToChecklist(v.id, s.title)} />
                {msg[v.id] ? <T variant="caption" tone="secondary">{msg[v.id]}</T> : null}
              </>
            ) : null}
            {v.judgedBySchool ? <T variant="caption" tone="tertiary">{t.assistant.schSchool}</T> : null}
            {s.contact ? <T variant="caption" tone="tertiary">{t.assistant.schContact(tr(s.contact))}</T> : null}
            {url ? <Button testID={`assistant-sch-source-${v.id}`} label={t.scholarship.sourceOpen} variant="text" size="md" onPress={() => Linking.openURL(url)} /> : null}
          </View>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------ 공지

function NoticesCard({ card, ctx, onResult }: { card: Extract<Card, { type: 'notices' }>; ctx: ToolCtx; onResult: (c: Card) => void }) {
  const { t } = useI18n();
  const tr = useTr();
  const [q, setQ] = useState(card.query);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sources = noticeSources(ctx.od);
  const n = q.normalize('NFKC').toLowerCase().trim();
  const hits = !n ? sources : sources.filter((x) => `${x.title} ${tr(x.title)} ${x.text}`.normalize('NFKC').toLowerCase().includes(n));
  const run = async (body: string, title: string) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      onResult(await runNoticeAnalysis(ctx, body, title));
    } catch {
      setErr(t.assistant.noticeFail);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View testID="assistant-card-notices">
      <TextField testID="assistant-notice-search" label={t.noticeAi.searchLabel} value={q} onChangeText={setQ} />
      {hits.length === 0 ? <EmptyText text={t.noticeAi.searchNone} /> : null}
      {hits.slice(0, 6).map((x) => (
        <Row key={x.id} testID={`assistant-notice-${x.id}`} title={tr(x.title)} numberOfLines={2} subtitle={tr(x.org)} right={<Button testID={`assistant-notice-run-${x.id}`} label={t.assistant.noticeRun} size="md" variant="tertiary" onPress={() => run(x.text, x.title)} loading={busy} />} />
      ))}
      <TextField testID="assistant-notice-text" label={t.assistant.noticePaste} value={text} onChangeText={setText} multiline style={{ height: 96, paddingTop: space.sm }} textAlignVertical="top" maxLength={20000} />
      <Button testID="assistant-notice-paste-run" label={t.assistant.noticeRunPaste} variant="tertiary" size="md" disabled={!text.trim()} onPress={() => run(text.trim(), t.assistant.pastedNotice)} loading={busy} />
      {err ? <Notice tone="danger" text={err} /> : null}
    </View>
  );
}

function NoticeResultCard({ card, ctx }: { card: Extract<Card, { type: 'noticeResult' }>; ctx: ToolCtx }) {
  const { t, locale } = useI18n();
  const ct = useCt();
  const a: NoticeAnalysis = card.analysis;
  const v = noticeText(a, locale);
  const [msg, setMsg] = useState<string | null>(null);
  const today = academicNow().date;
  const saveable = a.dates.filter((d) => canSaveDate(d) && d.date >= today);
  const basis = ctx.today?.period ?? ctx.period;
  const tasks = [...v.tasks, ...v.materials];
  const saveAll = async (reference: boolean) => {
    const policy = savePolicy(a.audienceStatus, reference);
    if (!policy.allowed) return;
    let added = 0;
    const nowIso = new Date().toISOString();
    for (const d of saveable) if ((await upsertEventBySource(ctx.session, noticeEvent(d, card.key, ct(dateLabel(d, locale)) || t.noticeAi.kinds[d.kind], policy, newEventId(), nowIso))) === 'added') added++;
    let tasksAdded = 0;
    if (basis && !reference) for (const title of tasks) if ((await addChecklistItem(ctx.session, { periodKey: periodKey(basis), kind: 'manual', ref: null, title: ct(title) })) === 'added') tasksAdded++;
    setMsg(t.assistant.noticeSaved(added, tasksAdded));
  };
  return (
    <View testID="assistant-card-notice-result">
      <T variant="sub" style={{ fontWeight: '700' }}>{ct(card.title)}</T>
      <Pill text={t.noticeAi.audienceStatus[a.audienceStatus]} tone={a.audienceStatus === 'target' ? 'success' : a.audienceStatus === 'excluded' ? 'danger' : 'warning'} />
      <ContentText text={v.summary} variant="sub" />
      {v.audienceReason ? <T variant="caption" tone="secondary">{ct(v.audienceReason)}</T> : null}
      {tasks.length ? <Section title={t.noticeAi.taskTitle}>{tasks.map((x, i) => <T key={i} variant="sub">• {ct(x)}</T>)}</Section> : null}
      {a.dates.length ? <Section title={t.noticeAi.dates}>{a.dates.map((d, i) => <T key={i} variant="sub" testID={`assistant-notice-date-${i}`}>{t.noticeAi.kinds[d.kind]}: {d.date || d.rawText} {dateClock(d)} — {ct(dateLabel(d, locale))}</T>)}</Section> : null}
      {v.uncertain.length ? <Notice tone="warning" text={`${t.noticeAi.uncertain}: ${v.uncertain.map(ct).join(' / ')}`} /> : null}
      {a.audienceStatus === 'excluded' ? (
        <>
          <Notice tone="warning" text={t.noticeAi.excludedNote} />
          <Button testID="assistant-notice-reference" label={t.noticeAi.saveReference(saveable.length)} variant="tertiary" size="md" disabled={!saveable.length} onPress={() => saveAll(true)} />
        </>
      ) : (
        <Button testID="assistant-notice-save" label={t.assistant.noticeSaveAll(saveable.length, tasks.length)} variant="secondary" size="md" disabled={!saveable.length && !tasks.length} onPress={() => saveAll(false)} />
      )}
      {msg ? <Notice text={msg} /> : null}
    </View>
  );
}

function AgendaCard({ ctx }: { ctx: ToolCtx }) {
  const { t } = useI18n();
  const ct = useCt();
  const { events } = useEvents(ctx.session);
  const { items } = useChecklist(ctx.session);
  const today = academicNow().date;
  const ev = (events ?? []).filter((e) => e.date >= today && !e.done && !e.reference).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  const open = items.filter((i) => i.status === 'todo' || i.status === 'doing').slice(0, 6);
  return (
    <View testID="assistant-card-agenda">
      {ev.length === 0 && open.length === 0 ? <EmptyText text={t.assistant.agendaEmpty} /> : null}
      {ev.map((e) => <Row key={e.id} title={ct(e.title)} subtitle={`${e.date}${e.time ? ` ${e.time}` : ''}`} chevron onPress={() => router.push({ pathname: '/event-edit', params: { id: e.id } })} />)}
      {open.map((i) => <Row key={i.id} title={ct(i.title)} subtitle={t.checklist.statuses[i.status]} chevron onPress={() => router.push('/checklist')} />)}
    </View>
  );
}

function TimetableCard({ card, ctx }: { card: Extract<Card, { type: 'timetable' }>; ctx: ToolCtx }) {
  const { t } = useI18n();
  const cn = useCourseName();
  const version = useTimetableVersion();
  const [list, setList] = useState<{ id: string; weekday: number; period: number; courseName: string }[]>([]);
  useEffect(() => {
    let alive = true;
    loadEditableTimetable(ctx.session, ctx.t).then((r) => alive && setList(r.entries.filter((e) => entryInPeriod(e, { year: card.year, quarter: card.quarter }) !== 'no')));
    return () => {
      alive = false;
    };
  }, [ctx, card.year, card.quarter, version]);
  return (
    <View testID="assistant-card-timetable">
      <MiniGrid fixed={list} added={[]} blocked={new Set()} />
      {list.slice(0, 12).map((e) => <T key={e.id} variant="caption" tone="secondary">{t.common.weekdays[e.weekday]}{t.common.period(e.period)} {cn(e.courseName)}</T>)}
      {list.length === 0 ? <EmptyText text={t.homeTT.noTimetable} /> : null}
      <Button testID="assistant-open-calendar" label={t.homeTT.openCalendar} variant="text" size="md" onPress={() => router.push('/calendar')} />
    </View>
  );
}

function ConfirmChecklist({ card, ctx, onDone }: { card: Extract<Card, { type: 'confirmChecklist' }>; ctx: ToolCtx; onDone: () => void }) {
  const { t } = useI18n();
  const [msg, setMsg] = useState<string | null>(card.done ? t.assistant.added : null);
  const basis = ctx.today?.period ?? ctx.period;
  return (
    <View testID="assistant-card-confirm-checklist">
      <Notice text={t.assistant.confirmChecklist(card.title)} />
      {msg ? <T variant="sub" tone="secondary" testID="assistant-confirm-msg">{msg}</T> : (
        <Button testID="assistant-confirm-checklist" label={t.common.ok} size="md" disabled={!basis} onPress={async () => {
          if (!basis) return;
          const r = await addChecklistItem(ctx.session, { periodKey: periodKey(basis), kind: 'manual', ref: null, title: card.title });
          setMsg(r === 'added' ? t.assistant.added : t.assistant.exists);
          onDone();
        }} />
      )}
    </View>
  );
}

function ConfirmEvent({ card, ctx, onDone }: { card: Extract<Card, { type: 'confirmEvent' }>; ctx: ToolCtx; onDone: () => void }) {
  const { t } = useI18n();
  const [saved, setSaved] = useState(!!card.done);
  return (
    <View testID="assistant-card-confirm-event">
      <Notice text={t.assistant.confirmEvent(card.title, card.date, card.time)} />
      {saved ? <T variant="sub" tone="secondary" testID="assistant-confirm-msg">{t.assistant.added}</T> : (
        <Button testID="assistant-confirm-event" label={t.common.ok} size="md" onPress={async () => {
          const nowIso = new Date().toISOString();
          await upsertEvent(ctx.session, { id: newEventId(), title: card.title, kind: 'personal', date: card.date, time: card.time || null, course: null, memo: '', notify: false, done: false, createdAt: nowIso, updatedAt: nowIso });
          setSaved(true);
          onDone();
        }} />
      )}
    </View>
  );
}

const SCREEN_PATH: Record<string, string> = { campus: '/campus', 'plan-builder': '/plan-builder', graduation: '/graduation', records: '/records', planner: '/planner', calendar: '/calendar', checklist: '/checklist', scholarship: '/scholarship', notice: '/notice', search: '/search', 'timetable-import': '/timetable-import', department: '/department', career: '/career' };

export function AssistantCard({ card, ctx, answer, onReplace }: { card: Card; ctx: ToolCtx; answer?: string; onReplace: (next: Card) => void }) {
  const { t } = useI18n();
  const digests = useDigests(card.type === 'courses' ? card.ids : []);
  switch (card.type) {
    case 'grad':
      return <GradCard card={card} ctx={ctx} />;
    case 'courses':
      return (
        <View testID="assistant-card-courses">
          <T variant="caption" tone="tertiary">{t.assistant.coursesCount(card.total, card.ids.length)}</T>
          {card.ids.length === 0 ? <EmptyText text={t.official.noResult} /> : card.ids.map((id) => <CourseRow key={id} id={id} od={ctx.od} d={digests[id]} />)}
        </View>
      );
    case 'compare':
      return <CompareCard ids={card.ids} ctx={ctx} />;
    case 'comparePicker':
      return <ComparePicker ctx={ctx} onPick={(ids) => onReplace({ type: 'compare', ids })} />;
    case 'plan':
      return <PlanCard card={card} ctx={ctx} answer={answer} onUpdate={(c) => onReplace({ ...card, conditions: c })} onStale={() => onReplace({ ...card, answerStale: true })} onMismatch={() => onReplace({ ...card, answerMismatch: true })} />;
    case 'scholarships':
      return <ScholarshipCard ctx={ctx} />;
    case 'notices':
      return <NoticesCard card={card} ctx={ctx} onResult={onReplace} />;
    case 'noticeResult':
      return <NoticeResultCard card={card} ctx={ctx} />;
    case 'agenda':
      return <AgendaCard ctx={ctx} />;
    case 'timetable':
      return <TimetableCard card={card} ctx={ctx} />;
    case 'confirmChecklist':
      return <ConfirmChecklist card={card} ctx={ctx} onDone={() => onReplace({ ...card, done: true })} />;
    case 'confirmEvent':
      return <ConfirmEvent card={card} ctx={ctx} onDone={() => onReplace({ ...card, done: true })} />;
    case 'place':
      return (
        <View testID="assistant-card-place">
          {card.hits.length === 0 ? <EmptyText text={t.campus.noResult} /> : card.hits.map((h) => (
            <View key={h.id} style={{ paddingVertical: space.xs }}>
              <T variant="body" style={{ fontWeight: '700' }} testID={`assistant-place-${h.id}`}>{ctx.locale === 'ja' ? h.ja : h.ko}{h.room ? ` · ${t.campus.roomLine(h.room.wing, h.room.floor, h.room.number)}` : ''}</T>
              {h.room ? <Pill text={t.campus.basis[h.room.basis]} tone={h.room.basis === 'inferred' ? 'warning' : 'neutral'} /> : null}
              {h.facilities.slice(0, 4).map((f) => <T key={f.ko} variant="caption" tone="secondary">• {ctx.locale === 'ja' ? f.ja : f.ko}</T>)}
              <Button testID={`assistant-place-open-${h.id}`} label={t.campus.open} variant="text" size="md" icon="map-outline" onPress={() => router.push({ pathname: '/campus', params: h.room ? { room: h.room.raw } : { building: h.id } })} />
            </View>
          ))}
        </View>
      );
    case 'open':
      return SCREEN_PATH[card.screen] ? <Button testID={`assistant-open-${card.screen}`} label={t.assistant.openScreen(t.assistant.screens[card.screen as keyof typeof t.assistant.screens] ?? card.screen)} variant="tertiary" size="md" icon="open-outline" onPress={() => router.push(SCREEN_PATH[card.screen] as never)} /> : null;
    default:
      return null;
  }
}

export { conditionsFromCall, runTool };
