import { useEffect, useState } from 'react';

import type { AppSession } from '@/data/types';
import { currentPeriod, type AcademicPeriod } from '@/features/academic/academicLogic';
import type { OfficialData } from '@/features/official/types';
import { academicNow } from '@/lib/dates';
import { readJson, StorageKeys, writeJson } from '@/lib/storage';
import { createVersion } from '@/lib/storeVersion';

/**
 * 사용자가 보고 있는 학년도·쿼터 (이 기기에만 저장).
 * 고르지 않았으면 공식 학년력으로 오늘이 속한 쿼터를 쓰고, 학년력이 없으면 '미선택'(추측하지 않음).
 * 선택한 기간과 오늘 날짜는 별개다 — 과거 쿼터를 보고 있어도 '오늘'은 바뀌지 않는다.
 */
const key = (s: AppSession) => StorageKeys.userData(s.userId, 'period');
const store = createVersion();

export async function setSelectedPeriod(session: AppSession, p: AcademicPeriod | null) {
  await writeJson(key(session), p);
  store.bump();
}

export function usePeriod(session: AppSession | null, official: OfficialData | null) {
  const version = store.useVersion();
  const [saved, setSaved] = useState<{ value: AcademicPeriod | null; loaded: boolean }>({ value: null, loaded: false });
  useEffect(() => {
    if (!session) return;
    let alive = true;
    readJson<AcademicPeriod>(key(session)).then((v) => alive && setSaved({ value: v && typeof v.year === 'number' ? v : null, loaded: true }));
    return () => {
      alive = false;
    };
  }, [session, version]);
  const now = currentPeriod(official?.calendar, academicNow().date);
  const period = saved.value ?? now?.period ?? null;
  return {
    period,
    /** 오늘 기준 쿼터 (학년력이 있을 때만) */
    today: now,
    source: saved.value ? ('saved' as const) : now ? ('calendar' as const) : ('none' as const),
    loaded: saved.loaded,
  };
}
