import { useEffect, useState } from 'react';

import type { AppSession, AttendanceMark, AttendanceRecord, AttendanceRule } from '@/data/types';
import { readJson, StorageKeys, writeJson } from '@/lib/storage';
import { createVersion } from '@/lib/storeVersion';

/**
 * 출석 메모 (이 기기에만 저장). 학교 공식 출결이 아니라 본인이 남기는 기록이다.
 * 과목은 이름이 아니라 courseKey(시간표 항목에서 만든 안정적인 키)로 묶는다.
 * 시간표에서 과목을 지우거나 이름을 바꿔도 기록은 지우지 않는다.
 * 한 과목은 하루에 기록 1개 (같은 날 다시 누르면 바꾼다).
 */
export interface AttendanceData {
  records: AttendanceRecord[];
  rules: AttendanceRule[];
}

const key = (s: AppSession) => StorageKeys.userData(s.userId, 'attendance');
const store = createVersion();
export const useAttendanceVersion = store.useVersion;

/** 한 번도 기록한 적 없으면 null (데모 홈은 이때만 샘플 출석을 보여 준다) */
export async function loadAttendance(session: AppSession): Promise<AttendanceData | null> {
  const raw = await readJson<Partial<AttendanceData>>(key(session));
  if (!raw) return null;
  return { records: Array.isArray(raw.records) ? raw.records : [], rules: Array.isArray(raw.rules) ? raw.rules : [] };
}

async function update(session: AppSession, fn: (d: AttendanceData) => AttendanceData) {
  const next = fn((await loadAttendance(session)) ?? { records: [], rules: [] });
  await writeJson(key(session), next);
  store.bump();
}

/** mark=null 이면 그날 기록 취소 */
export function setMark(session: AppSession, course: { key: string; name: string }, date: string, mark: AttendanceMark | null) {
  return update(session, (d) => {
    const records = d.records.filter((r) => !(r.courseKey === course.key && r.date === date));
    if (mark) records.push({ id: `${course.key}@${date}`, courseKey: course.key, courseName: course.name, date, mark, source: { kind: 'user_input' } });
    return { ...d, records };
  });
}

export function saveRule(session: AppSession, rule: AttendanceRule & { courseKey: string }) {
  return update(session, (d) => ({ ...d, rules: [...d.rules.filter((r) => r.courseKey !== rule.courseKey), rule] }));
}

export function useAttendance(session: AppSession | null) {
  const version = useAttendanceVersion();
  const [state, setState] = useState<{ data: AttendanceData | null; loaded: boolean }>({ data: null, loaded: false });
  useEffect(() => {
    if (!session) return;
    let alive = true;
    loadAttendance(session).then((data) => alive && setState({ data, loaded: true }));
    return () => {
      alive = false;
    };
  }, [session, version]);
  return state;
}
