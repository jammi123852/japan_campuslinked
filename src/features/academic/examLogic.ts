/**
 * 내 시간표 ↔ 공식 시험표 대조 (순수 함수). 과목명만으로 확정하지 않는다:
 * 공식 강의(분반)와 연결된 수업은 과목명 + 교원 성 + 시험표 'クラス'(수업 요일·교시)가 모두 맞아야 '일치'.
 */
import type { TimetableEntry } from '../../data/types';
import type { OfficialCourse, OfficialExam, Quarter } from '../official/types';

const DAY_KANJI = ['月', '火', '水', '木', '金', '土', '日'];
const norm = (s: string) => s.normalize('NFKC').replace(/^[□△▲＊*※○〇◎◇]+/, '').replace(/\s+/g, '').toLowerCase();

/** 수업 요일·교시를 시험표 'クラス' 표기로 (예: 月4/水4) */
export const slotOf = (meetings: { weekday: number; period: number }[]) =>
  [...meetings].sort((a, b) => a.weekday - b.weekday || a.period - b.period).map((m) => `${DAY_KANJI[m.weekday]}${m.period}`).join('/');

export type ExamMatchStatus = 'matched' | 'multiple' | 'needs_check' | 'not_found' | 'out_of_scope';

export interface ExamMatch {
  key: string;
  courseName: string;
  officialId: string | null;
  status: ExamMatchStatus;
  exams: OfficialExam[];
}

export function matchExams(entries: TimetableEntry[], courses: OfficialCourse[], exams: OfficialExam[], quarter: Quarter): ExamMatch[] {
  const groups = new Map<string, { name: string; official: OfficialCourse | null }>();
  for (const e of entries) {
    const oc = e.lectureId ? courses.find((c) => c.id === e.lectureId) ?? null : null;
    const k = oc ? oc.id : `name:${norm(e.courseName)}`;
    if (!groups.has(k)) groups.set(k, { name: oc?.name ?? e.courseName, official: oc });
  }
  return [...groups.entries()].map(([key, g]) => {
    const byName = exams.filter((x) => x.quarter === quarter && norm(x.name) === norm(g.name));
    if (g.official && !g.official.quarters.includes(quarter)) return { key, courseName: g.name, officialId: g.official.id, status: 'out_of_scope', exams: [] };
    if (!g.official) {
      // 직접 입력·사진 인식 수업은 분반·교원을 모르므로 후보만 보여 주고 확정하지 않는다
      return { key, courseName: g.name, officialId: null, status: byName.length ? 'needs_check' : 'not_found', exams: byName };
    }
    const c = g.official;
    const surname = (c.instructor ?? '').replace(/他$/, '').replace(/\s+/g, '');
    const slot = slotOf(c.meetings);
    const strict = byName.filter((x) => x.offeringId === c.id || (surname && x.instructor.replace(/\s+/g, '').startsWith(surname) && x.slots.includes(slot)));
    const status: ExamMatchStatus = strict.length === 1 ? 'matched' : strict.length > 1 ? 'multiple' : byName.length ? 'needs_check' : 'not_found';
    return { key, courseName: g.name, officialId: c.id, status, exams: strict.length ? strict : byName };
  });
}
