import { useEffect, useState } from 'react';

import type { AppSession, TimetableEntry } from '@/data/types';
import type { Priority, TimeRange } from '@/features/planner/plannerLogic';
import { readJson, StorageKeys, writeJson } from '@/lib/storage';
import { createVersion } from '@/lib/storeVersion';

/** 수강 계획 조건(우선순위·관심 분야·점심·막아 둔 시간)과 '적용 전 시간표' 백업. 이 기기에만 저장 */
export interface PlannerSettings {
  priorities: Priority[];
  interests: string;
  lunch: TimeRange | null;
  blocked: string[];
  count: number;
  /** 듣고 싶은 학점 (없으면 과목 수로 채움) */
  creditGoal?: number | null;
}
export const DEFAULT_PLANNER: PlannerSettings = { priorities: ['requirement'], interests: '', lunch: null, blocked: [], count: 3 };

const key = (s: AppSession) => StorageKeys.userData(s.userId, 'planner');
const backupKey = (s: AppSession) => StorageKeys.userData(s.userId, 'plannerBackup');
const store = createVersion();

export async function savePlannerSettings(session: AppSession, v: PlannerSettings) {
  await writeJson(key(session), v);
  store.bump();
}

export function usePlannerSettings(session: AppSession | null) {
  const version = store.useVersion();
  const [state, setState] = useState<PlannerSettings>(DEFAULT_PLANNER);
  useEffect(() => {
    if (!session) return;
    let alive = true;
    readJson<PlannerSettings>(key(session)).then((v) => alive && setState({ ...DEFAULT_PLANNER, ...(v ?? {}) }));
    return () => {
      alive = false;
    };
  }, [session, version]);
  return state;
}

export async function saveTimetableBackup(session: AppSession, entries: TimetableEntry[]) {
  await writeJson(backupKey(session), { savedAt: new Date().toISOString(), entries });
  store.bump();
}

export async function loadTimetableBackup(session: AppSession) {
  return readJson<{ savedAt: string; entries: TimetableEntry[] }>(backupKey(session));
}

export async function clearTimetableBackup(session: AppSession) {
  await writeJson(backupKey(session), null);
  store.bump();
}

export function useTimetableBackup(session: AppSession | null) {
  const version = store.useVersion();
  const [state, setState] = useState<{ savedAt: string; entries: TimetableEntry[] } | null>(null);
  useEffect(() => {
    if (!session) return;
    let alive = true;
    loadTimetableBackup(session).then((v) => alive && setState(v && Array.isArray(v.entries) ? v : null));
    return () => {
      alive = false;
    };
  }, [session, version]);
  return state;
}
