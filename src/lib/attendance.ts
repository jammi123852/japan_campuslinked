import type { AttendanceRecord, AttendanceRule } from '@/data/types';

import { addDays, diffDays, weekdayOf } from './dates';

export type AttendanceRisk = 'unknown' | 'ok' | 'caution' | 'danger';

export interface AttendanceSummary {
  /** 과목 키 (courseKey, 없으면 courseName) */
  key: string;
  courseName: string;
  /** 기록한 수업 수 (출석률의 분모) */
  recorded: number;
  present: number;
  late: number;
  absent: number;
  /** 記録済み回数に対する出席率(遅刻は換算ルールに従う)。記録0件なら null */
  rate: number | null;
  risk: AttendanceRisk;
  /** 基準を満たすためにあと何回欠席できるか(基準・総回数が未設定なら null) */
  remainingAbsences: number | null;
  /** 本人入力のみから計算した場合 true(=公式記録ではなく推定値) */
  isEstimate: boolean;
}

/**
 * 科目ごとの出席状況を計算する。
 * 基準(minRate)は科目ごとに設定された値のみ使い、全科目共通の基準は仮定しない。
 */
export function summarizeAttendance(
  records: AttendanceRecord[],
  rules: AttendanceRule[],
): AttendanceSummary[] {
  const byCourse = new Map<string, AttendanceRecord[]>();
  for (const r of records) {
    const k = recordKey(r);
    const list = byCourse.get(k) ?? [];
    list.push(r);
    byCourse.set(k, list);
  }

  return [...byCourse.entries()].map(([key, list]) => {
    const rule = rules.find((x) => (x.courseKey ?? x.courseName) === key);
    // 가장 최근 기록의 과목명
    const courseName = [...list].sort((a, b) => b.date.localeCompare(a.date))[0].courseName;
    const present = list.filter((r) => r.mark === 'present').length;
    const late = list.filter((r) => r.mark === 'late').length;
    const rawAbsent = list.filter((r) => r.mark === 'absent').length;

    const lateAsAbsence =
      rule?.lateCountsAsAbsence && rule.lateCountsAsAbsence > 0
        ? Math.floor(late / rule.lateCountsAsAbsence)
        : 0;
    const absent = rawAbsent + lateAsAbsence;
    const recorded = list.length;
    const rate = recorded > 0 ? (recorded - absent) / recorded : null;

    let risk: AttendanceRisk = 'unknown';
    let remainingAbsences: number | null = null;
    if (rule?.minRate != null && rule.totalSessions != null && rule.totalSessions > 0) {
      const maxAbsences = Math.floor(rule.totalSessions * (1 - rule.minRate) + 1e-9);
      remainingAbsences = maxAbsences - absent;
      risk = remainingAbsences < 0 ? 'danger' : remainingAbsences <= 1 ? 'caution' : 'ok';
    }

    return {
      key,
      courseName,
      recorded,
      present,
      late,
      absent,
      rate,
      risk,
      remainingAbsences,
      isEstimate: list.every((r) => r.source.kind !== 'kslife'),
    };
  });
}

export const recordKey = (r: Pick<AttendanceRecord, 'courseKey' | 'courseName'>) => r.courseKey ?? r.courseName;

/**
 * 미기록 수업 날짜: from ~ to(포함) 사이에서 수업 요일인데 기록이 없는 날.
 * 미래 날짜는 넣지 않으며(to 는 오늘 이하로 넘긴다), 미기록을 결석으로 바꾸지 않는다 — 개수만 따로 보여 준다.
 */
export function unrecordedDates(weekdays: number[], recordedDates: Iterable<string>, from: string, to: string): string[] {
  const done = new Set(recordedDates);
  const out: string[] = [];
  if (weekdays.length === 0 || diffDays(from, to) < 0) return out;
  for (let d = from; diffDays(d, to) >= 0; d = addDays(d, 1)) {
    if (weekdays.includes(weekdayOf(d)) && !done.has(d)) out.push(d);
  }
  return out;
}
