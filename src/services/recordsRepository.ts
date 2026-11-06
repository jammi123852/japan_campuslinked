import { useEffect, useState } from 'react';

import type { AppSession } from '@/data/types';
import type { CourseRecord } from '@/features/records/gradLogic';
import { readJson, StorageKeys, writeJson } from '@/lib/storage';
import { createVersion } from '@/lib/storeVersion';

/**
 * 학기별 수강·이수 기록 (이 기기에만 저장). 시간표와 별도로 보관한다:
 * 시간표에서 과목을 지워도 이수 기록은 남고, 이수 기록을 바꿔도 시간표는 바뀌지 않는다.
 */
const key = (s: AppSession) => StorageKeys.userData(s.userId, 'records');
const store = createVersion();
export const useRecordsVersion = store.useVersion;

export async function loadRecords(session: AppSession): Promise<CourseRecord[]> {
  const raw = await readJson<CourseRecord[]>(key(session));
  return Array.isArray(raw) ? raw : [];
}

async function save(session: AppSession, list: CourseRecord[]) {
  await writeJson(key(session), list);
  store.bump();
}

export async function upsertRecord(session: AppSession, r: CourseRecord) {
  const list = await loadRecords(session);
  const i = list.findIndex((x) => x.id === r.id);
  if (i >= 0) list[i] = r;
  else list.push(r);
  await save(session, list);
}

export async function upsertRecords(session: AppSession, rs: CourseRecord[]) {
  const list = await loadRecords(session);
  for (const r of rs) {
    const i = list.findIndex((x) => x.id === r.id);
    if (i >= 0) list[i] = r;
    else list.push(r);
  }
  await save(session, list);
}

export async function deleteRecord(session: AppSession, id: string) {
  await save(
    session,
    (await loadRecords(session)).filter((r) => r.id !== id),
  );
}

export function newRecordId() {
  return `rec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function useRecords(session: AppSession | null) {
  const version = useRecordsVersion();
  const [state, setState] = useState<{ records: CourseRecord[]; loaded: boolean }>({ records: [], loaded: false });
  useEffect(() => {
    if (!session) return;
    let alive = true;
    loadRecords(session).then((records) => alive && setState({ records, loaded: true }));
    return () => {
      alive = false;
    };
  }, [session, version]);
  return state;
}
