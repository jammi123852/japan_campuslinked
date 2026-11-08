/**
 * 홈 도우미의 앱 계산 부분 (순수 함수, Node 테스트 가능).
 * 숫자·판정은 기존 로직(buildCandidates·generatePlans·computeProgress·eligibility)을 그대로 쓴다.
 * 후기 선호는 필수 조건을 통과한 후보의 순서에만 영향을 준다.
 */
import type { TimetableEntry } from '../../data/types';
import type { AssistantCall, CourseDigest } from '../../lib/api';
import { entryInPeriod, type AcademicPeriod } from '../academic/academicLogic';
import { coursesForDept } from '../official/courseLogic';
import type { GradRule, OfficialCourse, OfficialData, OfficialScholarship } from '../official/types';
import { buildCandidates, generatePlans, type Candidate, type Plan, type Priority, type TimeRange } from '../planner/plannerLogic';
import { computeProgress, type CourseRecord, type GradProgress } from '../records/gradLogic';
import { eligibility, isClosed, type Answers } from '../scholarship/scholarshipLogic';

export type Pref = 'lowWorkload' | 'project' | 'fewPresentations' | 'lowDifficulty';
export const PREFS: Pref[] = ['lowWorkload', 'project', 'fewPresentations', 'lowDifficulty'];

export interface PlanConditions {
  excludeWeekdays: number[];
  avoidPeriods: number[];
  keepRequired: boolean;
  needOnly: boolean;
  creditGoal: number | null;
  minimizeGaps: boolean;
  fewerDays: boolean;
  lunch: boolean;
  prefs: Pref[];
}

export const EMPTY_CONDITIONS: PlanConditions = { excludeWeekdays: [], avoidPeriods: [], keepRequired: false, needOnly: false, creditGoal: null, minimizeGaps: false, fewerDays: false, lunch: false, prefs: [] };

export const LUNCH: TimeRange = { start: '12:10', end: '13:00' };

const WEEK_WORDS: [RegExp, number][] = [[/월요일|月曜/, 0], [/화요일|火曜/, 1], [/수요일|水曜/, 2], [/목요일|木曜/, 3], [/금요일|金曜/, 4], [/토요일|土曜/, 5]];

/** AI 없이도 쓰는 조건 해석. 모르는 표현은 조건으로 만들지 않는다 */
export function parseConditions(raw: string): PlanConditions {
  const text = raw.normalize('NFKC');
  const c: PlanConditions = { ...EMPTY_CONDITIONS, excludeWeekdays: [], avoidPeriods: [], prefs: [] };
  for (const [re, d] of WEEK_WORDS) {
    const m = re.exec(text);
    if (m && /비우|빼|제외|없|쉬|空け|なし|休|除/.test(text.slice(m.index, m.index + 16))) c.excludeWeekdays.push(d);
  }
  const period = /(\d)\s*(?:교시|限)[^\d]{0,8}(피|빼|제외|싫|없|避け|なし|除)/.exec(text);
  if (period) c.avoidPeriods.push(Number(period[1]));
  c.keepRequired = /필수.{0,8}(유지|넣|포함|우선|듣)|必修.{0,8}(残|入|含|優先|維持)/.test(text);
  c.needOnly = /부족.{0,10}(요건|학점|채우)|足りな.{0,10}(要件|単位|埋)/.test(text);
  const credits = /(\d{1,2})\s*(?:학점|単位)/.exec(text);
  if (credits) c.creditGoal = Number(credits[1]);
  c.minimizeGaps = /공강.{0,6}(최소|적|줄)|空きコマ.{0,6}(少|減|なく)/.test(text);
  c.fewerDays = /등교.{0,6}(적|줄|최소)|通学.{0,6}(少|減)/.test(text);
  c.lunch = /점심|밥\s*시간|昼休|昼食|お昼/.test(text);
  if (/과제.{0,8}(적|부담|없)|課題.{0,8}(少|負担|な)/.test(text)) c.prefs.push('lowWorkload');
  if (/프로젝트|プロジェクト/.test(text)) c.prefs.push('project');
  if (/발표.{0,8}(적|없|싫)|発表.{0,8}(少|な|苦手)/.test(text)) c.prefs.push('fewPresentations');
  if (/(쉬운|난이도.{0,4}낮|簡単|易し)/.test(text)) c.prefs.push('lowDifficulty');
  return c;
}

export function conditionsFromCall(call: Partial<AssistantCall>): PlanConditions {
  const days = (call.excludeWeekdays ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 5);
  const periods = (call.avoidPeriods ?? []).filter((p) => Number.isInteger(p) && p >= 1 && p <= 7);
  return {
    excludeWeekdays: [...new Set(days)],
    avoidPeriods: [...new Set(periods)],
    keepRequired: !!call.keepRequired,
    needOnly: !!call.needOnly,
    creditGoal: call.creditGoal && call.creditGoal > 0 && call.creditGoal <= 30 ? call.creditGoal : null,
    minimizeGaps: !!call.minimizeGaps,
    fewerDays: !!call.fewerDays,
    lunch: !!call.lunch,
    prefs: (call.prefs ?? []).filter((p): p is Pref => (PREFS as string[]).includes(p)),
  };
}

export type LocalRoute = { kind: 'calls'; calls: Partial<AssistantCall>[] } | { kind: 'unsupported' };

/** AI 연결이 안 될 때 쓰는 키워드 연결. 지원 범위 밖이면 unsupported — 추측해서 답하지 않는다 */
export function localRoute(raw: string): LocalRoute {
  const text = raw.normalize('NFKC');
  if (/장학|奨学/.test(text)) return { kind: 'calls', calls: [{ tool: 'get_scholarships' }] };
  if (/비교|比較|比べ/.test(text)) return { kind: 'calls', calls: [{ tool: 'compare_courses', query: text }] };
  if (/공지|お知らせ|掲示|通知/.test(text)) return { kind: 'calls', calls: [[...text].length > 120 ? { tool: 'analyze_notice', text } : { tool: 'search_notices', query: '' }] };
  if (/수강.?계획|시간표.{0,6}(짜|만들|추천|조정)|비우|빼\s*줘|필수.{0,8}유지|다음\s*학기|履修計画|時間割.{0,6}(作|組)|空け|必修|来学期/.test(text)) return { kind: 'calls', calls: [{ tool: 'plan_courses', ...parseConditions(text), creditGoal: parseConditions(text).creditGoal ?? 0 }] };
  if (/졸업|학점.{0,6}(부족|남|얼마)|부족.{0,4}학점|卒業|単位.{0,6}(足|残)/.test(text)) return { kind: 'calls', calls: [{ tool: 'get_graduation' }] };
  if (/어디|위치|どこ|場所|[NS]\d{3}|2[WE]\d{3}|号館|호관/.test(text)) return { kind: 'calls', calls: [{ tool: 'find_place', query: text }] };
  if (/시간표|時間割/.test(text)) return { kind: 'calls', calls: [{ tool: 'get_timetable' }] };
  if (/일정|할\s*일|마감|予定|締切|やること/.test(text)) return { kind: 'calls', calls: [{ tool: 'get_agenda' }] };
  const search = /(.{1,30}?)\s*(강의|수업|과목).{0,6}(찾|검색|알려)|(.{1,30}?)(の授業|の科目).{0,6}(探|検索|教え)/.exec(text);
  if (search) return { kind: 'calls', calls: [{ tool: 'search_courses', query: (search[1] ?? search[4] ?? '').trim() }] };
  return { kind: 'unsupported' };
}

// ------------------------------------------------------------ 졸업

export function gradView(records: CourseRecord[], picked: { key: string; rule: GradRule } | null) {
  const actual = computeProgress(records, picked, 'actual');
  const current = computeProgress(records, picked, 'current');
  const short = (p: GradProgress) => [
    ...p.categories.filter((c) => c.short > 0).map((c) => ({ id: c.id as string, short: c.short, earned: c.earned, min: c.min })),
    ...(p.flex && p.flex.short > 0 ? [{ id: 'flex', short: p.flex.short, earned: p.flex.earned, min: p.flex.min }] : []),
    ...p.pools.filter((x) => x.short > 0).map((x) => ({ id: x.id, short: x.short, earned: x.earned, min: x.min })),
  ];
  return { noRule: actual.noRule, ruleKey: actual.ruleKey, total: actual.totalMin, earned: actual.countedTotal, withEnrolled: current.countedTotal, totalShort: actual.totalShort, totalShortCurrent: current.totalShort, verdict: actual.verdict, unknownCredits: actual.unknownCredits, rows: short(actual), rowsCurrent: short(current), appliesNote: picked?.rule.appliesNote ?? '', creditTableOnly: !!picked?.rule.creditTableOnly };
}

// ------------------------------------------------------------ 장학금

export type RecruitState = 'open' | 'closed' | 'unknown';

export function scholarshipView(list: OfficialScholarship[], answers: Answers, today: string, minutes: number) {
  return list.map((s) => {
    const recruit: RecruitState = !s.deadline ? 'unknown' : isClosed(s, today, minutes) ? 'closed' : 'open';
    const e = eligibility(s, answers);
    return { id: s.id, recruit, verdict: e.verdict, unmet: e.unmet, unknown: e.unknown, judgedBySchool: e.judgedBySchool.length > 0 };
  });
}

// ------------------------------------------------------------ 후기 선호

export function prefScore(c: Pick<Candidate, 'course'>, prefs: Pref[], digests: Record<string, CourseDigest>): number {
  const d = digests[c.course.id];
  if (!d || d.count === 0) return 0;
  let s = 0;
  // 해당 선호의 근거가 있을 때만 반영. 도움돼요는 근거의 비중만 바꾸고 전체 수로 과목을 높이지 않는다
  const ratio = (a?: { mentioned: number; denied: number; mentionedWeight?: number; deniedWeight?: number }) => {
    if (!a || a.mentioned + a.denied === 0) return null;
    const yes = a.mentionedWeight ?? a.mentioned;
    const no = a.deniedWeight ?? a.denied;
    return yes / (yes + no);
  };
  const sample = d.smallSample ? 0.5 : 1;
  for (const p of prefs) {
    if (p === 'lowWorkload' && d.workload) s += (3 - (d.weighted?.workload ?? d.workload.avg)) * (d.workload.mixed ? 1 : 2) * sample;
    if (p === 'lowDifficulty' && d.difficulty) s += (3 - (d.weighted?.difficulty ?? d.difficulty.avg)) * (d.difficulty.mixed ? 1 : 2) * sample;
    if (p === 'project') {
      const r = ratio(d.aspects.project);
      if (r != null) s += 4 * r * sample;
    }
    if (p === 'fewPresentations') {
      const r = ratio(d.aspects.presentation);
      if (r != null) s += 3 * (1 - 2 * r) * sample;
    }
  }
  return s;
}

/** 이 과목에서 선호와 관련된 근거가 있는지. 없으면 '확인할 후기 정보 없음' */
export function prefEvidence(d: CourseDigest | undefined, prefs: Pref[]): Record<string, 'has' | 'none'> {
  const out: Record<string, 'has' | 'none'> = {};
  for (const p of prefs) {
    if (!d || d.count === 0) out[p] = 'none';
    else if (p === 'lowWorkload') out[p] = d.workload ? 'has' : 'none';
    else if (p === 'lowDifficulty') out[p] = d.difficulty ? 'has' : 'none';
    else if (p === 'project') out[p] = (d.aspects.project?.mentioned ?? 0) + (d.aspects.project?.denied ?? 0) > 0 ? 'has' : 'none';
    else out[p] = (d.aspects.presentation?.mentioned ?? 0) + (d.aspects.presentation?.denied ?? 0) > 0 ? 'has' : 'none';
  }
  return out;
}

// ------------------------------------------------------------ 계획

export interface PlanInput {
  od: Pick<OfficialData, 'courses' | 'calendar' | 'periods'>;
  target: AcademicPeriod;
  records: CourseRecord[];
  timetable: TimetableEntry[];
  admissionYear: number | null;
  grade: number | null;
  dept: string | null;
  rule: GradRule | null;
  digests: Record<string, CourseDigest>;
  shortCategories: string[];
  count?: number;
  /** 졸업 영역 변화 계산용 (직접 시간표 짜기) */
  picked?: { key: string; rule: GradRule } | null;
  /** 후기 집계를 받지 못했는지 */
  digestsFailed?: boolean;
}

/** 이 학생의 전공 필수만 필수로 본다. 교직·자격 과정의 필수 표시는 졸업 필수가 아니다 */
export const isRequired = (c: Candidate) => c.course.track === 'major' && (c.requirement === 'required' || c.requirement === 'required_tech' || c.requirement === 'required_math');
/** 대안에 넣을 묶음: 전공·기초교육, 외국어는 부족 영역을 채울 때만. 교직·유학생·GFBP 는 사용자가 직접 고른다 */
const inPlanPool = (c: Candidate, short: string[]) => c.course.track === 'major' || c.course.track === 'kiso' || (c.course.track === 'foreign' && !!c.fillsCategory && short.includes(c.fillsCategory));

export interface RequiredConflict {
  name: string;
  courseId: string;
  reason: 'blocked' | 'timetable' | 'clash';
  with?: string;
}

export interface PlanOutcome {
  plans: Plan[];
  usable: number;
  candidates: Record<string, Candidate>;
  forcedIds: string[];
  conflicts: RequiredConflict[];
  /** 조건을 하나 풀면 달라지는 것 */
  relax: { key: string; day?: number; period?: number; usableAfter: number; resolves: number }[];
  /** 추천 후보를 찾지 못한 이유 */
  empty: boolean;
}

/** 공식 조건·필수 과목 검사까지 (후기 선호보다 먼저). 채팅과 직접 시간표 짜기가 같은 판정을 쓴다 */
export function preparePlan(input: PlanInput, cond: PlanConditions) {
  const blocked = new Set<string>();
  for (const d of cond.excludeWeekdays) for (let p = 1; p <= 7; p++) blocked.add(`${d}-${p}`);
  for (const p of cond.avoidPeriods) for (let d = 0; d <= 5; d++) blocked.add(`${d}-${p}`);
  const lunch = cond.lunch ? LUNCH : null;
  const all = buildCandidates({
    courses: coursesForDept(input.od.courses as OfficialCourse[], input.dept),
    dept: input.dept,
    rule: input.rule,
    dataYear: input.od.calendar.year,
    target: input.target,
    records: input.records,
    timetable: input.timetable,
    admissionYear: input.admissionYear,
    grade: input.grade,
    blocked,
    lunch,
    periodTimes: input.od.periods.items,
    interests: [],
    reviewCounts: Object.fromEntries(Object.entries(input.digests).map(([k, d]) => [k, d.realCount])),
  });
  // 윗 학년 배당 과목은 후보에서 뺀다 (필수 조건을 후기 선호보다 먼저 본다)
  const eligible = all.filter((c) => !c.excluded && c.gradeFit !== 'higher_year' && inPlanPool(c, input.shortCategories));
  const fixed = input.timetable.filter((e) => entryInPeriod(e, input.target) !== 'no');
  const conflicts: RequiredConflict[] = [];
  const forced: Candidate[] = [];
  if (cond.keepRequired) {
    const byName = new Map<string, Candidate[]>();
    eligible.filter(isRequired).forEach((c) => byName.set(c.course.name, [...(byName.get(c.course.name) ?? []), c]));
    const occupied = new Set(fixed.map((f) => `${f.weekday}-${f.period}`));
    // 이미 시간표에 있는 과목은 buildCandidates 가 제외하므로 여기 오지 않는다 (자기 자신과 충돌로 나오지 않음)
    for (const [name, list] of byName) {
      const free = list.find((c) => !c.blocked && c.conflicts.length === 0 && !c.course.meetings.some((m) => occupied.has(`${m.weekday}-${m.period}`)));
      if (free) {
        forced.push(free);
        free.course.meetings.forEach((m) => occupied.add(`${m.weekday}-${m.period}`));
        continue;
      }
      const sample = list[0];
      conflicts.push({ name, courseId: sample.course.id, reason: list.every((c) => c.blocked) ? 'blocked' : sample.conflicts.length ? 'timetable' : 'clash', with: sample.conflicts[0] });
    }
  }
  const pool = cond.needOnly ? eligible.filter((c) => c.fillsCategory && input.shortCategories.includes(c.fillsCategory)) : eligible;
  return { all, eligible, forced, conflicts, fixed, pool, lunch, blocked };
}

function runPlan(input: PlanInput, cond: PlanConditions) {
  const { all, eligible, forced, conflicts, fixed, pool, lunch } = preparePlan(input, cond);
  const priorities: Priority[] = ['requirement', ...(cond.fewerDays ? (['fewerDays'] as const) : []), ...(cond.minimizeGaps ? (['fewerGaps'] as const) : []), ...(cond.lunch ? (['lunch'] as const) : [])];
  const res = generatePlans(pool, fixed, input.count ?? 4, priorities, input.od.periods.items, lunch, forced, cond.creditGoal, (c) => prefScore(c, cond.prefs, input.digests) + (c.fillsCategory && input.shortCategories.includes(c.fillsCategory) ? 1 : 0));
  return { all, eligible, forced, conflicts, res };
}

export function planFromConditions(input: PlanInput, cond: PlanConditions): PlanOutcome {
  const r = runPlan(input, cond);
  const candidates: Record<string, Candidate> = {};
  r.all.forEach((c) => (candidates[c.course.id] = c));
  const relax: PlanOutcome['relax'] = [];
  // 충돌이 있거나 대안이 없을 때만 완화안을 계산한다
  if (r.conflicts.length || r.res.plans.length === 0) {
    const tryOff = (key: string, patch: Partial<PlanConditions>, extra: { day?: number; period?: number } = {}) => {
      const o = runPlan(input, { ...cond, ...patch });
      relax.push({ key, ...extra, usableAfter: o.res.usable, resolves: r.conflicts.length - o.conflicts.length });
    };
    cond.excludeWeekdays.forEach((d) => tryOff('day', { excludeWeekdays: cond.excludeWeekdays.filter((x) => x !== d) }, { day: d }));
    cond.avoidPeriods.forEach((p) => tryOff('period', { avoidPeriods: cond.avoidPeriods.filter((x) => x !== p) }, { period: p }));
    if (cond.keepRequired) tryOff('keepRequired', { keepRequired: false });
    if (cond.needOnly) tryOff('needOnly', { needOnly: false });
    if (cond.lunch) tryOff('lunch', { lunch: false });
  }
  return { plans: r.res.plans, usable: r.res.usable, candidates, forcedIds: r.forced.map((c) => c.course.id), conflicts: r.conflicts, relax, empty: r.res.plans.length === 0 };
}

/** 계산 결과 버전: 설명·카드·시간표가 같은 계산을 보는지 비교한다 */
export function planFingerprint(o: Pick<PlanOutcome, 'plans' | 'conflicts'>) {
  return JSON.stringify({ p: o.plans.map((p) => [p.courseIds, p.creditsKnown, p.metrics.days, p.metrics.gapMinutes]), c: o.conflicts.map((c) => [c.name, c.reason]) });
}

/** AI 문장의 학점·등교일·충돌 표현이 앱 계산과 다르면 true (문장을 보여 주지 않고 앱 기준으로 안내한다) */
export function planAnswerMismatch(answer: string, o: Pick<PlanOutcome, 'plans' | 'conflicts'>) {
  const text = answer.normalize('NFKC');
  const credits = new Set(o.plans.map((p) => p.creditsKnown));
  const days = new Set(o.plans.map((p) => p.metrics.days));
  for (const m of text.matchAll(/(\d{1,2})\s*(?:학점|単位)/g)) if (!credits.has(Number(m[1]))) return true;
  for (const m of text.matchAll(/(?:등교|수업일|登校|通学)[^\d]{0,8}(\d)\s*(?:일|日)|(\d)\s*(?:일|日)\s*(?:등교|登校|通学)/g)) if (!days.has(Number(m[1] ?? m[2]))) return true;
  if (o.conflicts.length && /(충돌|겹침|겹치는\s*(?:것|과목)|衝突|重複).{0,8}(없|ありません|なし|なく)/.test(text)) return true;
  if (!o.conflicts.length && /(필수|必修).{0,16}(충돌해|충돌이\s*있|衝突してい|衝突があ)/.test(text)) return true;
  return false;
}

/** 모델에게 넘기는 요약: 숫자는 앱 계산 그대로, 양을 줄인다 */
export function planForModel(o: PlanOutcome, digests: Record<string, CourseDigest>, prefs: Pref[]) {
  return {
    usableCandidates: o.usable,
    requiredConflicts: o.conflicts,
    relaxOptions: o.relax,
    plans: o.plans.map((p) => ({
      id: p.id,
      credits: p.creditsKnown,
      creditsUnknown: p.creditsUnknown,
      days: p.metrics.days,
      gapMinutes: p.metrics.gapMinutes,
      courses: p.courseIds.map((id) => {
        const c = o.candidates[id];
        const d = digests[id];
        return { id, name: c?.course.name, requirement: c?.requirement, fills: c?.fillsCategory, credits: c?.credits, review: d && d.count ? { n: d.count, demo: d.demoCount > 0, workload: d.workload, difficulty: d.difficulty, smallSample: d.smallSample } : null, prefEvidence: prefEvidence(d, prefs) };
      }),
    })),
  };
}
