/**
 * 학년도·쿼터와 공식 강의 연결 (순수 함수, Node 에서 바로 테스트).
 * - 쿼터 기간은 공식 학년력(F001)에서 온 값만 쓰고, 없으면 '현재 쿼터'를 추측하지 않는다.
 * - 시간표 항목의 적용 기간(term)이 없으면 '기간 미지정'으로 보존한다(기존 데이터).
 */
import { courseCohort, quartersForEntry } from '../official/courseLogic';
import type { TimetableEntry } from '../../data/types';
import { diffDays } from '../../lib/dates';
import type { OfficialCourse, OfficialData, Quarter } from '../official/types';

export interface AcademicPeriod {
  year: number;
  quarter: Quarter;
}

export const periodKey = (p: AcademicPeriod) => `${p.year}-${p.quarter}`;
export const QUARTER_TERM: Record<Quarter, '前期' | '後期'> = { '1Q': '前期', '2Q': '前期', '3Q': '後期', '4Q': '後期' };

/**
 * 오늘이 속한 쿼터. 수업 기간 사이(시험·방학)면 다음 쿼터를 inSession=false 로 돌려준다.
 * 학년력에 없는 날짜면 null (추측하지 않음).
 */
export function currentPeriod(cal: OfficialData['calendar'] | undefined, today: string): { period: AcademicPeriod; inSession: boolean } | null {
  if (!cal) return null;
  for (const q of cal.quarters) {
    if (diffDays(q.start, today) >= 0 && diffDays(today, q.end) >= 0) return { period: { year: cal.year, quarter: q.q }, inSession: true };
  }
  const next = cal.quarters.find((q) => diffDays(today, q.start) > 0);
  return next ? { period: { year: cal.year, quarter: next.q }, inSession: false } : null;
}

/** 이 시간표 항목이 선택한 기간에 해당하는지. 기간 미지정이면 'unclassified' */
export function entryInPeriod(e: Pick<TimetableEntry, 'term'>, p: AcademicPeriod): 'yes' | 'no' | 'unclassified' {
  if (!e.term) return 'unclassified';
  return e.term.year === p.year && e.term.quarters.includes(p.quarter) ? 'yes' : 'no';
}

/** 선택 기간에 보일 항목: 해당 기간 + 기간 미지정(표시는 따로) */
export function entriesForPeriod(list: TimetableEntry[], p: AcademicPeriod) {
  return list.filter((e) => entryInPeriod(e, p) !== 'no');
}

/**
 * 선택 기간의 시간표 초기화. 그 기간에 보이는 수업만 없앤다: 기간 미지정 수업은 함께 지우고,
 * 여러 쿼터에 걸친 수업은 이 쿼터만 빼서 다른 쿼터에는 남긴다.
 */
export function removeFromPeriod(list: TimetableEntry[], p: AcademicPeriod): TimetableEntry[] {
  return list.flatMap((e) => {
    const state = entryInPeriod(e, p);
    if (state === 'no') return [e];
    if (state === 'unclassified' || !e.term) return [];
    const quarters = e.term.quarters.filter((q) => q !== p.quarter);
    return quarters.length ? [{ ...e, term: { ...e.term, quarters } }] : [];
  });
}

/** 입학연도 표기(17RS以降 / 17-24RS / 26RSのみ / 25RS以降/17-24RS)가 이 입학연도에 해당하는지. 읽을 수 없으면 null */
export function cohortApplies(cohort: string, admissionYear: number | null | undefined): boolean | null {
  if (!admissionYear) return null;
  const yy = admissionYear % 100;
  const parts = cohort.split(/[/／・]/).map((s) => s.trim()).filter(Boolean);
  let understood = false;
  for (const part of parts) {
    let m = /^(\d{2})RS以降$/.exec(part);
    if (m) {
      understood = true;
      if (yy >= Number(m[1])) return true;
      continue;
    }
    m = /^(\d{2})-(\d{2})RS$/.exec(part);
    if (m) {
      understood = true;
      if (yy >= Number(m[1]) && yy <= Number(m[2])) return true;
      continue;
    }
    // '25RS' (입학 연도 하나만 적힌 표기, 예: '25RS/17-24RS' 를 연도별로 나눈 값)
    m = /^(\d{2})RS(?:のみ)?$/.exec(part);
    if (m) {
      understood = true;
      if (yy === Number(m[1])) return true;
      continue;
    }
  }
  return understood ? false : null;
}

/** 공식 강의 → 시간표 항목 (쿼터·연도 기간 포함, 교시 시각은 공식 수업 시간) */
export function officialToEntries(
  c: OfficialCourse,
  year: number,
  periods: { period: number; start: string; end: string }[],
  newId: () => string,
): TimetableEntry[] {
  return c.meetings.map((m) => {
    const time = periods.find((p) => p.period === m.period);
    return {
      id: newId(),
      lectureId: c.id,
      courseName: c.name,
      weekday: m.weekday,
      period: m.period,
      startTime: time?.start,
      endTime: time?.end,
      room: c.rooms.join(', ') || undefined,
      memo: [c.section ? `[${c.section}]` : '', c.instructor ?? ''].join(' ').trim() || undefined,
      term: { year, quarters: quartersForEntry(c).quarters },
      ...(quartersForEntry(c).assumed ? { needsRecheck: true } : {}),
      source: { kind: 'official_public', verification: 'needs_review', note: `${c.source?.id ?? ''} p${c.source?.page ?? ''}` },
    };
  });
}

/** 두 기간이 겹치는지 (기간 미지정은 겹칠 수 있다고 본다) */
function termsOverlap(a: TimetableEntry['term'], b: TimetableEntry['term']) {
  if (!a || !b) return true;
  return a.year === b.year && a.quarters.some((q) => b.quarters.includes(q));
}

export type AddOfficialCheck =
  | { kind: 'ok' }
  | { kind: 'duplicate' }
  | { kind: 'conflict'; conflicts: { weekday: number; period: number; courseName: string; unclassified: boolean }[] };

/** 이미 넣은 강의면 duplicate, 같은 기간·요일·교시에 다른 수업이 있으면 conflict (다른 쿼터끼리는 충돌 아님) */
export function checkAddOfficial(c: OfficialCourse, year: number, entries: TimetableEntry[]): AddOfficialCheck {
  if (entries.some((e) => e.lectureId === c.id)) return { kind: 'duplicate' };
  const term = { year, quarters: c.quarters };
  const conflicts = c.meetings.flatMap((m) =>
    entries
      .filter((e) => e.weekday === m.weekday && e.period === m.period && termsOverlap(e.term, term))
      .map((e) => ({ weekday: m.weekday, period: m.period, courseName: e.courseName, unclassified: !e.term })),
  );
  return conflicts.length ? { kind: 'conflict', conflicts } : { kind: 'ok' };
}

/** 이전 기간 시간표를 새 기간으로 복사 (개설 여부 재확인 필요 표시). 원본은 그대로 둔다 */
export function copyToPeriod(list: TimetableEntry[], from: AcademicPeriod, to: AcademicPeriod, newId: () => string): TimetableEntry[] {
  return list
    .filter((e) => entryInPeriod(e, from) === 'yes')
    .map((e) => ({ ...e, id: newId(), term: { year: to.year, quarters: [to.quarter] }, needsRecheck: true }));
}

export interface OfficialFilters {
  query: string;
  term: '前期' | '後期' | null;
  year: number | null;
  weekday: number | null;
  mark: 'required_any' | 'elective' | null;
  /** 학과 코드 (null=전체) */
  dept?: string | null;
  track?: string | null;
  /** 입학연도 표기와 맞는 것만 (표기 없음은 남긴다) */
  cohortYear?: number | null;
}

export const EMPTY_OFFICIAL_FILTERS: OfficialFilters = { query: '', term: null, year: null, weekday: null, mark: null, dept: null, track: null, cohortYear: null };

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

/** 과목명·교원·분반·과목코드(강의계획서 확인분) 검색 + 필터 동시 적용 */
export function searchOfficial(list: OfficialCourse[], f: OfficialFilters): OfficialCourse[] {
  const q = norm(f.query);
  return list.filter((c) => {
    if (q) {
      const hay = [c.name, c.subjectName ?? '', c.instructor ?? '', c.section ?? '', c.code ?? c.syllabus?.code ?? ''].map(norm);
      if (!hay.some((h) => h.includes(q))) return false;
    }
    if (f.term && c.term !== f.term) return false;
    if (f.year != null && c.year !== f.year) return false;
    if (f.weekday != null && !c.meetings.some((m) => m.weekday === f.weekday)) return false;
    if (f.mark === 'required_any' && (!c.mark || c.mark === 'elective')) return false;
    if (f.mark === 'elective' && c.mark && c.mark !== 'elective') return false;
    if (f.track && c.track !== f.track) return false;
    if (f.dept && !(c.depts ?? []).includes(f.dept) && !['kiso', 'foreign', 'teaching', 'intl'].includes(c.track ?? '')) return false;
    if (f.cohortYear && courseCohort(c, f.cohortYear, f.dept) === false) return false;
    return true;
  });
}
