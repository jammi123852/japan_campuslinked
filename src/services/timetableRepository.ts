import { useEffect, useState } from 'react';

import type { AppSession, TimetableEntry } from '@/data/types';
import type { Strings } from '@/i18n/ko';
import { readJson, StorageKeys, writeJson } from '@/lib/storage';

/**
 * 사용자 시간표 저장소 (기기 저장). 데모·이메일 모드 모두 사용자별 키에 저장한다.
 * 저장하면 구독 중인 화면(홈·캘린더)이 다시 읽도록 버전을 올린다.
 * Supabase 동기화(timetable_entries)는 3단계에서 추가.
 */

const key = (session: AppSession) => StorageKeys.userData(session.userId, 'timetable');

let version = 0;
const listeners = new Set<(v: number) => void>();

function bump() {
  version += 1;
  listeners.forEach((l) => l(version));
}

/** 저장할 때마다 바뀌는 숫자. 화면의 useEffect 의존성으로 쓴다 */
export function useTimetableVersion() {
  const [v, setV] = useState(version);
  useEffect(() => {
    listeners.add(setV);
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return v;
}

/**
 * 저장된 시간표. 한 번도 저장한 적 없으면 null.
 * 예전 버전이 기기에 저장해 둔 데모 수업(source.kind='demo')은 읽을 때 뺀다.
 */
export async function loadTimetable(session: AppSession): Promise<TimetableEntry[] | null> {
  const stored = await readJson<TimetableEntry[]>(key(session));
  return stored ? stored.filter((e) => e.source?.kind !== 'demo') : null;
}

/** 편집 기준 목록. 데모 모드도 샘플 없이 빈 시간표에서 시작한다 */
export async function loadEditableTimetable(
  session: AppSession,
  _t: Strings,
): Promise<{ entries: TimetableEntry[]; isSample: boolean }> {
  const stored = await loadTimetable(session);
  return { entries: stored ?? [], isSample: false };
}

export async function saveTimetable(session: AppSession, entries: TimetableEntry[]): Promise<void> {
  const sorted = [...entries].sort((a, b) => a.weekday - b.weekday || a.period - b.period);
  await writeJson(key(session), sorted);
  bump();
}

export async function upsertEntry(session: AppSession, t: Strings, entry: TimetableEntry): Promise<void> {
  const list = (await loadEditableTimetable(session, t)).entries;
  const i = list.findIndex((e) => e.id === entry.id);
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  await saveTimetable(session, list);
}

export async function removeEntry(session: AppSession, t: Strings, id: string): Promise<void> {
  const list = (await loadEditableTimetable(session, t)).entries;
  await saveTimetable(
    session,
    list.filter((e) => e.id !== id),
  );
}

export function newEntryId() {
  return `tt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isValidTime = (s: string) => TIME.test(s);
