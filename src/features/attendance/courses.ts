/**
 * 시간표 항목 → 출석·일정에서 쓰는 과목 목록 (순수 함수).
 * 강의 카탈로그에서 넣은 수업은 요일이 여러 개여도 한 과목('lec:<강의 id>'),
 * 직접 입력·사진 가져오기 수업은 칸마다 한 과목('tt:<항목 id>').
 */
import type { TimetableEntry } from '../../data/types';

export interface CourseRef {
  key: string;
  name: string;
  /** 수업 요일 (0=월) */
  weekdays: number[];
  periods: { weekday: number; period: number }[];
}

export const courseKeyOf = (e: Pick<TimetableEntry, 'id' | 'lectureId'>) => (e.lectureId ? `lec:${e.lectureId}` : `tt:${e.id}`);

export function timetableCourses(entries: TimetableEntry[]): CourseRef[] {
  const map = new Map<string, CourseRef>();
  for (const e of [...entries].sort((a, b) => a.weekday - b.weekday || a.period - b.period)) {
    const k = courseKeyOf(e);
    const c = map.get(k) ?? { key: k, name: e.courseName, weekdays: [], periods: [] };
    if (!c.weekdays.includes(e.weekday)) c.weekdays.push(e.weekday);
    c.periods.push({ weekday: e.weekday, period: e.period });
    map.set(k, c);
  }
  return [...map.values()];
}
