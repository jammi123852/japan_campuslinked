import { router } from 'expo-router';
import { useTr } from '@/lib/translate';
import { useCourseName } from '@/data/useCourseName';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Block, BlockHeader, Button, Chip, EmptyText, Gap, Notice, Pill, Row, Screen, T, TextField } from '@/components/ui';
import type { TimetableEntry } from '@/data/types';
import { entriesForPeriod, entryInPeriod, officialToEntries, type AcademicPeriod } from '@/features/academic/academicLogic';
import { shiftQuarter, usePeriodLabel } from '@/features/academic/PeriodBar';
import { categoryLabel, coursesForDept, deptCodeOf, ruleLabel, TRACKS } from '@/features/official/courseLogic';
import { deptKeyOf } from '@/features/official/SourceLine';
import { useOfficial } from '@/features/official/useOfficial';
import { AltHighlights } from '@/features/planner/AltHighlights';
import { altHighlights, altReviewNotes, gradEffect, type Highlights, type ReviewNote } from '@/features/planner/builderLogic';
import { ReviewNotes } from '@/features/planner/ReviewNotes';
import { MiniGrid } from '@/features/planner/MiniGrid';
import { Sandbox, withPick } from '@/features/planner/Sandbox';
import { applyPicks, buildCandidates, generatePlans, PRIORITIES, UNCOMPUTABLE, type Candidate, type Plan, type Priority } from '@/features/planner/plannerLogic';
import { computeProgress, countedRecords, pickRule, type CourseRecord } from '@/features/records/gradLogic';
import { useI18n } from '@/i18n';
import { ApiError, explainPlan, fetchDigests, pickPlan, type CourseDigest, type PlanExplanation, type PlanPick } from '@/lib/api';
import { prefScore, PREFS as REVIEW_PREFS, type Pref } from '@/features/assistant/assistantLogic';
import { confirmDestructive } from '@/lib/confirm';
import { apiErrorText } from '@/features/community/usePosts';
import { usePeriod } from '@/services/periodRepository';
import { clearTimetableBackup, DEFAULT_PLANNER, savePlannerSettings, saveTimetableBackup, usePlannerSettings, useTimetableBackup, type PlannerSettings } from '@/services/plannerRepository';
import { newRecordId, upsertRecords, useRecords } from '@/services/recordsRepository';
import { loadEditableTimetable, newEntryId, saveTimetable, useTimetableVersion } from '@/services/timetableRepository';
import { useApp } from '@/state/AppContext';
import { colors, gutter, radius, space } from '@/theme/tokens';

const LUNCH_OPTIONS = [null, { start: '12:40', end: '13:40' }, { start: '12:00', end: '13:00' }, { start: '11:30', end: '12:30' }] as const;

function ReasonRow({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'warning' | 'success' | 'neutral' }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, paddingVertical: 2 }}>
      <T variant="caption" tone="tertiary" style={{ width: 84 }}>
        {label}
      </T>
      <T variant="caption" tone={tone === 'danger' ? 'danger' : tone === 'success' ? 'accent' : 'secondary'} style={{ flex: 1 }}>
        {value}
      </T>
    </View>
  );
}

/** 통합 수강 계획: 이수 상태 → 부족 요건 → 후보(근거 분리) → 시간표 대안 비교 → 예상 변화 → 적용/되돌리기. 주소: /planner */
export default function PlannerScreen() {
  const { session, profile } = useApp();
  const { t, locale } = useI18n();
  const cn = useCourseName();
  const tr = useTr();
  const official = useOfficial();
  const od = official.kind === 'ok' ? official.data : null;
  const per = usePeriod(session, od);
  const label = usePeriodLabel();
  const saved = usePlannerSettings(session);
  const backup = useTimetableBackup(session);
  const { records } = useRecords(session);
  const ttVersion = useTimetableVersion();
  const [timetable, setTimetable] = useState<TimetableEntry[]>([]);
  const [settings, setSettings] = useState<PlannerSettings>(DEFAULT_PLANNER);
  const [target, setTarget] = useState<AcademicPeriod | null>(null);
  /** '대안에 꼭 넣기'로 고른 과목 */
  /** '조건에 맞는 후보 찾기'를 누른 뒤: 겹침·막은 시간·밥 시간 겹침 후보를 뺀다 */
  const [searched, setSearched] = useState(false);
  /** 부족 요건을 채울 수 있는 과목만 */
  const [onlyNeed, setOnlyNeed] = useState(false);
  const [plans, setPlans] = useState<{ plans: Plan[]; usable: number } | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const [candQuery, setCandQuery] = useState('');
  const [candTrack, setCandTrack] = useState<string | null>('major');
  const [candLimit, setCandLimit] = useState(20);
  const [msg, setMsg] = useState<string | null>(null);
  /** 가상 시간표에 넣은 과목 id (계획 기간마다 따로) */
  const [sandbox, setSandbox] = useState<Record<string, string[]>>({});
  const [digests, setDigests] = useState<Record<string, CourseDigest>>({});
  const [reviewPrefs, setReviewPrefs] = useState<Pref[]>([]);
  const [wish, setWish] = useState('');
  /** AI 과목 추천: 요청 → AI 가 후보 중에서 고름 → 앱이 규칙을 다시 확인 */
  const [pickAsk, setPickAsk] = useState('');
  const [pick, setPick] = useState<{ busy: boolean; data: PlanPick | null; err: string | null }>({ busy: false, data: null, err: null });
  const [pickMsg, setPickMsg] = useState<string | null>(null);
  const [ai, setAi] = useState<{ busy: boolean; data: PlanExplanation | null; err: string | null }>({ busy: false, data: null, err: null });

  // 저장된 값이 바뀌면 화면 값도 맞춘다 (effect 대신 렌더 중 조정)
  const [syncedSaved, setSyncedSaved] = useState(saved);
  if (saved !== syncedSaved) {
    setSyncedSaved(saved);
    setSettings(saved);
  }
  useEffect(() => {
    if (!session) return;
    loadEditableTimetable(session, t).then((r) => setTimetable(r.entries));
  }, [session, t, ttVersion]);
  // 기본 계획 기간: 오늘 쿼터의 다음 쿼터 (학년력이 없으면 보고 있는 기간)
  const defaultTarget = per.today ? shiftQuarter(per.today.period, 1) : per.period;
  const tgt = target ?? defaultTarget;

  const update = (patch: Partial<PlannerSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    setPlans(null);
    if (session) savePlannerSettings(session, next);
  };

  const deptCode = deptCodeOf(profile?.facultyId, profile?.departmentId);
  const deptKey = deptKeyOf(profile?.facultyId, profile?.departmentId);
  const rulePicked = useMemo(() => pickRule(od && deptKey ? od.departments[deptKey]?.rules : undefined, profile?.admissionYear, profile?.courseName), [od, deptKey, profile?.admissionYear, profile?.courseName]);
  const blocked = useMemo(() => new Set(settings.blocked), [settings.blocked]);
  const candidates: Candidate[] = useMemo(() => {
    if (!od || !tgt) return [];
    const deptCourses = coursesForDept(od.courses, deptCode);
    return buildCandidates({
      courses: deptCourses,
      dept: deptCode,
      rule: rulePicked?.rule ?? null,
      dataYear: od.calendar.year,
      target: tgt,
      records,
      timetable,
      admissionYear: profile?.admissionYear ?? null,
      grade: profile?.currentGrade ?? null,
      blocked,
      lunch: settings.lunch,
      periodTimes: od.periods.items,
      interests: settings.interests.split(/[,、，]/),
    });
  }, [od, tgt, records, timetable, profile, blocked, settings.lunch, settings.interests, deptCode, rulePicked?.rule]);
  const candKey = candidates.map((c) => c.course.id).join(',');
  useEffect(() => {
    let alive = true;
    fetchDigests(candKey ? candKey.split(',') : []).then((d) => alive && setDigests(d)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [candKey]);
  const active = candidates.filter((c) => !c.excluded);
  const excluded = candidates.filter((c) => c.excluded);
  const q = candQuery.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  const matchCand = (c: Candidate) => (!candTrack || c.course.track === candTrack) && (!q || `${c.course.name}${c.course.instructor ?? ''}${c.course.code ?? ''}`.normalize('NFKC').toLowerCase().replace(/\s+/g, '').includes(q));
  // 필수 표시 → 부족 영역을 채울 수 있는 것 → 관심 순. 묶음을 직접 고르지 않았으면 지금 필터에 보이는 후보로 비교한다
  const rank = (c: Candidate) => (c.requirement === 'required' || c.requirement === 'required_tech' || c.requirement === 'required_math' ? 0 : c.requirement === 'selective' ? 1 : 2) - (c.interestHits.length ? 1 : 0);
  // 아직 부족한 영역 (수강 중 포함 기준). '더 채우기' 묶음이 부족하면 그 묶음에 드는 영역도 포함
  const needSet = (() => {
    const g = computeProgress(records, rulePicked, 'current');
    const set = new Set(g.categories.filter((c) => c.short > 0).map((c) => c.id as string));
    const rule = rulePicked?.rule as { flex?: { from: string[] }; pools?: { id: string; from: string[] }[] } | undefined;
    if (g.flex && g.flex.short > 0) rule?.flex?.from.forEach((x) => set.add(x));
    g.pools.filter((p) => p.short > 0).forEach((p) => rule?.pools?.find((x) => x.id === p.id)?.from.forEach((x) => set.add(x)));
    return set;
  })();
  const condOk = (c: Candidate) => !c.blocked && c.conflicts.length === 0 && !(settings.lunch && c.lunchHit);
  const fixed = tgt ? entriesForPeriod(timetable, tgt).filter((e) => entryInPeriod(e, tgt) === 'yes') : [];
  const fixedDays = new Set(fixed.map((e) => e.weekday));
  const needOf = (c: Candidate) => (!!c.fillsCategory && needSet.has(c.fillsCategory) ? 1 : 0);
  // 조건으로 찾기를 누르면 고른 우선순위 순서대로 정렬한다 (앞 순위가 같을 때만 다음 순위를 본다)
  const prioScore = (c: Candidate, p: Priority) =>
    p === 'requirement' ? needOf(c) * 2 + (c.requirement !== 'unmarked' ? 1 : 0)
      : p === 'interest' ? c.interestHits.length
      : p === 'fewerDays' ? -new Set(c.course.meetings.map((m) => m.weekday).filter((d) => !fixedDays.has(d))).size
      : p === 'fewerGaps' ? c.course.meetings.filter((m) => fixed.some((e) => e.weekday === m.weekday && Math.abs(e.period - m.period) === 1)).length
      : p === 'lunch' ? (c.lunchHit ? -1 : 0)
      : 0;
  const byPriorities = (a: Candidate, b: Candidate) => {
    for (const p of settings.priorities) {
      const d = prioScore(b, p) - prioScore(a, p);
      if (d) return d;
    }
    return 0;
  };
  const matched = active.filter((c) => matchCand(c) && (!onlyNeed || needOf(c) === 1));
  const removed = searched ? { conflict: matched.filter((c) => c.conflicts.length > 0).length, blocked: matched.filter((c) => c.blocked).length, lunch: matched.filter((c) => !!settings.lunch && c.lunchHit).length } : null;
  const shown = matched.filter((c) => !searched || condOk(c)).sort((a, b) => (searched ? byPriorities(a, b) : 0) || rank(a) - rank(b) || (a.course.year || 9) - (b.course.year || 9) || a.course.name.localeCompare(b.course.name));
  /** 추천: 조건으로 찾았을 때 위에서부터 추가할 과목 수만큼 */
  const recommended = new Set(searched ? shown.slice(0, settings.count).map((c) => c.course.id) : []);
  // 가상 시간표에 넣은 과목 = 모든 대안에 꼭 들어가는 과목 (계획 기간마다 따로)
  const sbKey = tgt ? `${tgt.year}-${tgt.quarter}` : '';
  const picks = sandbox[sbKey] ?? [];
  const setPicks = (ids: string[]) => setSandbox((s) => ({ ...s, [sbKey]: ids }));
  const inPool = (c: Candidate) => picks.includes(c.course.id);

  if (official.kind === 'loading') return <ActivityIndicator color={colors.accent} style={{ marginTop: space.huge }} />;

  const picked = rulePicked;
  const now = computeProgress(records, picked, 'current');

  const make = () => {
    if (!od || !tgt) return;
    // 지금 목록에 보이는 후보로 채우고, '꼭 넣기'로 고른 과목은 모든 대안에 먼저 넣는다
    setPlans(generatePlans(shown, fixed, settings.count, settings.priorities, od.periods.items, settings.lunch, active.filter(inPool), settings.creditGoal ?? null, reviewPrefs.length ? (c) => prefScore(c, reviewPrefs, digests) : null));
    setAi({ busy: false, data: null, err: null });
  };

  const byId = (id: string) => candidates.find((c) => c.course.id === id)!;
  const hypothetical = (p: Pick<Plan, 'courseIds'>): CourseRecord[] =>
    p.courseIds.map((id) => {
      const c = byId(id);
      return {
        id: `hypo-${id}`,
        year: tgt?.year ?? null,
        quarters: [...c.course.quarters],
        name: c.course.name,
        code: c.course.code ?? c.course.syllabus?.code ?? null,
        section: c.course.section,
        credits: c.credits,
        category: c.fillsCategory ?? 'unknown',
        suggestedCategory: c.fillsCategory,
        status: 'planned',
        confirmedAt: null,
        officialId: id,
        note: '',
        createdAt: '',
        updatedAt: '',
      };
    });

  const apply = (p: Pick<Plan, 'courseIds'>, after?: () => void) =>
    confirmDestructive(t.planner.applyConfirmTitle, t.planner.applyConfirmBody, { ok: t.common.ok, cancel: t.common.cancel }, async () => {
      if (!session || !od || !tgt) return;
      const { entries } = await loadEditableTimetable(session, t);
      await saveTimetableBackup(session, entries);
      const adds = p.courseIds.flatMap((id) => officialToEntries(byId(id).course, tgt.year, od.periods.items, newEntryId));
      await saveTimetable(session, [...entries, ...adds]);
      const nowIso = new Date().toISOString();
      const existingIds = new Set(records.map((r) => r.officialId));
      await upsertRecords(
        session,
        hypothetical(p).map((r) => ({ ...r, category: 'unknown' as const }))
          .filter((r) => !existingIds.has(r.officialId))
          .map((r) => ({ ...r, id: newRecordId(), createdAt: nowIso, updatedAt: nowIso })),
      );
      setMsg(t.planner.applied);
      after?.();
    });

  const undo = () =>
    confirmDestructive(t.planner.undo, t.planner.undoConfirmBody, { ok: t.common.ok, cancel: t.common.cancel }, async () => {
      if (!session || !backup) return;
      await saveTimetable(session, backup.entries);
      await clearTimetableBackup(session);
      setMsg(t.planner.undone);
    });

  const factsOf = (c: Candidate) =>
    [
      t.planner.reasons[c.requirement],
      c.gradeFit === 'higher_year' ? t.planner.reasons.gradeHigher : '',
      c.offered === 'confirmed' ? t.planner.reasons.offeredConfirmed : t.planner.reasons.offeredNot,
      c.credits != null ? `${c.credits}${t.official.credits}` : t.planner.reasons.creditsUnknown,
      c.interestHits.length ? t.planner.reasons.interestHit(c.interestHits.join(',')) : '',
      c.lunchHit ? t.planner.reasons.lunchHit : '',
      c.course.meetings.map((m) => t.lectures.meeting(t.common.weekdays[m.weekday], m.period)).join(','),
    ]
      .filter(Boolean)
      .join(' / ');

  // AI 가 고른 순서대로, 앱 규칙(겹침·점심·교양 수·목표 학점·부족 요건)으로 다시 확인한 결과
  const pickResult = (() => {
    if (!pick.data || !od) return null;
    const byIdAll = new Map(active.map((c) => [c.course.id, c]));
    const order = pick.data.picks.map((p) => byIdAll.get(p.id)).filter((c): c is Candidate => !!c);
    const k = pick.data.constraints;
    const goal = k.creditGoal ?? settings.creditGoal ?? null;
    const lunch = k.lunch ?? settings.lunch;
    const r = applyPicks(order, fixed, od.periods.items, { lunch, creditGoal: goal, kisoMax: k.kisoMax, needOnly: k.onlyNeed ? (c) => needOf(c) === 1 : null });
    return { ...r, goal, kisoMax: k.kisoMax, lunch };
  })();
  const askPick = async () => {
    if (!od || !tgt || pick.busy) return;
    setPick({ busy: true, data: null, err: null });
    setPickMsg(null);
    try {
      // 전공만 잔뜩 보내지 않도록 구분별로 나눠 보낸다 (교양·외국어도 고를 수 있게)
      const sorted = [...active].sort((a, b) => needOf(b) - needOf(a) || rank(a) - rank(b));
      const caps: Record<string, number> = { major: 70, kiso: 50, foreign: 20 };
      const used: Record<string, number> = {};
      const pool = sorted.filter((c) => {
        const k = c.course.track && caps[c.course.track] ? c.course.track : 'other';
        used[k] = (used[k] ?? 0) + 1;
        return used[k] <= (caps[k] ?? 10);
      });
      const fact = (c: Candidate) =>
        [
          cn(c.course.name),
          c.course.section ? `분반 ${c.course.section}` : '',
          `track=${c.course.track ?? '-'}`,
          c.course.meetings.map((m) => `${t.common.weekdays[m.weekday]}${m.period}`).join(','),
          c.credits != null ? `${c.credits}학점` : '학점 미확인',
          needOf(c) ? '부족 요건' : '',
          c.requirement !== 'unmarked' ? t.planner.reasons[c.requirement] : '',
          c.conflicts.length ? '지금 시간표와 겹침' : '',
          c.blocked ? '비워 둔 시간' : '',
        ]
          .filter(Boolean)
          .join(' | ');
      const g = computeProgress(records, rulePicked, 'current');
      const context = `${label(tgt)} 계획 · ${profile?.currentGrade ?? '?'}학년 · 부족: ${g.categories.filter((c) => c.short > 0).map((c) => `${categoryLabel(c.id, rulePicked?.rule, t.records.categories, locale)} ${c.short}학점`).join(', ') || '없음'}${g.flex && g.flex.short > 0 ? `, 추가 취득 ${g.flex.short}학점` : ''} · 지금 시간표: ${fixed.map((e) => `${t.common.weekdays[e.weekday]}${e.period}`).join(',') || '없음'}`;
      const data = await pickPlan(profile?.nickname ?? 'guest', { wish: pickAsk.trim(), lang: locale, context, candidates: pool.map((c) => ({ id: c.course.id, facts: fact(c) })) });
      setPick({ busy: false, data, err: null });
    } catch (e) {
      setPick({ busy: false, data: null, err: e instanceof ApiError && e.code === 'ai_daily_limit' ? t.timetable.aiErrLimit : apiErrorText(t, e) });
    }
  };

  // 대안 장단점: 앱 계산값 비교 (직접 시간표 짜기와 같은 기준)
  const planHighlights = altHighlights(
    (plans?.plans ?? []).map((p) => ({ id: p.id, m: { ...p.metrics, gradFilled: gradEffect(records, rulePicked, p.courseIds.map(byId), tgt?.year ?? 0).filled } })),
  ) as Record<string, Highlights>;

  const planNotes = altReviewNotes((plans?.plans ?? []).map((p) => ({ id: p.id, courses: p.courseIds.map(byId) })), digests) as Record<string, ReviewNote[]>;

  const askAi = async () => {
    if (!plans?.plans.length) return;
    setAi({ busy: true, data: null, err: null });
    try {
      const ids = new Set(plans.plans.flatMap((p) => p.courseIds));
      const data = await explainPlan(profile?.nickname ?? 'guest', {
        wish,
        lang: locale,
        candidates: [...ids].map((id) => ({ id, name: byId(id).course.name, facts: factsOf(byId(id)) })),
        plans: plans.plans.map((p) => ({
          id: p.id,
          courseIds: p.courseIds,
          facts: `days=${p.metrics.days}, gapMin=${p.metrics.gapMinutes}, maxConsecutive=${p.metrics.maxConsecutive}, lunchOkDays=${p.metrics.lunchOkDays}, creditsKnown=${p.creditsKnown}, creditsUnknownCourses=${p.creditsUnknown}, requiredMarked=${p.requiredCount}`,
        })),
      });
      setAi({ busy: false, data, err: null });
    } catch (e) {
      setAi({ busy: false, data: null, err: e instanceof ApiError && e.code === 'ai_daily_limit' ? t.timetable.aiErrLimit : apiErrorText(t, e) });
    }
  };

  const nextTargets = per.today ? [per.today.period, shiftQuarter(per.today.period, 1), shiftQuarter(per.today.period, 2), shiftQuarter(per.today.period, 3)] : per.period ? [per.period, shiftQuarter(per.period, 1)] : [];

  return (
    <Screen edges={['bottom']}>
      <Notice text={t.planner.lead} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -gutter, marginBottom: space.md }} contentContainerStyle={{ paddingHorizontal: gutter, gap: space.xs }}>
        {t.planner.flow.map((s, i) => (
          <Pill key={s} text={`${i + 1}. ${s}`} tone={i < 5 ? 'accent' : 'neutral'} />
        ))}
      </ScrollView>
      {official.kind !== 'ok' ? <Notice tone="warning" text={t.official.missing} /> : null}

      <Block>
        <BlockHeader title={t.planner.target} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {nextTargets.map((p) => (
            <Chip key={`${p.year}-${p.quarter}`} testID={`plan-target-${p.year}-${p.quarter}`} label={label(p)} selected={!!tgt && tgt.year === p.year && tgt.quarter === p.quarter} onPress={() => (setTarget(p), setPlans(null))} />
          ))}
        </View>
        {tgt && od ? <Notice tone={tgt.year === od.calendar.year ? 'info' : 'warning'} text={tgt.year === od.calendar.year ? t.planner.targetNote2026 : t.planner.targetNotConfirmed} /> : <EmptyText text={t.period.unset} />}
      </Block>
      <Gap />

      <Block>
        <BlockHeader title={t.planner.need} />
        {now.noRule ? (
          <EmptyText text={t.planner.needNone} />
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {now.categories.map((c) => (
              <Pill key={c.id} text={`${categoryLabel(c.id, picked?.rule, t.records.categories, locale)} ${c.short > 0 ? t.grad.short(c.short) : t.grad.ok}`} tone={c.short > 0 ? 'danger' : 'success'} />
            ))}
            {now.pools.map((p) => (
              <Pill key={p.id} text={`${ruleLabel(p.label, locale)} ${p.short > 0 ? t.grad.short(p.short) : t.grad.ok}`} tone={p.short > 0 ? 'danger' : 'success'} />
            ))}
            {now.flex ? <Pill text={`${t.grad.flex.split(' (')[0]} ${now.flex.short > 0 ? t.grad.short(now.flex.short) : t.grad.ok}`} tone={now.flex.short > 0 ? 'danger' : 'success'} /> : null}
          </View>
        )}
        <Button label={t.grad.open} variant="text" size="md" onPress={() => router.push('/graduation')} />
      </Block>
      <Gap />

      <Block>
        <T variant="sub" tone="secondary" style={styles.label}>
          {t.planner.priorities}
        </T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {PRIORITIES.map((p: Priority) => {
            const idx = settings.priorities.indexOf(p);
            return (
              <Chip
                key={p}
                testID={`plan-prio-${p}`}
                label={`${idx >= 0 ? `${idx + 1}. ` : ''}${t.planner.prio[p]}${UNCOMPUTABLE.includes(p) ? ` (${t.planner.noData})` : ''}`}
                selected={idx >= 0}
                onPress={() => update({ priorities: idx >= 0 ? settings.priorities.filter((x) => x !== p) : [...settings.priorities, p] })}
              />
            );
          })}
        </View>
        <T variant="sub" style={{ fontWeight: '600', marginTop: space.sm }}>{t.digest.prefTitle}</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {REVIEW_PREFS.map((p) => (
            <Chip key={p} testID={`plan-pref-${p}`} label={t.assistant.prefs[p]} selected={reviewPrefs.includes(p)} onPress={() => { setReviewPrefs(reviewPrefs.includes(p) ? reviewPrefs.filter((x) => x !== p) : [...reviewPrefs, p]); setPlans(null); }} />
          ))}
        </View>
        <T variant="caption" tone="tertiary" style={{ marginBottom: space.sm }}>{t.digest.prefNote}</T>
        <TextField testID="plan-interests" label={t.planner.interests} value={settings.interests} onChangeText={(v) => update({ interests: v })} placeholder={t.planner.interestsPh} />
        <T variant="sub" tone="secondary" style={styles.label}>
          {t.planner.lunch}
        </T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {LUNCH_OPTIONS.map((l, i) => (
            <Chip
              key={i}
              testID={`plan-lunch-${i}`}
              label={!l ? t.planner.lunchNone : i === 1 ? t.planner.lunchOfficial : `${l.start}–${l.end}`}
              selected={(!l && !settings.lunch) || (!!l && settings.lunch?.start === l.start && settings.lunch?.end === l.end)}
              onPress={() => update({ lunch: l ? { ...l } : null })}
            />
          ))}
        </View>
        <T variant="sub" tone="secondary" style={styles.label}>
          {t.planner.blocked}
        </T>
        <View>
          {[1, 2, 3, 4, 5].map((p) => (
            <View key={p} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <T variant="caption" tone="tertiary" style={{ width: 20 }}>
                {p}
              </T>
              {[0, 1, 2, 3, 4].map((d) => {
                const k = `${d}-${p}`;
                const on = blocked.has(k);
                return (
                  <Pressable
                    key={k}
                    testID={`plan-block-${k}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${t.common.weekdays[d]} ${t.common.period(p)}`}
                    onPress={() => update({ blocked: on ? settings.blocked.filter((x) => x !== k) : [...settings.blocked, k] })}
                    style={[styles.blockCell, on && styles.blockOn]}
                  >
                    <T variant="caption" tone={on ? 'danger' : 'tertiary'}>
                      {p === 1 ? t.common.weekdays[d] : on ? '×' : ''}
                    </T>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
        <T variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>
          {t.planner.blockedNote}
        </T>
        <T variant="sub" tone="secondary" style={styles.label}>
          {t.planner.count}
        </T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Chip key={n} testID={`plan-count-${n}`} label={String(n)} selected={!settings.creditGoal && settings.count === n} onPress={() => update({ count: n, creditGoal: null })} />
          ))}
        </View>
        <TextField
          testID="plan-credit-goal"
          label={t.planner.creditGoal}
          value={settings.creditGoal ? String(settings.creditGoal) : ''}
          onChangeText={(v) => {
            const n = Number(v.replace(/[^0-9]/g, ''));
            update({ creditGoal: n > 0 ? Math.min(n, 40) : null });
          }}
          keyboardType="number-pad"
          placeholder={t.planner.creditGoalPh}
          maxLength={2}
        />
        <Gap size={space.md} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Chip testID="cand-only-need" icon="flag-outline" label={t.planner.onlyNeed} selected={onlyNeed} onPress={() => { setOnlyNeed(!onlyNeed); setPlans(null); }} />
        </View>
        <Button testID="cand-find" label={searched ? t.planner.findAgain : t.planner.find} icon="search" onPress={() => { setSearched(true); setCandLimit(20); setPlans(null); }} />
        {searched ? (
          <>
            <T variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>{t.planner.findNote}</T>
            <Button testID="cand-find-reset" label={t.planner.findReset} variant="text" size="md" onPress={() => { setSearched(false); setPlans(null); }} />
          </>
        ) : null}
      </Block>
      <Gap />

      <Block>
        <BlockHeader title={t.planner.candidates(active.length)} />
        {excluded.length ? (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              <Chip testID="cand-hide-excluded" label={t.planner.hideExcluded} selected={!showExcluded} onPress={() => setShowExcluded(!showExcluded)} />
            </View>
            <T variant="caption" tone="tertiary">
              {t.planner.excludedCount(excluded.length)}
            </T>
          </>
        ) : null}
        {active.length === 0 ? <EmptyText text={t.official.noResult} /> : null}
        <TextField testID="cand-search" label={t.planner.candSearch} value={candQuery} onChangeText={(v) => { setCandQuery(v); setCandLimit(20); setPlans(null); }} autoCorrect={false} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: space.sm }}>
          <Chip testID="cand-track-all" label={t.lectures.all} selected={candTrack == null} onPress={() => { setCandTrack(null); setPlans(null); }} />
          {TRACKS.map((x) => (
            <Chip key={x} testID={`cand-track-${x}`} label={t.official.tracks[x]} selected={candTrack === x} onPress={() => { setCandTrack(x); setCandLimit(20); setPlans(null); }} />
          ))}
        </View>
        <T variant="caption" tone="tertiary" testID="cand-shown">{t.planner.candShown(shown.length, Math.min(candLimit, shown.length))}</T>
        {removed ? <Notice text={t.planner.findSummary(shown.length, removed.conflict, removed.blocked, removed.lunch, recommended.size)} /> : null}
        {[...shown.slice(0, candLimit), ...(showExcluded ? excluded.slice(0, 40) : [])].map((c) => (
          <View key={c.course.id} style={[styles.card, c.excluded && { opacity: 0.6 }]} testID={`cand-${c.course.id}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Pressable onPress={() => router.push({ pathname: '/course', params: { id: c.course.id } })} style={{ flex: 1 }}>
                <T variant="body" style={{ fontWeight: '700' }} numberOfLines={2}>
                  {cn(c.course.name)}
                </T>
                {recommended.has(c.course.id) ? <Pill text={t.planner.recommended} tone="accent" /> : null}
                <T variant="caption" tone="tertiary">
                  {[c.course.section ? `[${c.course.section}]` : '', c.course.instructor ?? '', c.course.meetings.map((m) => t.lectures.meeting(t.common.weekdays[m.weekday], m.period)).join(', ')].join(' ')}
                </T>
              </Pressable>
              {c.excluded ? (
                <Pill text={t.planner.excludedWhy[c.excluded]} />
              ) : (
                <Chip
                  testID={`cand-pool-${c.course.id}`}
                  label={inPool(c) ? t.planner.inPoolOn : t.planner.inPool}
                  selected={inPool(c)}
                  onPress={() => {
                    if (inPool(c)) setPicks(picks.filter((x) => x !== c.course.id));
                    else {
                      const r = withPick(picks, c.course.id, active);
                      setPicks(r.ids);
                      setMsg(r.replaced.length ? t.planner.sandbox.replacedNote(r.replaced.map((x) => cn(x.course.name)).join(', ')) : null);
                    }
                    setPlans(null);
                  }}
                />
              )}
            </View>
            <ReasonRow label={t.planner.reasons.requirement} value={t.planner.reasons[c.requirement]} tone={c.requirement !== 'unmarked' ? 'success' : 'neutral'} />
            <ReasonRow label={t.planner.reasons.offered} value={c.offered === 'confirmed' ? t.planner.reasons.offeredConfirmed : t.planner.reasons.offeredNot} tone={c.offered === 'confirmed' ? 'success' : 'warning'} />
            <ReasonRow label={t.planner.reasons.grade} value={c.gradeFit === 'ok' ? t.planner.reasons.gradeOk : c.gradeFit === 'higher_year' ? t.planner.reasons.gradeHigher : t.planner.reasons.check} tone={c.gradeFit === 'higher_year' ? 'warning' : 'neutral'} />
            <ReasonRow label={t.planner.reasons.cohort} value={`${c.course.cohort} — ${c.cohort === true ? t.official.cohortYes : c.cohort === false ? t.official.cohortNo : t.official.cohortUnknown}`} tone={c.cohort === false ? 'danger' : 'neutral'} />
            <ReasonRow label={t.planner.reasons.prereq} value={c.prerequisite ? tr(c.prerequisite) : t.planner.reasons.prereqUnknown} />
            <ReasonRow label={t.planner.reasons.official} value={c.hasSyllabus ? t.planner.reasons.syllabusLinked : c.course.syllabus?.evaluation ? `${c.course.syllabus.kind} · ${c.course.syllabus.evaluation}` : t.planner.reasons.noSyllabus} />
            <ReasonRow label={t.planner.reasons.fills} value={c.fillsCategory ? `${categoryLabel(c.fillsCategory, picked?.rule, t.records.categories, locale)} (${t.planner.reasons.suggestedOnly})` : t.planner.reasons.fillsUnknown} tone={c.fillsCategory ? 'success' : 'neutral'} />
            <ReasonRow label={t.planner.reasons.credits} value={c.credits != null ? `${c.credits}` : t.planner.reasons.creditsUnknown} />
            <ReasonRow label={t.planner.reasons.reviews} value={digests[c.course.id]?.count ? t.digest.line(digests[c.course.id].count, digests[c.course.id].demoIncluded ? digests[c.course.id].demoCount : 0, digests[c.course.id].workload?.avg ?? null, digests[c.course.id].difficulty?.avg ?? null) : t.digest.none} />
            <ReasonRow
              label={t.planner.reasons.time}
              value={[c.conflicts.length ? t.planner.reasons.conflict(c.conflicts.join(', ')) : t.planner.reasons.noConflict, c.blocked ? t.planner.reasons.blocked : '', c.lunchHit ? t.planner.reasons.lunchHit : ''].filter(Boolean).join(' · ')}
              tone={c.conflicts.length || c.blocked ? 'danger' : 'neutral'}
            />
            <ReasonRow label={t.planner.reasons.interest} value={c.interestHits.length ? t.planner.reasons.interestHit(c.interestHits.join(', ')) : t.planner.reasons.interestNone} />
          </View>
        ))}
        {shown.length > candLimit ? <Button testID="cand-more" label={t.official.more(shown.length - candLimit)} variant="text" size="md" onPress={() => setCandLimit((n) => n + 20)} /> : null}
      </Block>
      <Gap />

      <Block>
        <BlockHeader title={t.planner.plans} />
        <T variant="caption" tone="tertiary" style={{ marginBottom: space.sm }}>
          {t.planner.preview}
        </T>
        <Button testID="plan-make" label={t.planner.makePlans} icon="grid-outline" onPress={make} disabled={!tgt || !od} />
        {plans && plans.plans.length === 0 ? (
          <>
            <Gap size={space.sm} />
            <Notice tone="warning" text={`${t.planner.noPlans} ${t.planner.noPlansWhy(plans.usable)}`} />
          </>
        ) : null}
      </Block>

      {plans && plans.plans.length ? (
        <>
          <Gap />
          <ScrollView horizontal showsHorizontalScrollIndicator style={{ marginHorizontal: -gutter }} contentContainerStyle={{ paddingHorizontal: gutter, gap: space.md }}>
            {plans.plans.map((p) => {
              const hl = planHighlights[p.id];
              const others = new Set(plans.plans.filter((x) => x.id !== p.id).flatMap((x) => x.courseIds));
              // 영역과 무관한 학점 합계 (수강 중 포함 → 이 안을 모두 이수했다고 가정). 영역별 충족은 기록에서 영역을 고른 뒤 졸업 준비에서 확인
              const rawTotal = (list: CourseRecord[]) => list.filter((r) => r.category !== 'outside').reduce((a, r) => a + (r.credits ?? 0), 0);
              const before = rawTotal(countedRecords(records, 'current').list);
              const after = rawTotal(countedRecords([...records, ...hypothetical(p)], 'plan').list);
              const note = ai.data?.planNotes.find((n) => n.planId === p.id);
              return (
                <View key={p.id} style={styles.planCard} testID={`plan-${p.id}`}>
                  <T variant="headline" style={{ fontWeight: '700' }}>
                    {t.planner.planLabel[p.strategy]}
                  </T>
                  <Gap size={space.sm} />
                  <MiniGrid fixed={fixed} added={p.courseIds.flatMap((id) => byId(id).course.meetings)} blocked={blocked} testID={`plan-grid-${p.id}`} />
                  <Gap size={space.sm} />
                  {hl ? <AltHighlights h={hl} testID={`plan-highlights-${p.id}`} /> : null}
                  <ReviewNotes notes={planNotes[p.id] ?? []} testID={`plan-review-notes-${p.id}`} />
                  <Gap size={space.sm} />
                  {p.courseIds.map((id) => (
                    <T key={id} variant="sub" numberOfLines={1}>
                      {others.has(id) ? '• ' : '★ '}
                      {cn(byId(id).course.name)}
                    </T>
                  ))}
                  <T variant="caption" tone="tertiary">
                    ★ {t.planner.diff}
                  </T>
                  <Gap size={space.sm} />
                  <ReasonRow label={t.planner.m.days} value={String(p.metrics.days)} />
                  <ReasonRow label={t.planner.m.gaps} value={t.builder.gapLine(p.metrics.gapPeriods, t.planner.minutes(p.metrics.gapMinutes), p.metrics.freeWeekdays)} />
                  <ReasonRow label={t.planner.m.consecutive} value={String(p.metrics.maxConsecutive)} />
                  {settings.lunch ? <ReasonRow label={t.planner.m.lunchOk} value={`${p.metrics.lunchOkDays} / ${p.metrics.days}`} /> : null}
                  <ReasonRow label={t.planner.m.credits} value={String(p.creditsKnown)} />
                  <ReasonRow label={t.planner.m.creditsUnknown} value={String(p.creditsUnknown)} tone={p.creditsUnknown ? 'warning' : 'neutral'} />
                  <ReasonRow label={t.planner.m.required} value={String(p.requiredCount)} />
                  <Gap size={space.sm} />
                  <T variant="caption" tone="secondary" style={{ fontWeight: '700' }}>
                    {t.planner.expected}
                  </T>
                  <T variant="caption" tone="secondary">
                    {t.planner.expectedLine(before, after, p.creditsUnknown)}
                  </T>
                  <T variant="caption" tone="tertiary">
                    {t.planner.expectedNote}
                  </T>
                  {note ? <Notice text={note.text} /> : null}
                  <Gap size={space.sm} />
                  <Button testID={`plan-apply-${p.id}`} label={t.planner.apply} size="md" onPress={() => apply(p)} />
                  <Gap size={space.xs} />
                  <Button testID={`plan-to-sandbox-${p.id}`} label={t.planner.sandbox.fromPlan} variant="text" size="md" onPress={() => setPicks([...p.courseIds])} />
                </View>
              );
            })}
          </ScrollView>
          <Gap />
          <Block>
            <TextField testID="plan-wish" label={t.planner.aiWish} value={wish} onChangeText={setWish} maxLength={300} />
            <T variant="caption" tone="tertiary" style={{ marginBottom: space.sm }}>
              {t.planner.aiNote}
            </T>
            <Button testID="plan-ai" label={t.planner.ai} icon="sparkles-outline" variant="secondary" onPress={askAi} loading={ai.busy} />
            {ai.err ? <Notice tone="danger" text={ai.err} /> : null}
            {ai.data ? (
              <View testID="plan-ai-result" style={{ marginTop: space.md }}>
                <Pill text={t.planner.aiTitle} tone="warning" />
                <T variant="body" style={{ marginTop: space.sm }}>
                  {ai.data.wishSummary}
                </T>
                {ai.data.courseNotes.map((n) => (
                  <Row key={n.id} title={cn(byId(n.id)?.course.name ?? n.id)} subtitle={n.text} />
                ))}
                {ai.data.cautions.map((c) => (
                  <T key={c} variant="caption" tone="secondary">
                    • {c}
                  </T>
                ))}
                {ai.data.invalid ? (
                  <T variant="caption" tone="danger">
                    {t.planner.aiInvalid(ai.data.invalid)}
                  </T>
                ) : null}
              </View>
            ) : null}
          </Block>
        </>
      ) : null}

      {od && tgt ? (
        <>
          <Gap />
          <Sandbox
            candidates={active}
            fixed={fixed}
            periodTimes={od.periods.items}
            lunch={settings.lunch}
            picked={picks}
            onPicked={(ids) => {
              setPicks(ids);
              setPlans(null);
            }}
            onApply={(ids) => apply({ courseIds: ids }, () => setPicks([]))}
            creditGoal={settings.creditGoal ?? null}
            gradOf={(chosen) => gradEffect(records, rulePicked, chosen, tgt.year)}
          />
          <Gap />
          <Block testID="ai-pick">
            <BlockHeader title={t.planner.pick.title} />
            <T variant="caption" tone="tertiary" style={{ marginBottom: space.sm }}>
              {t.planner.pick.lead}
            </T>
            <TextField testID="ai-pick-input" label={t.planner.pick.input} value={pickAsk} onChangeText={setPickAsk} multiline maxLength={500} placeholder={t.planner.pick.placeholder} style={{ height: 96, paddingTop: space.sm }} />
            <Button testID="ai-pick-run" label={t.planner.pick.run} icon="sparkles-outline" onPress={askPick} loading={pick.busy} disabled={!pickAsk.trim()} />
            {pick.err ? <Notice tone="danger" text={pick.err} /> : null}
            {pick.data && pickResult ? (
              <View testID="ai-pick-result" style={{ marginTop: space.md }}>
                <Pill text={t.planner.pick.aiLabel} tone="warning" />
                {pick.data.summary ? <T variant="body" style={{ marginTop: space.sm }}>{pick.data.summary}</T> : null}
                <T variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>
                  {t.planner.pick.applied(pickResult.goal, pickResult.kisoMax, pickResult.lunch ? `${pickResult.lunch.start}–${pickResult.lunch.end}` : null)}
                </T>
                {pickResult.accepted.map((c) => (
                  <Row
                    key={c.course.id}
                    testID={`ai-pick-row-${c.course.id}`}
                    right={
                      <Chip
                        testID={`ai-pick-add-${c.course.id}`}
                        label={inPool(c) ? t.planner.pick.added : t.planner.pick.addOne}
                        selected={inPool(c)}
                        onPress={() => {
                          if (inPool(c)) return setPicks(picks.filter((x) => x !== c.course.id));
                          const r = withPick(picks, c.course.id, active);
                          setPicks(r.ids);
                          setPickMsg(r.replaced.length ? t.planner.sandbox.replacedNote(r.replaced.map((x) => cn(x.course.name)).join(', ')) : t.planner.pick.addedOne(cn(c.course.name)));
                        }}
                      />
                    }
                    title={`${cn(c.course.name)}${c.course.section ? ` [${c.course.section}]` : ''}`}
                    subtitle={[c.course.meetings.map((m) => t.lectures.meeting(t.common.weekdays[m.weekday], m.period)).join(', '), c.credits != null ? `${c.credits}${t.official.creditsUnit}` : '', pick.data!.picks.find((p) => p.id === c.course.id)?.reason ?? ''].filter(Boolean).join(' · ')}
                  />
                ))}
                <T variant="sub" style={{ fontWeight: '700', marginTop: space.xs }}>
                  {t.planner.pick.total(pickResult.accepted.reduce((a, c) => a + (c.credits ?? 0), 0))}
                </T>
                {pickResult.dropped.length ? (
                  <Notice tone="warning" text={t.planner.pick.dropped(pickResult.dropped.map((d) => `${cn(d.c.course.name)} (${t.planner.pick.why[d.why]})`).join(', '))} />
                ) : null}
                {pick.data.cautions.map((x) => (
                  <T key={x} variant="caption" tone="secondary">• {x}</T>
                ))}
                <Gap size={space.sm} />
                <Button
                  testID="ai-pick-apply"
                  label={t.planner.pick.toSandbox(pickResult.accepted.length)}
                  icon="grid-outline"
                  onPress={() => {
                    // 이미 넣어 둔 과목은 두고, 추천 과목을 하나씩 넣는다 (같은 과목·겹치는 칸은 바꿔 넣음)
                    let ids = picks;
                    for (const c of pickResult.accepted) ids = withPick(ids, c.course.id, active).ids;
                    setPicks(ids);
                    setPickMsg(t.planner.pick.addedAll(pickResult.accepted.length));
                  }}
                  disabled={!pickResult.accepted.length || pickResult.accepted.every((c) => inPool(c))}
                />
                {pickMsg ? <Notice text={pickMsg} /> : null}
              </View>
            ) : null}
          </Block>
        </>
      ) : null}

      {msg ? (
        <>
          <Gap />
          <Notice text={msg} />
        </>
      ) : null}
      {backup ? (
        <>
          <Gap size={space.sm} />
          <Button testID="plan-undo" label={t.planner.undo} variant="tertiary" icon="arrow-undo-outline" onPress={undo} />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontWeight: '600', marginBottom: space.xs, marginTop: space.md },
  blockCell: { flex: 1, height: 32, margin: 2, borderRadius: radius.badge, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' },
  blockOn: { backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.dangerText },
  card: { paddingVertical: space.md, borderTopWidth: 1, borderTopColor: colors.divider },
  planCard: { width: 260, backgroundColor: colors.surface, borderRadius: radius.block, borderWidth: 1, borderColor: colors.divider, padding: space.lg },
});
