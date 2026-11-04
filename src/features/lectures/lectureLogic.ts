/**
 * 강의 검색·필터와 시간표 추가 판정 (순수 함수, Node 에서 바로 테스트).
 * 타입만 import 하므로 런타임 의존성이 없다.
 */
import type { AttendanceMethod, Lecture } from '../../data/lectures';
import type { TimetableEntry } from '../../data/types';

export interface LectureFilters {
  query: string;
  facultyId: string | null;
  grade: number | null;
  weekday: number | null;
  attendance: AttendanceMethod | null;
}

export const EMPTY_FILTERS: LectureFilters = { query: '', facultyId: null, grade: null, weekday: null, attendance: null };

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

/** 과목명(한·일)·교수 표시명(한·일)·키워드에 검색어가 포함되고, 모든 필터를 동시에 만족하는 강의 */
export function searchLectures(list: Lecture[], f: LectureFilters): Lecture[] {
  const q = norm(f.query);
  return list.filter((l) => {
    if (q) {
      const hay = [l.name.ko, l.name.ja, l.instructor.ko, l.instructor.ja, ...l.keywords].map(norm);
      if (!hay.some((h) => h.includes(q))) return false;
    }
    if (f.facultyId && l.facultyId !== f.facultyId) return false;
    if (f.grade != null && !l.grades.includes(f.grade)) return false;
    if (f.weekday != null && !l.meetings.some((m) => m.weekday === f.weekday)) return false;
    if (f.attendance && l.attendance !== f.attendance) return false;
    return true;
  });
}

export function hasActiveFilters(f: LectureFilters) {
  return f.query.trim() !== '' || f.facultyId != null || f.grade != null || f.weekday != null || f.attendance != null;
}

export type AddCheck =
  | { kind: 'ok' }
  | { kind: 'duplicate' }
  | { kind: 'conflict'; conflicts: { weekday: number; period: number; courseName: string }[] };

/**
 * 시간표에 강의를 넣어도 되는지 판정.
 * - 같은 강의(lectureId)가 이미 있으면 duplicate
 * - 같은 요일·교시에 다른 수업이 있으면 conflict (기존 수업을 덮어쓰지 않는다)
 */
export function checkAddLecture(lecture: Lecture, timetable: TimetableEntry[]): AddCheck {
  if (timetable.some((e) => e.lectureId === lecture.id)) return { kind: 'duplicate' };
  const conflicts = lecture.meetings.flatMap((m) =>
    timetable
      .filter((e) => e.weekday === m.weekday && e.period === m.period)
      .map((e) => ({ weekday: m.weekday, period: m.period, courseName: e.courseName })),
  );
  return conflicts.length > 0 ? { kind: 'conflict', conflicts } : { kind: 'ok' };
}

/** 강의의 각 수업 시간을 시간표 항목으로 변환 (요일·교시마다 한 칸) */
export function lectureToEntries(lecture: Lecture, courseName: string, makeId: () => string): TimetableEntry[] {
  return lecture.meetings.map((m) => ({
    id: makeId(),
    lectureId: lecture.id,
    courseName,
    weekday: m.weekday,
    period: m.period,
    room: lecture.room,
    source: { kind: 'demo', note: 'lecture-catalog' },
  }));
}
