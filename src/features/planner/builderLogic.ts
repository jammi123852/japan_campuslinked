/**
 * 직접 시간표 짜기: 조건 → 완성 시간표 대안 → 과목 변경 영향 (순수 함수, Node 테스트 가능).
 * 필수 조건(개설·충돌·중복·학년·입학 연도·사용자가 정한 조건)을 먼저 걸러 내고, 그 안에서만 선호로 순서를 정한다.
 * 숫자는 모두 이 파일의 evaluateDraft 한 곳에서 계산한다. 카드·큰 시간표·AI 설명이 같은 값을 쓴다.
 */
import type { TimetableEntry } from '../../data/types';
import { EMPTY_CONDITIONS, isRequired, LUNCH, planFromConditions, prefEvidence, prefScore, preparePlan, type PlanConditions, type PlanInput, type PlanOutcome, type Pref } from '../assistant/assistantLogic';
import { overlapsLunch, planMetrics, type Candidate, type PlanMetrics } from './plannerLogic';
import { computeProgress, type CourseRecord } from '../records/gradLogic';
import type { GradRule } from '../official/types';

export interface BuilderConditions extends PlanConditions {
  /** 가능하면 1교시를 피한다 (지키지 못하면 표시). avoidPeriods 는 반드시 지키는 조건 */
  softFirst: boolean;
  /** 가능하면 점심시간을 비운다. lunch 는 반드시 지키는 조건 */
  softLunch: boolean;
}
export const EMPTY_BUILDER: BuilderConditions = { ...EMPTY_CONDITIONS, softFirst: false, softLunch: false };

export type AltKey = 'requirement' | 'gaps' | 'balance';
export const ALT_KEYS: AltKey[] = ['requirement', 'gaps', 'balance'];

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const slot = (d: number, p: number) => `${d}-${p}`;

export function prepareBuilder(input: PlanInput, cond: BuilderConditions) {
  const pre = preparePlan(input, cond);
  const byId = new Map(pre.all.map((c) => [c.course.id, c]));
  // 대안에 넣을 수 있는 후보: 교시가 확인되고, 막은 시간·충돌·점심(반드시) 조건을 통과한 것
  const legal = pre.pool.filter((c) => c.course.meetings.length > 0 && !c.blocked && c.conflicts.length === 0 && !(cond.lunch && c.lunchHit));
  return { pre, byId, legal };
}

type Build = ReturnType<typeof prepareBuilder>;

export interface DraftMetrics extends PlanMetrics {
  /** 이 계획에서 더하는 학점 */
  addedCredits: number;
  addedUnknown: number;
  /** 이미 시간표에 있는 수업의 학점 */
  fixedCredits: number;
  fixedUnknown: number;
  totalCredits: number;
  /** 채워질 영역 (제안 기준). after 가 before 보다 작을 때만 */
  fills: { id: string; before: number; after: number }[];
  /** 이 계획 뒤에도 남는 영역 */
  remaining: { id: string; short: number }[];
  requiredIncluded: string[];
  /** 졸업까지 남은 학점 (제안 영역 기준). 규칙이 없으면 null */
  gradBefore: number | null;
  gradAfter: number | null;
  gradFilled: number;
  /** 후기가 있는 과목의 과제량 평균 (도움돼요 반영값, 후기 없으면 null) */
  avgWorkload: number | null;
  courseCount: number;
  /** 대상인데 이 계획에 없는 필수 표시 과목 */
  requiredMissing: string[];
  reviews: { id: string; n: number; demo: number; helpful: number; smallSample: boolean; mixed: boolean }[];
  reviewTotal: number;
  noReviewCourses: number;
  unmet: { key: 'softFirst' | 'softLunch' | 'creditGoal' | 'prefNoEvidence'; n: number; pref?: Pref }[];
  checks: { id: string; kind: 'prereq' | 'cohort' | 'grade' | 'credits' | 'offered'; text?: string }[];
  /** 지금 시간표와 겹치게 된 과목 (적용 직전 재검사용) */
  clashes: string[];
}

/** 과목을 계획에 넣었을 때 졸업까지 남은 학점 변화. 수강 계획·가상 시간표·직접 시간표 짜기가 같은 계산을 쓴다 */
export function gradEffect(records: CourseRecord[], picked: { key: string; rule: GradRule } | null | undefined, chosen: Candidate[], year: number) {
  if (!picked) return { before: null, after: null, filled: 0 };
  const before = computeProgress(records, picked, 'plan').totalShort;
  const after = computeProgress([...records, ...chosen.map((c) => hypothetical(c, year))], picked, 'plan').totalShort;
  return { before, after, filled: Math.max(0, before - after) };
}

function shortsOf(records: CourseRecord[], input: PlanInput) {
  if (!input.picked) return null;
  const p = computeProgress(records, input.picked, 'plan');
  const out = new Map<string, number>();
  p.categories.forEach((c) => out.set(c.id, c.short));
  p.pools.forEach((x) => out.set(x.id, x.short));
  if (p.flex) out.set('flex', p.flex.short);
  return out;
}

const hypothetical = (c: Candidate, year: number): CourseRecord => ({
  id: `hypo-${c.course.id}`,
  year,
  quarters: [...c.course.quarters],
  name: c.course.name,
  code: c.course.code ?? c.course.syllabus?.code ?? null,
  section: c.course.section,
  credits: c.credits,
  category: (c.fillsCategory ?? 'unknown') as CourseRecord['category'],
  suggestedCategory: c.fillsCategory as CourseRecord['suggestedCategory'],
  status: 'planned',
  confirmedAt: null,
  officialId: c.course.id,
  note: '',
  createdAt: '',
  updatedAt: '',
});

/** 초안 하나의 비교 지표. 모든 화면이 이 값을 쓴다 */
export function evaluateDraft(input: PlanInput, cond: BuilderConditions, b: Build, ids: string[]): DraftMetrics {
  const chosen = ids.map((id) => b.byId.get(id)).filter((c): c is Candidate => !!c);
  const fixed = b.pre.fixed;
  const times = input.od.periods.items;
  const added = chosen.flatMap((c) => c.course.meetings);
  const m = planMetrics([...fixed, ...added], times, LUNCH);
  const courses = input.od.courses;
  const fixedCredit = (e: TimetableEntry) => {
    const c = e.lectureId ? courses.find((x) => x.id === e.lectureId) : null;
    return c ? (c.credits ?? c.syllabus?.credits ?? null) : null;
  };
  const seenLectures = new Set<string>();
  let fixedCredits = 0;
  let fixedUnknown = 0;
  for (const e of fixed) {
    const key = e.lectureId ?? `${e.courseName}`;
    if (seenLectures.has(key)) continue;
    seenLectures.add(key);
    const cr = fixedCredit(e);
    if (cr == null) fixedUnknown += 1;
    else fixedCredits += cr;
  }
  const addedCredits = chosen.reduce((a, c) => a + (c.credits ?? 0), 0);
  const before = shortsOf(input.records, input);
  const after = shortsOf([...input.records, ...chosen.map((c) => hypothetical(c, input.target.year))], input);
  const fills: DraftMetrics['fills'] = [];
  const remaining: DraftMetrics['remaining'] = [];
  if (before && after) {
    for (const [id, short] of before) {
      const next = after.get(id) ?? short;
      if (next < short) fills.push({ id, before: short, after: next });
      if (next > 0) remaining.push({ id, short: next });
    }
  }
  const grad = gradEffect(input.records, input.picked, chosen, input.target.year);
  const workloads = chosen.flatMap((c) => {
    const d = input.digests[c.course.id];
    const w = d?.weighted?.workload ?? d?.workload?.avg ?? null;
    return w == null ? [] : [w];
  });
  const requiredIncluded = chosen.filter(isRequired).map((c) => c.course.name);
  const inPlanNames = new Set(chosen.map((c) => norm(c.course.name)));
  const requiredMissing = [...new Set(b.pre.eligible.filter(isRequired).map((c) => c.course.name))].filter((n) => !inPlanNames.has(norm(n)));
  const reviews = chosen.flatMap((c) => {
    const d = input.digests[c.course.id];
    return d && d.count ? [{ id: c.course.id, n: d.count, demo: d.demoIncluded ? d.demoCount : 0, helpful: d.weighted?.helpfulTotal ?? 0, smallSample: d.smallSample, mixed: !!(d.workload?.mixed || d.difficulty?.mixed) }] : [];
  });
  const unmet: DraftMetrics['unmet'] = [];
  if (cond.softFirst) {
    const n = added.filter((x) => x.period === 1).length;
    if (n) unmet.push({ key: 'softFirst', n });
  }
  if (cond.softLunch && m.lunchBadDays) unmet.push({ key: 'softLunch', n: m.lunchBadDays });
  if (cond.creditGoal && addedCredits < cond.creditGoal) unmet.push({ key: 'creditGoal', n: cond.creditGoal - addedCredits });
  for (const p of cond.prefs) {
    const none = chosen.filter((c) => prefEvidence(input.digests[c.course.id], [p])[p] === 'none').length;
    if (none) unmet.push({ key: 'prefNoEvidence', n: none, pref: p });
  }
  const checks: DraftMetrics['checks'] = [];
  for (const c of chosen) {
    // 'なし' 처럼 조건이 없다고 적힌 경우는 확인 항목이 아니다
    if (c.prerequisite && !/^\s*(なし|無し|特になし|none|n\/a|-)\s*[。.]?\s*$/i.test(c.prerequisite)) checks.push({ id: c.course.id, kind: 'prereq', text: c.prerequisite });
    if (c.cohort == null) checks.push({ id: c.course.id, kind: 'cohort' });
    if (c.gradeFit === 'unknown') checks.push({ id: c.course.id, kind: 'grade' });
    if (c.credits == null) checks.push({ id: c.course.id, kind: 'credits' });
    if (c.offered !== 'confirmed') checks.push({ id: c.course.id, kind: 'offered' });
  }
  const occupied = new Set(fixed.map((f) => slot(f.weekday, f.period)));
  const clashes = chosen.filter((c) => c.course.meetings.some((x) => occupied.has(slot(x.weekday, x.period)))).map((c) => c.course.name);
  return {
    ...m,
    addedCredits,
    addedUnknown: chosen.filter((c) => c.credits == null).length,
    fixedCredits,
    fixedUnknown,
    totalCredits: addedCredits + fixedCredits,
    fills,
    remaining,
    gradBefore: grad.before,
    gradAfter: grad.after,
    gradFilled: grad.filled,
    avgWorkload: workloads.length ? Math.round((workloads.reduce((a, x) => a + x, 0) / workloads.length) * 10) / 10 : null,
    courseCount: chosen.length,
    requiredIncluded,
    requiredMissing,
    reviews,
    reviewTotal: reviews.reduce((a, r) => a + r.n, 0),
    noReviewCourses: chosen.length - reviews.length,
    unmet,
    checks,
    clashes,
  };
}

export interface Alternative {
  key: AltKey;
  /** 같은 결과로 합쳐진 방향 */
  merged: AltKey[];
  ids: string[];
  metrics: DraftMetrics;
}

function choose(input: PlanInput, cond: BuilderConditions, b: Build, alt: AltKey): string[] {
  const times = input.od.periods.items;
  const fixed = b.pre.fixed;
  const chosen: Candidate[] = [...b.pre.forced];
  const occupied = new Set([...fixed, ...chosen.flatMap((c) => c.course.meetings)].map((f) => slot(f.weekday, f.period)));
  const fixedNames = new Set(fixed.map((e) => norm(e.courseName)));
  const remaining = b.legal.filter((c) => !chosen.includes(c) && !fixedNames.has(norm(c.course.name)));
  const goal = cond.creditGoal;
  const count = input.count ?? 4;
  const credits = () => chosen.reduce((a, c) => a + (c.credits ?? 0), 0);
  const short = new Set(input.shortCategories);
  while ((goal ? credits() < goal : chosen.length < count) && remaining.length) {
    const cur = [...fixed, ...chosen.flatMap((c) => c.course.meetings)];
    const curM = planMetrics(cur, times, LUNCH);
    const curDays = new Set(cur.map((x) => x.weekday));
    const perDay = (d: number) => cur.filter((x) => x.weekday === d).length;
    const score = (c: Candidate) => {
      const ms = c.course.meetings;
      const newDays = new Set(ms.map((x) => x.weekday).filter((d) => !curDays.has(d))).size;
      const next = planMetrics([...cur, ...ms], times, LUNCH);
      const gapDelta = next.gapMinutes - curM.gapMinutes;
      const fills = c.fillsCategory && short.has(c.fillsCategory) ? 1 : 0;
      const marked = c.requirement === 'unmarked' ? 0 : 1;
      const lunchHit = ms.some((x) => overlapsLunch(x.period, times, LUNCH));
      let s = c.credits == null ? -50 : 0;
      if (alt === 'requirement') s += (isRequired(c) ? 1000 : 0) + fills * 500 + marked * 100 - newDays * 5;
      if (alt === 'gaps') s += -newDays * 200 - gapDelta / 5 + fills * 20 + marked * 5;
      if (alt === 'balance') {
        const d = input.digests[c.course.id];
        const wl = d?.weighted?.workload ?? d?.workload?.avg ?? null;
        s += (lunchHit ? -300 : 0) - Math.max(0, next.maxConsecutive - 2) * 200 - Math.max(...ms.map((x) => perDay(x.weekday))) * 40 + (wl != null ? (3 - wl) * 30 : 0) + fills * 20 + marked * 5;
      }
      // 사용자가 고른 선호는 어느 방향에서나 반영한다 (후보를 빼지는 않는다)
      if (cond.softFirst && ms.some((x) => x.period === 1)) s -= 150;
      if (cond.softLunch && lunchHit) s -= 150;
      if (cond.fewerDays) s -= newDays * 100;
      if (cond.minimizeGaps) s -= gapDelta / 2;
      // 선호를 고르지 않아도 후기 근거가 있으면 비슷한 후보끼리의 순서에 조금 반영한다 (필수·부족 영역 점수를 넘지 않음)
      const dg = input.digests[c.course.id];
      const reviewTie = dg?.count ? (3 - (dg.weighted?.workload ?? dg.workload?.avg ?? 3)) * (dg.smallSample ? 1 : 3) : 0;
      return s + reviewTie + prefScore(c, cond.prefs, input.digests) * 10;
    };
    const legalNow = remaining.filter((c) => c.course.meetings.every((x) => !occupied.has(slot(x.weekday, x.period))) && !chosen.some((x) => norm(x.course.name) === norm(c.course.name)));
    if (!legalNow.length) break;
    legalNow.sort((a, z) => score(z) - score(a) || a.course.id.localeCompare(z.course.id));
    const pick = legalNow[0];
    chosen.push(pick);
    pick.course.meetings.forEach((x) => occupied.add(slot(x.weekday, x.period)));
    remaining.splice(remaining.indexOf(pick), 1);
  }
  return chosen.map((c) => c.course.id).sort();
}

export interface BuilderResult {
  alternatives: Alternative[];
  outcome: Pick<PlanOutcome, 'conflicts' | 'relax'>;
  usable: number;
  /** 계산 버전. 조건·시간표·기록·후기가 바뀌면 달라진다 */
  version: string;
  build: Build;
}

/** 조건으로 대안을 계산한다. 결과가 같으면 합치고, 없는 대안을 만들지 않는다 */
export function buildAlternatives(input: PlanInput, cond: BuilderConditions): BuilderResult {
  const b = prepareBuilder(input, cond);
  const alternatives: Alternative[] = [];
  for (const key of ALT_KEYS) {
    const ids = choose(input, cond, b, key);
    if (!ids.length) continue;
    const same = alternatives.find((a) => a.ids.join() === ids.join());
    if (same) same.merged.push(key);
    else alternatives.push({ key, merged: [key], ids, metrics: evaluateDraft(input, cond, b, ids) });
  }
  const o = planFromConditions(input, cond);
  const version = hash(JSON.stringify({ c: cond, t: input.target, f: b.pre.fixed.map((e) => [e.weekday, e.period, e.courseName]), r: input.records.map((r) => [r.officialId, r.status, r.category]), d: Object.values(input.digests).map((d) => [d.lectureId, d.sourceHash, d.reactionHash]), a: alternatives.map((a) => a.ids) }));
  return { alternatives, outcome: { conflicts: o.conflicts, relax: o.relax }, usable: b.legal.length, version, build: b };
}

function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** 장단점 판단에 쓰는 지표. 수강 계획·채팅 카드처럼 일부만 있으면 없는 항목은 판단하지 않는다 */
export interface HighlightInput {
  days: number;
  gapPeriods: number;
  freeWeekdays: number;
  lunchOkDays: number;
  lunchBadDays: number;
  maxConsecutive: number;
  gradFilled: number | null;
  avgWorkload?: number | null;
  noReviewCourses?: number;
  courseCount?: number;
}
export type ProKey = 'mostGrad' | 'gradFill' | 'fewestDays' | 'freeDays' | 'noGaps' | 'fewestGaps' | 'lunchAll' | 'shortRun' | 'lightest';
export type ConKey = 'noGrad' | 'lessGrad' | 'moreDays' | 'manyGaps' | 'longRun' | 'noLunch' | 'heavy' | 'noReviews';
export interface Highlights {
  pros: { key: ProKey; n: number }[];
  cons: { key: ConKey; n: number }[];
}

/**
 * 대안의 장단점을 앱 계산값으로 고른다 (AI 를 쓰지 않는다). 대안이 여러 개면 서로 비교하고, 다른 대안보다 나을 때만 '가장'이라고 한다.
 */
export function altHighlights<T extends string>(list: { id: T; m: HighlightInput }[]): Record<T, Highlights> {
  const out = {} as Record<T, Highlights>;
  const many = list.length > 1;
  const nums = (pick: (m: HighlightInput) => number | null | undefined) => list.map((x) => pick(x.m)).filter((v): v is number => v != null);
  const best = (v: number, pick: (m: HighlightInput) => number | null | undefined, dir: 'min' | 'max') => {
    const all = nums(pick);
    return many && new Set(all).size > 1 && v === (dir === 'min' ? Math.min(...all) : Math.max(...all));
  };
  for (const { id, m } of list) {
    const pros: Highlights['pros'] = [];
    const cons: Highlights['cons'] = [];
    if (m.gradFilled != null) {
      if (m.gradFilled > 0) pros.push({ key: best(m.gradFilled, (x) => x.gradFilled, 'max') ? 'mostGrad' : 'gradFill', n: m.gradFilled });
      else cons.push({ key: 'noGrad', n: 0 });
      const maxGrad = Math.max(...nums((x) => x.gradFilled));
      if (m.gradFilled > 0 && m.gradFilled < maxGrad) cons.push({ key: 'lessGrad', n: maxGrad - m.gradFilled });
    }
    if (best(m.days, (x) => x.days, 'min')) pros.push({ key: 'fewestDays', n: m.days });
    if (m.freeWeekdays > 0) pros.push({ key: 'freeDays', n: m.freeWeekdays });
    if (m.days > 0 && m.gapPeriods === 0) pros.push({ key: 'noGaps', n: 0 });
    else if (best(m.gapPeriods, (x) => x.gapPeriods, 'min')) pros.push({ key: 'fewestGaps', n: m.gapPeriods });
    if (m.days > 0 && m.lunchBadDays === 0 && m.lunchOkDays > 0) pros.push({ key: 'lunchAll', n: 0 });
    if (m.days > 0 && m.maxConsecutive <= 2 && (!many || best(m.maxConsecutive, (x) => x.maxConsecutive, 'min'))) pros.push({ key: 'shortRun', n: m.maxConsecutive });
    if (m.avgWorkload != null && best(m.avgWorkload, (x) => x.avgWorkload, 'min')) pros.push({ key: 'lightest', n: m.avgWorkload });
    if (many && best(m.days, (x) => x.days, 'max')) cons.push({ key: 'moreDays', n: m.days });
    if (m.gapPeriods >= 3) cons.push({ key: 'manyGaps', n: m.gapPeriods });
    if (m.maxConsecutive >= 4) cons.push({ key: 'longRun', n: m.maxConsecutive });
    if (m.lunchBadDays > 0 && m.lunchOkDays === 0) cons.push({ key: 'noLunch', n: m.lunchBadDays });
    if (m.avgWorkload != null && m.avgWorkload >= 4) cons.push({ key: 'heavy', n: m.avgWorkload });
    if (m.courseCount && m.noReviewCourses === m.courseCount) cons.push({ key: 'noReviews', n: 0 });
    out[id] = { pros, cons };
  }
  return out;
}

export type ReviewTag = 'lightWork' | 'heavyWork' | 'easy' | 'hard' | 'project' | 'noPresentation' | 'presentation' | 'exam' | 'attendance';
export interface ReviewNote {
  id: string;
  name: string;
  isKyoyo: boolean;
  n: number;
  demo: number;
  workload: number | null;
  difficulty: number | null;
  small: boolean;
  mixed: boolean;
  posts: number;
  tags: ReviewTag[];
  /** 다른 대안의 같은 묶음 과목보다 과제 부담이 뚜렷이 가벼울 때 */
  betterThan: { id: string; name: string; workload: number } | null;
  overview: { ko: string; ja: string } | null;
}
const WORK_GAP = 0.5;

/**
 * 대안별로 과목의 커뮤니티 후기 종합을 고른다 (교양·다른 대안에 없는 과목 먼저, 최대 limit개).
 * 숫자는 도움돼요를 반영한 집계값이고, 근거가 없는 과목은 나쁘다고 하지 않고 빼 둔다.
 */
export function altReviewNotes<T extends string>(list: { id: T; courses: Candidate[] }[], digests: PlanInput['digests'], limit = 3): Record<T, ReviewNote[]> {
  const wl = (id: string) => {
    const d = digests[id];
    return d && d.count ? (d.weighted?.workload ?? d.workload?.avg ?? null) : null;
  };
  const out = {} as Record<T, ReviewNote[]>;
  for (const alt of list) {
    const mine = new Set(alt.courses.map((c) => c.course.id));
    const others = list.filter((x) => x.id !== alt.id).flatMap((x) => x.courses).filter((c) => !mine.has(c.course.id));
    const othersIds = new Set(others.map((c) => c.course.id));
    const shared = new Set(list.filter((x) => x.id !== alt.id).flatMap((x) => x.courses.map((c) => c.course.id)));
    const notes = alt.courses.flatMap((c): ReviewNote[] => {
      const d = digests[c.course.id];
      if (!d || !d.count) return [];
      const w = wl(c.course.id);
      const diff = d.weighted?.difficulty ?? d.difficulty?.avg ?? null;
      const said = (k: string) => (d.aspects[k]?.mentioned ?? 0) > 0;
      const tags: ReviewTag[] = [];
      if (w != null && w <= 2.2) tags.push('lightWork');
      if (w != null && w >= 3.8) tags.push('heavyWork');
      if (diff != null && diff <= 2.2) tags.push('easy');
      if (diff != null && diff >= 3.8) tags.push('hard');
      if (said('project')) tags.push('project');
      if ((d.aspects.presentation?.denied ?? 0) > 0) tags.push('noPresentation');
      else if (said('presentation')) tags.push('presentation');
      if (said('exam')) tags.push('exam');
      if (said('attendance')) tags.push('attendance');
      const rival = w == null ? null : others
        .filter((o) => o.course.track === c.course.track && othersIds.has(o.course.id))
        .map((o) => ({ id: o.course.id, name: o.course.name, workload: wl(o.course.id) }))
        .filter((o): o is { id: string; name: string; workload: number } => o.workload != null && o.workload - w >= WORK_GAP)
        .sort((a, z) => z.workload - a.workload)[0] ?? null;
      return [{ id: c.course.id, name: c.course.name, isKyoyo: c.course.track === 'kiso', n: d.count, demo: d.demoIncluded ? d.demoCount : 0, workload: w, difficulty: diff, small: d.smallSample, mixed: !!(d.workload?.mixed || d.difficulty?.mixed), posts: d.evidencePostIds.length, tags, betterThan: rival, overview: d.storedOverview?.ko || d.storedOverview?.ja ? d.storedOverview! : null }];
    });
    notes.sort((a, z) => Number(!!z.betterThan) - Number(!!a.betterThan) || Number(z.isKyoyo) - Number(a.isKyoyo) || Number(!shared.has(z.id)) - Number(!shared.has(a.id)) || z.n - a.n);
    out[alt.id] = notes.slice(0, limit);
  }
  return out;
}

export interface DraftImpact {
  before: DraftMetrics;
  after: DraftMetrics;
  creditsDelta: number;
  /** 빠지는 필수 표시 과목 */
  requiredLost: string[];
  requiredGained: string[];
  /** 충족 예정이었다가 남게 되는 영역 / 새로 채워지는 영역 */
  areasWorse: { id: string; before: number; after: number }[];
  areasBetter: { id: string; before: number; after: number }[];
  /** 남는 과목 중 선수 조건 글에 빠지는 과목 이름이 있는 것 */
  prereqAffected: string[];
}

export function draftImpact(input: PlanInput, cond: BuilderConditions, b: Build, beforeIds: string[], afterIds: string[]): DraftImpact {
  const before = evaluateDraft(input, cond, b, beforeIds);
  const after = evaluateDraft(input, cond, b, afterIds);
  const removed = beforeIds.filter((id) => !afterIds.includes(id)).map((id) => b.byId.get(id)).filter((c): c is Candidate => !!c);
  const stay = afterIds.map((id) => b.byId.get(id)).filter((c): c is Candidate => !!c);
  const shortOf = (m: DraftMetrics) => new Map(m.remaining.map((r) => [r.id, r.short]));
  const sb = shortOf(before);
  const sa = shortOf(after);
  const areas = new Set([...sb.keys(), ...sa.keys()]);
  const areasWorse: DraftImpact['areasWorse'] = [];
  const areasBetter: DraftImpact['areasBetter'] = [];
  for (const id of areas) {
    const x = sb.get(id) ?? 0;
    const y = sa.get(id) ?? 0;
    if (y > x) areasWorse.push({ id, before: x, after: y });
    if (y < x) areasBetter.push({ id, before: x, after: y });
  }
  return {
    before,
    after,
    creditsDelta: after.addedCredits - before.addedCredits,
    requiredLost: before.requiredIncluded.filter((n) => !after.requiredIncluded.includes(n)),
    requiredGained: after.requiredIncluded.filter((n) => !before.requiredIncluded.includes(n)),
    areasWorse,
    areasBetter,
    prereqAffected: stay.filter((c) => c.prerequisite && removed.some((r) => norm(c.prerequisite!).includes(norm(r.course.name)))).map((c) => c.course.name),
  };
}

/** 빼는 과목 대신 넣을 수 있는 실제 후보: 필수 조건을 통과하고, 남은 계획과 겹치지 않는 것 */
export function replacementsFor(input: PlanInput, b: Build, ids: string[], removeId: string, limit = 8): Candidate[] {
  const removed = b.byId.get(removeId);
  const stay = ids.filter((id) => id !== removeId).map((id) => b.byId.get(id)).filter((c): c is Candidate => !!c);
  const occupied = new Set([...b.pre.fixed, ...stay.flatMap((c) => c.course.meetings)].map((f) => slot(f.weekday, f.period)));
  const names = new Set(stay.map((c) => norm(c.course.name)));
  const short = new Set(input.shortCategories);
  const rank = (c: Candidate) => (removed?.fillsCategory && c.fillsCategory === removed.fillsCategory ? 4 : 0) + (norm(c.course.name) === norm(removed?.course.name ?? '') ? 2 : 0) + (c.fillsCategory && short.has(c.fillsCategory) ? 1 : 0);
  return b.legal
    .filter((c) => c.course.id !== removeId && !names.has(norm(c.course.name)) && c.course.meetings.every((m) => !occupied.has(slot(m.weekday, m.period))))
    .sort((a, z) => rank(z) - rank(a) || a.course.id.localeCompare(z.course.id))
    .slice(0, limit);
}

/** 적용 직전 재검사: 그 사이 시간표가 바뀌었으면 막는다 */
export function draftBlockers(b: Build, ids: string[]): string[] {
  const occupied = new Set(b.pre.fixed.map((f) => slot(f.weekday, f.period)));
  const fixedNames = new Set(b.pre.fixed.map((e) => norm(e.courseName)));
  return ids.flatMap((id) => {
    const c = b.byId.get(id);
    if (!c) return [id];
    return c.course.meetings.some((m) => occupied.has(slot(m.weekday, m.period))) || fixedNames.has(norm(c.course.name)) ? [c.course.name] : [];
  });
}
