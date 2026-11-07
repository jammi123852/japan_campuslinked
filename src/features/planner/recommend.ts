/**
 * 부족 영역을 채울 과목 후보 (순수 함수).
 * 순서: 부족 영역 → 이 학생에게 인정될 수 있는 실제 과목 → 입학연도·수강조건 → 시간표 충돌 → 관심·막아 둔 시간.
 * 인정 영역을 확인하지 못한 과목은 '적합'이라 하지 않는다 (목록에 넣지 않음).
 */
import type { TimetableEntry } from '../../data/types';
import { entryInPeriod, type AcademicPeriod } from '../academic/academicLogic';
import { courseCohort, quartersKnown, suggestCategory } from '../official/courseLogic';
import type { GradRule, OfficialCourse } from '../official/types';
import type { CourseRecord } from '../records/gradLogic';

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

export interface Recommendation {
  course: OfficialCourse;
  category: string;
  cohort: boolean | null;
  prereq: string | null;
  conflicts: string[];
  interestHits: string[];
}

export function recommendForShort(input: {
  courses: OfficialCourse[];
  rule: GradRule;
  shortCategories: string[];
  records: CourseRecord[];
  timetable: TimetableEntry[];
  target: AcademicPeriod;
  admissionYear: number | null;
  dept: string | null;
  interests: string[];
  blocked?: Set<string>;
  perCategory?: number;
}): Record<string, Recommendation[]> {
  const inPeriod = input.timetable.filter((e) => entryInPeriod(e, input.target) !== 'no');
  const taken = new Set(input.records.filter((r) => r.status === 'passed' || r.status === 'enrolled' || r.status === 'planned').flatMap((r) => [r.officialId ?? '', norm(r.name), r.code ?? '']).filter(Boolean));
  const kws = input.interests.map(norm).filter(Boolean);
  const out: Record<string, Recommendation[]> = {};
  for (const category of input.shortCategories) {
    const rows: Recommendation[] = [];
    for (const c of input.courses) {
      if (!quartersKnown(c) || !c.quarters.includes(input.target.quarter) || c.offTimetable || !c.meetings.length) continue;
      if (suggestCategory(c, input.rule) !== category) continue;
      if (taken.has(c.id) || taken.has(norm(c.name)) || (c.code && taken.has(c.code))) continue;
      const cohort = courseCohort(c, input.admissionYear, input.dept);
      if (cohort === false) continue;
      if (input.blocked && c.meetings.some((m) => input.blocked!.has(`${m.weekday}-${m.period}`))) continue;
      const conflicts = c.meetings.flatMap((m) => inPeriod.filter((e) => e.weekday === m.weekday && e.period === m.period).map((e) => e.courseName));
      rows.push({ course: c, category, cohort, prereq: c.prereq ?? null, conflicts: [...new Set(conflicts)], interestHits: kws.filter((k) => norm(c.name).includes(k)) });
    }
    rows.sort((a, b) => a.conflicts.length - b.conflicts.length || b.interestHits.length - a.interestHits.length || (a.prereq ? 1 : 0) - (b.prereq ? 1 : 0) || a.course.name.localeCompare(b.course.name));
    out[category] = rows.slice(0, input.perCategory ?? 6);
  }
  return out;
}
