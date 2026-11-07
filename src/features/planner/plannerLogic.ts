/**
 * 수강 계획: 후보 근거·시간표 대안·지표 계산 (순수 함수, Node 에서 바로 테스트).
 *
 * 프로그램이 정하는 것: 개설 여부(2026 시간표에 있는지)·대상 입학연도·학년·충돌·막아 둔 시간·점심·공강·등교일·학점 합계.
 * 정하지 않는 것: 인정 영역(미분류로 둠)·선수조건 충족(자료가 있으면 표시만)·과제 부담(자료 없음 → 계산하지 않음).
 * 하나의 종합 점수로 줄이지 않고 근거를 항목별로 돌려준다.
 */
import type { TimetableEntry } from '../../data/types';
import { cohortApplies, entryInPeriod, type AcademicPeriod } from '../academic/academicLogic';
import { courseCohort, quartersKnown, suggestCategory } from '../official/courseLogic';
import type { GradRule, OfficialCourse } from '../official/types';
import type { CourseRecord } from '../records/gradLogic';

export type Priority = 'requirement' | 'interest' | 'fewerDays' | 'fewerGaps' | 'lunch' | 'spreadLoad';
export const PRIORITIES: Priority[] = ['requirement', 'interest', 'fewerDays', 'fewerGaps', 'lunch', 'spreadLoad'];
/** 지금 자료로 계산할 수 없는 기준 (화면에서 '판단 자료 없음'으로 표시) */
export const UNCOMPUTABLE: Priority[] = ['spreadLoad'];

export interface TimeRange {
  start: string;
  end: string;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const slotKey = (weekday: number, period: number) => `${weekday}-${period}`;
const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

export interface Candidate {
  course: OfficialCourse;
  /** 이 계획 기간에 2026 시간표상 개설 확인 (다른 학년도면 교육과정상 후보일 뿐) */
  offered: 'confirmed' | 'not_confirmed';
  requirement: 'required' | 'required_tech' | 'required_math' | 'selective' | 'elective' | 'unmarked';
  /** 부족 영역을 채울 수 있다고 제안된 영역 (제안일 뿐, 확정 아님) */
  fillsCategory: string | null;
  /** 같은 과목을 이미 이수했거나 듣고 있는지 */
  taken: boolean;
  cohort: boolean | null;
  gradeFit: 'ok' | 'higher_year' | 'unknown';
  prerequisite: string | null;
  hasSyllabus: boolean;
  credits: number | null;
  /** 공유 서버에 연결된 실제 학생 후기 수 (샘플 후기는 세지 않음) */
  realReviews: number;
  conflicts: string[];
  blocked: boolean;
  lunchHit: boolean;
  interestHits: string[];
  /** 후보에서 빼는 이유 (있으면 추천하지 않음) */
  excluded: 'taken' | 'cohort' | 'in_timetable' | 'quarter_unknown' | null;
}

export function buildCandidates(input: {
  courses: OfficialCourse[];
  dataYear: number;
  target: AcademicPeriod;
  records: CourseRecord[];
  timetable: TimetableEntry[];
  admissionYear: number | null;
  grade: number | null;
  blocked: Set<string>;
  lunch: TimeRange | null;
  periodTimes: { period: number; start: string; end: string }[];
  interests: string[];
  reviewCounts?: Record<string, number>;
  /** 학과 코드: 이 학과의 입학연도 표기를 먼저 본다 */
  dept?: string | null;
  /** 이 학생에게 적용되는 졸업 규칙 (인정 영역 제안용) */
  rule?: GradRule | null;
}): Candidate[] {
  const inPeriod = input.timetable.filter((e) => entryInPeriod(e, input.target) !== 'no');
  const takenNames = new Set(input.records.filter((r) => r.status === 'passed' || r.status === 'enrolled').map((r) => norm(r.name)));
  const keywords = input.interests.map(norm).filter(Boolean);
  return input.courses
    // 쿼터가 확인되지 않은 분반은 같은 학기면 후보에 올리되 '쿼터 확인 필요'로 추천·대안 계산에서 뺀다
    .filter((c) => c.quarters.includes(input.target.quarter) || (!quartersKnown(c) && c.term === (input.target.quarter <= '2Q' ? '前期' : '後期')))
    .map((c) => {
      const conflicts = c.meetings.flatMap((m) => inPeriod.filter((e) => e.weekday === m.weekday && e.period === m.period && e.lectureId !== c.id).map((e) => e.courseName));
      const lunchHit = !!input.lunch && c.meetings.some((m) => overlapsLunch(m.period, input.periodTimes, input.lunch!));
      const taken = takenNames.has(norm(c.name));
      const cohort = c.cohortRanges ? courseCohort(c, input.admissionYear, input.dept) : cohortApplies(c.cohort, input.admissionYear);
      // 같은 과목의 다른 분반이 이미 시간표에 있어도 중복 등록으로 본다 (자기 자신과 겹친다고 판정하지 않음)
      const inTimetable = inPeriod.some((e) => e.lectureId === c.id || norm(e.courseName) === norm(c.name));
      return {
        course: c,
        offered: input.target.year === input.dataYear ? 'confirmed' : 'not_confirmed',
        requirement: c.mark ?? 'unmarked',
        taken,
        cohort,
        gradeFit: input.grade == null || !c.year ? 'unknown' : c.year <= input.grade ? 'ok' : 'higher_year',
        prerequisite: c.syllabus?.prerequisite ?? c.prereq ?? null,
        hasSyllabus: c.hasSyllabus ?? !!c.syllabus,
        credits: c.credits ?? c.syllabus?.credits ?? null,
        fillsCategory: suggestCategory(c, input.rule),
        realReviews: input.reviewCounts?.[c.id] ?? 0,
        conflicts: [...new Set(conflicts)],
        blocked: c.meetings.some((m) => input.blocked.has(slotKey(m.weekday, m.period))),
        lunchHit,
        interestHits: keywords.filter((k) => norm(c.name).includes(k)),
        excluded: taken ? 'taken' : cohort === false ? 'cohort' : inTimetable ? 'in_timetable' : !quartersKnown(c) || c.offTimetable ? 'quarter_unknown' : null,
      } satisfies Candidate;
    });
}

export function overlapsLunch(period: number, times: { period: number; start: string; end: string }[], lunch: TimeRange) {
  const t = times.find((p) => p.period === period);
  if (!t) return false;
  return toMin(t.start) < toMin(lunch.end) && toMin(lunch.start) < toMin(t.end);
}

export interface PlanMetrics {
  days: number;
  /** 수업 사이 빈 시간 합계(분). 이어지는 교시는 한 덩어리로 본다 */
  gapMinutes: number;
  /** 수업 사이에 비는 교시 수 (같은 날 수업과 수업 사이) */
  gapPeriods: number;
  /** 월~금 중 수업이 없는 날 수 */
  freeWeekdays: number;
  /** 가장 긴 연속 수업(교시 수) */
  maxConsecutive: number;
  lunchOkDays: number;
  lunchBadDays: number;
  /** 시각을 모르는 수업이 있으면 공강 계산이 부정확 */
  timesUnknown: boolean;
}

/** 한 기간 시간표의 지표. 같은 요일의 수업을 교시 순으로 묶어 계산 */
export function planMetrics(entries: { weekday: number; period: number }[], times: { period: number; start: string; end: string }[], lunch: TimeRange | null): PlanMetrics {
  const byDay = new Map<number, number[]>();
  for (const e of entries) byDay.set(e.weekday, [...new Set([...(byDay.get(e.weekday) ?? []), e.period])].sort((a, b) => a - b));
  let gap = 0;
  let gapPeriods = 0;
  let maxRun = 0;
  let ok = 0;
  let bad = 0;
  let unknown = false;
  for (const periods of byDay.values()) {
    let run = 1;
    for (let i = 1; i < periods.length; i++) {
      if (periods[i] === periods[i - 1] + 1) {
        run++;
      } else {
        gapPeriods += periods[i] - periods[i - 1] - 1;
        const prev = times.find((p) => p.period === periods[i - 1]);
        const next = times.find((p) => p.period === periods[i]);
        if (prev && next) gap += toMin(next.start) - toMin(prev.end);
        else unknown = true;
        run = 1;
      }
      maxRun = Math.max(maxRun, run);
    }
    maxRun = Math.max(maxRun, 1);
    if (lunch) {
      if (periods.some((p) => overlapsLunch(p, times, lunch))) bad++;
      else ok++;
    }
  }
  const freeWeekdays = [0, 1, 2, 3, 4].filter((d) => !byDay.has(d)).length;
  return { days: byDay.size, gapMinutes: gap, gapPeriods, freeWeekdays, maxConsecutive: byDay.size ? maxRun : 0, lunchOkDays: ok, lunchBadDays: bad, timesUnknown: unknown };
}

export interface Plan {
  id: string;
  strategy: Priority;
  courseIds: string[];
  metrics: PlanMetrics;
  creditsKnown: number;
  creditsUnknown: number;
  requiredCount: number;
}

/**
 * 후보 묶음에서 서로 겹치지 않는 대안을 만든다. 같은 결과의 대안은 하나로 합친다(억지로 3개를 만들지 않음).
 * 막아 둔 시간·충돌·제외 사유가 있는 후보는 어떤 대안에도 넣지 않는다.
 */
export function generatePlans(
  pool: Candidate[],
  fixed: { weekday: number; period: number }[],
  count: number,
  priorities: Priority[],
  times: { period: number; start: string; end: string }[],
  lunch: TimeRange | null,
  /** 사용자가 '대안에 꼭 넣기'로 고른 과목: 모든 대안에 먼저 넣고 나머지를 채운다 */
  forced: Candidate[] = [],
  /** 듣고 싶은 학점: 있으면 과목 수 대신 이 학점이 될 때까지 채운다 */
  creditGoal: number | null = null,
  /** 후기 선호 점수 (필수 조건을 통과한 후보의 순서에만 영향). 없으면 기존과 같다 */
  prefScore: ((c: Candidate) => number) | null = null,
): { plans: Plan[]; usable: number } {
  const forcedIds = new Set(forced.map((c) => c.course.id));
  const usable = pool.filter((c) => !forcedIds.has(c.course.id) && !c.excluded && !c.blocked && c.conflicts.length === 0 && !(priorities.includes('lunch') && c.lunchHit));
  const strategies = (priorities.filter((p) => !UNCOMPUTABLE.includes(p)).length ? priorities.filter((p) => !UNCOMPUTABLE.includes(p)) : ['requirement']) as Priority[];
  const fixedDays = new Set(fixed.map((f) => f.weekday));
  const plans: Plan[] = [];
  for (const strategy of strategies) {
    const chosen: Candidate[] = [...forced];
    const occupied = new Set([...fixed, ...forced.flatMap((c) => c.course.meetings)].map((f) => slotKey(f.weekday, f.period)));
    const remaining = [...usable];
    const credits = () => chosen.reduce((a, c) => a + (c.credits ?? 0), 0);
    while ((creditGoal ? credits() < creditGoal : chosen.length < count) && remaining.length) {
      const days = new Set([...fixedDays, ...chosen.flatMap((c) => c.course.meetings.map((m) => m.weekday))]);
      const score = (c: Candidate) => {
        const newDays = new Set(c.course.meetings.map((m) => m.weekday).filter((d) => !days.has(d))).size;
        const req = c.requirement === 'unmarked' ? 0 : 1;
        const interest = c.interestHits.length ? 1 : 0;
        const adj = c.course.meetings.filter((m) => occupied.has(slotKey(m.weekday, m.period - 1)) || occupied.has(slotKey(m.weekday, m.period + 1))).length;
        switch (strategy) {
          case 'requirement':
            return req * 100 + interest * 10 - newDays;
          case 'interest':
            return interest * 100 + req * 10 - newDays;
          case 'fewerDays':
            return -newDays * 100 + req * 10 + interest;
          case 'fewerGaps':
            return adj * 100 - newDays * 10 + req;
          case 'lunch':
            return (c.lunchHit ? -1000 : 0) + adj * 10 + req;
          default:
            return 0;
        }
      };
      const total = (c: Candidate) => score(c) + (prefScore ? prefScore(c) * 5 : 0);
      remaining.sort((a, b) => total(b) - total(a) || a.course.id.localeCompare(b.course.id));
      const pick = remaining.find((c) => c.course.meetings.every((m) => !occupied.has(slotKey(m.weekday, m.period))) && !chosen.some((x) => norm(x.course.name) === norm(c.course.name)));
      if (!pick) break;
      chosen.push(pick);
      pick.course.meetings.forEach((m) => occupied.add(slotKey(m.weekday, m.period)));
      remaining.splice(remaining.indexOf(pick), 1);
    }
    if (!chosen.length) continue;
    const ids = chosen.map((c) => c.course.id).sort();
    if (plans.some((p) => p.courseIds.join() === ids.join())) continue;
    const all = [...fixed, ...chosen.flatMap((c) => c.course.meetings)];
    plans.push({
      id: `${strategy}`,
      strategy,
      courseIds: ids,
      metrics: planMetrics(all, times, lunch),
      creditsKnown: chosen.reduce((a, c) => a + (c.credits ?? 0), 0),
      creditsUnknown: chosen.filter((c) => c.credits == null).length,
      requiredCount: chosen.filter((c) => c.requirement !== 'unmarked').length,
    });
  }
  return { plans, usable: usable.length };
}

export type PickDrop = 'clash' | 'lunch' | 'kiso' | 'sameCourse' | 'goal' | 'notNeed' | 'blocked';

/**
 * AI 가 고른 순서대로 과목을 넣되 규칙을 앱이 다시 확인한다 (AI 결과를 그대로 믿지 않음).
 * 겹침·막은 시간·점심·같은 과목·교양 개수·부족 요건·목표 학점을 지키지 못하는 과목은 이유와 함께 뺀다.
 */
export function applyPicks(
  order: Candidate[],
  fixed: { weekday: number; period: number }[],
  times: { period: number; start: string; end: string }[],
  opts: { lunch: TimeRange | null; creditGoal: number | null; kisoMax: number | null; needOnly: ((c: Candidate) => boolean) | null },
): { accepted: Candidate[]; dropped: { c: Candidate; why: PickDrop }[] } {
  const accepted: Candidate[] = [];
  const dropped: { c: Candidate; why: PickDrop }[] = [];
  const occupied = new Set(fixed.map((f) => slotKey(f.weekday, f.period)));
  let credits = 0;
  for (const c of order) {
    const why: PickDrop | null =
      opts.creditGoal && credits >= opts.creditGoal ? 'goal'
        : c.blocked ? 'blocked'
        : accepted.some((x) => norm(x.course.name) === norm(c.course.name)) ? 'sameCourse'
        : c.course.meetings.some((m) => occupied.has(slotKey(m.weekday, m.period))) ? 'clash'
        : opts.lunch && c.course.meetings.some((m) => overlapsLunch(m.period, times, opts.lunch!)) ? 'lunch'
        : opts.kisoMax != null && c.course.track === 'kiso' && accepted.filter((x) => x.course.track === 'kiso').length >= opts.kisoMax ? 'kiso'
        : opts.needOnly && !opts.needOnly(c) ? 'notNeed'
        : null;
    if (why) {
      dropped.push({ c, why });
      continue;
    }
    accepted.push(c);
    credits += c.credits ?? 0;
    c.course.meetings.forEach((m) => occupied.add(slotKey(m.weekday, m.period)));
  }
  return { accepted, dropped };
}
