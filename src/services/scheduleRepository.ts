import { useEffect, useState } from 'react';

import type { AppSession } from '@/data/types';
import type { PersonalEvent } from '@/features/schedule/scheduleLogic';
import { readJson, StorageKeys, writeJson } from '@/lib/storage';
import { createVersion } from '@/lib/storeVersion';

/**
 * 개인 일정·마감 (이 기기에만 저장). 한 번도 저장한 적 없으면 null — 데모 홈은 이때만 샘플 마감을 보여 주고,
 * 사용자가 일정을 하나라도 저장하면 샘플 없이 사용자 일정만 보여 준다(샘플과 섞지 않음).
 */
const key = (s: AppSession) => StorageKeys.userData(s.userId, 'events');
const store = createVersion();
export const useEventsVersion = store.useVersion;

export async function loadEvents(session: AppSession): Promise<PersonalEvent[] | null> {
  const raw = await readJson<PersonalEvent[]>(key(session));
  return Array.isArray(raw) ? raw : null;
}

async function save(session: AppSession, list: PersonalEvent[]) {
  await writeJson(key(session), list);
  store.bump();
}

export async function upsertEvent(session: AppSession, ev: PersonalEvent) {
  const list = (await loadEvents(session)) ?? [];
  const i = list.findIndex((e) => e.id === ev.id);
  if (i >= 0) list[i] = ev;
  else list.push(ev);
  await save(session, list);
}

/**
 * 출처 키로 일정 저장: 같은 키가 이미 있으면 새로 만들지 않고 날짜·시각·제목만 갱신한다 (완료 표시·알림 설정은 유지).
 * 결과: added / updated(값이 바뀜) / same(그대로)
 */
export async function upsertEventBySource(session: AppSession, ev: PersonalEvent): Promise<'added' | 'updated' | 'same'> {
  const list = (await loadEvents(session)) ?? [];
  const i = ev.sourceKey ? list.findIndex((e) => e.sourceKey === ev.sourceKey) : -1;
  if (i < 0) {
    await save(session, [...list, ev]);
    return 'added';
  }
  const cur = list[i];
  if (cur.date === ev.date && cur.time === ev.time && cur.title === ev.title && (cur.endTime ?? null) === (ev.endTime ?? null)) return 'same';
  list[i] = { ...cur, date: ev.date, time: ev.time, endTime: ev.endTime ?? null, title: ev.title, memo: ev.memo, updatedAt: ev.updatedAt };
  await save(session, list);
  return 'updated';
}

export async function deleteEvent(session: AppSession, id: string) {
  const list = (await loadEvents(session)) ?? [];
  await save(
    session,
    list.filter((e) => e.id !== id),
  );
}

export async function setEventDone(session: AppSession, id: string, done: boolean) {
  const list = (await loadEvents(session)) ?? [];
  await save(
    session,
    list.map((e) => (e.id === id ? { ...e, done, updatedAt: new Date().toISOString() } : e)),
  );
}

export function newEventId() {
  return `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** events: 저장된 일정(없으면 null), loaded: 첫 읽기 완료 여부 */
export function useEvents(session: AppSession | null) {
  const version = useEventsVersion();
  const [state, setState] = useState<{ events: PersonalEvent[] | null; loaded: boolean }>({ events: null, loaded: false });
  useEffect(() => {
    if (!session) return;
    let alive = true;
    loadEvents(session).then((events) => alive && setState({ events, loaded: true }));
    return () => {
      alive = false;
    };
  }, [session, version]);
  return state;
}
