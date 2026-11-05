import { useCallback, useEffect, useMemo, useState } from 'react';

import { buildDemoInbox } from '@/data/sampleData';
import type { AppSession } from '@/data/types';
import {
  applyActivity,
  cursorFor,
  markRead as markReadIn,
  normalizeInbox,
  type InboxSettings,
  type InboxState,
} from '@/features/inbox/inboxLogic';
import { deadlineAlerts, type PersonalEvent } from '@/features/schedule/scheduleLogic';
import { useI18n } from '@/i18n';
import { ApiError, fetchActivity, getApiUrl } from '@/lib/api';
import { academicNow } from '@/lib/dates';
import { readJson, StorageKeys, writeJson } from '@/lib/storage';
import { createVersion } from '@/lib/storeVersion';
import { loadSaved } from './savedRepository';
import { useEvents } from './scheduleRepository';

/**
 * 앱 안 알림함 (OS 푸시 아님). 알림 목록·읽음·설정·서버 커서는 이 기기에만 저장한다.
 * 확인 시점: 앱 시작, 홈·알림 화면으로 돌아올 때, 앱이 다시 앞으로 올 때, 새로고침 버튼. 최소 간격 30초.
 * 서버 확인에 실패하면 마지막 알림은 그대로 두고 실패 종류만 기록한다.
 */
const key = (s: AppSession) => StorageKeys.userData(s.userId, 'inbox');
const store = createVersion();
export const useInboxVersion = store.useVersion;

const MIN_INTERVAL_MS = 30_000;
let lastAttempt = 0;
let inFlight: Promise<void> | null = null;

export async function loadInbox(session: AppSession): Promise<InboxState> {
  return normalizeInbox(await readJson<Partial<InboxState>>(key(session)));
}

async function update(session: AppSession, fn: (s: InboxState) => InboxState) {
  // 서버 확인 중에 읽음 처리가 끼어들어도 잃지 않도록 매번 저장된 최신 값에서 바꾼다
  const next = fn(await loadInbox(session));
  await writeJson(key(session), next);
  store.bump();
  return next;
}

/** 서버에서 새 답변·새 후기 확인. force=false 면 30초 안에 다시 부르지 않는다 */
export function refreshInbox(session: AppSession, nickname: string, force = false): Promise<void> {
  if (inFlight) return inFlight;
  if (!force && Date.now() - lastAttempt < MIN_INTERVAL_MS) return Promise.resolve();
  lastAttempt = Date.now();
  inFlight = (async () => {
    const base = await getApiUrl();
    if (!base) {
      await update(session, (s) => ({ ...s, lastError: 'not_configured' }));
      return;
    }
    try {
      const [state, saved] = await Promise.all([loadInbox(session), loadSaved(session)]);
      const r = await fetchActivity(
        nickname,
        cursorFor(state, base),
        saved.favorites.map((f) => f.lectureId),
      );
      await update(session, (s) => applyActivity(s, r, base, new Date().toISOString()));
    } catch (e) {
      const kind = e instanceof ApiError && e.kind !== 'aborted' ? e.kind : 'network';
      await update(session, (s) => ({ ...s, lastError: kind }));
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export const markInboxRead = (session: AppSession, ids: string[]) => update(session, (s) => markReadIn(s, ids));
export const setInboxSettings = (session: AppSession, settings: InboxSettings) => update(session, (s) => ({ ...s, settings }));

export type InboxTarget = { type: 'post'; id: number } | { type: 'lecture'; id: string } | { type: 'event'; id: string } | null;

export interface InboxEntry {
  id: string;
  kind: 'answer' | 'review' | 'deadline' | 'sample';
  /** 정렬용 시각 (ISO 또는 마감일) */
  sortAt: string;
  read: boolean;
  target: InboxTarget;
  postTitle?: string;
  lectureId?: string;
  event?: PersonalEvent;
  days?: number;
  createdAt?: string;
  sample?: { title: string; body: string };
}

/** 화면용 알림 목록: 서버 알림 + (켜 둔 경우) 마감 알림 + 데모 환영 샘플 1개 */
export function useInbox(session: AppSession | null) {
  const { t } = useI18n();
  const version = useInboxVersion();
  const { events } = useEvents(session);
  const [state, setState] = useState<InboxState | null>(null);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    loadInbox(session).then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, [session, version]);

  const entries = useMemo<InboxEntry[]>(() => {
    if (!state) return [];
    const read = new Set(state.readIds);
    const out: InboxEntry[] = state.items
      .filter((i) => state.settings[i.kind])
      .map((i) => ({
        id: i.id,
        kind: i.kind,
        sortAt: i.createdAt,
        createdAt: i.createdAt,
        read: read.has(i.id),
        target: i.kind === 'answer' && i.postId != null ? { type: 'post', id: i.postId } : i.lectureId ? { type: 'lecture', id: i.lectureId } : null,
        postTitle: i.postTitle,
        lectureId: i.lectureId,
      }));
    if (state.settings.deadline && events) {
      const now = academicNow();
      for (const a of deadlineAlerts(events, now.date, now.minutes)) {
        out.push({ id: a.id, kind: 'deadline', sortAt: `${a.event.date}T${a.event.time ?? '23:59'}`, read: read.has(a.id), target: { type: 'event', id: a.event.id }, event: a.event, days: a.days });
      }
    }
    if (session?.mode === 'demo') {
      for (const s of buildDemoInbox(t)) {
        out.push({ id: `sample:${s.id}`, kind: 'sample', sortAt: s.createdAt, createdAt: s.createdAt, read: read.has(`sample:${s.id}`), target: null, sample: { title: s.title, body: s.body } });
      }
    }
    // 마감 알림을 위로, 나머지는 최신순
    return out.sort((a, b) => (a.kind === 'deadline') !== (b.kind === 'deadline') ? (a.kind === 'deadline' ? -1 : 1) : b.sortAt.localeCompare(a.sortAt));
  }, [state, events, session, t]);

  const unread = entries.filter((e) => !e.read).length;
  const markRead = useCallback((ids: string[]) => (session ? markInboxRead(session, ids) : Promise.resolve()), [session]);

  return { state, entries, unread, markRead };
}
