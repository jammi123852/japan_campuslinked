/**
 * 앱 안 알림함 상태 계산 (순수 함수, Node 에서 바로 테스트).
 * OS 푸시가 아니다. 앱을 열거나 화면에 돌아왔을 때 서버·개인 일정을 확인해 이 기기에 쌓는다.
 *
 * - 새 답변(내 글에 다른 사람 댓글), 새 후기(즐겨찾기 강의): 공유 서버 커서 이후 이벤트만. id = 'answer:<댓글 id>' / 'review:<후기 id>'
 * - 마감: 저장하지 않고 현재 일정에서 매번 계산 (scheduleLogic.deadlineAlerts) → 완료·삭제·날짜 변경이 바로 반영된다
 * - 읽음: readIds 에 id 를 남긴다
 */
import type { ActivityResult } from '../../lib/api';

export type InboxKind = 'answer' | 'review' | 'deadline';

export interface ServerNotice {
  id: string;
  kind: 'answer' | 'review';
  createdAt: string;
  postId?: number;
  postTitle?: string;
  lectureId?: string;
}

export type InboxSettings = Record<InboxKind, boolean>;

export interface InboxState {
  items: ServerNotice[];
  readIds: string[];
  settings: InboxSettings;
  /** 서버 커서. null 이면 다음 확인 때 기준점부터 잡는다 */
  cursor: { comment: number; review: number } | null;
  /** 커서를 받은 서버 주소. 서버가 바뀌면(터널 주소 변경 등) 커서를 다시 잡는다 */
  cursorBase: string | null;
  lastCheckedAt: string | null;
  lastError: 'not_configured' | 'network' | 'http' | null;
}

export const DEFAULT_SETTINGS: InboxSettings = { answer: true, review: true, deadline: true };
export const MAX_ITEMS = 200;
const MAX_READ = 500;

export const emptyInbox = (): InboxState => ({
  items: [],
  readIds: [],
  settings: { ...DEFAULT_SETTINGS },
  cursor: null,
  cursorBase: null,
  lastCheckedAt: null,
  lastError: null,
});

/** 서버에 보낼 커서. 처음이거나 서버 주소가 바뀌었으면 null (기준점만 받기) */
export const cursorFor = (s: InboxState, apiBase: string) => (s.cursor && s.cursorBase === apiBase ? s.cursor : null);

/** 서버 응답을 반영한다. 같은 id 는 한 번만, 꺼 둔 종류는 쌓지 않는다(나중에 켜도 과거 것이 쏟아지지 않음) */
export function applyActivity(s: InboxState, r: ActivityResult, apiBase: string, now: string): InboxState {
  const incoming: ServerNotice[] = [
    ...(s.settings.answer
      ? r.comments.map((c) => ({ id: `answer:${c.id}`, kind: 'answer' as const, createdAt: c.createdAt, postId: c.postId, postTitle: c.postTitle }))
      : []),
    ...(s.settings.review ? r.reviews.map((v) => ({ id: `review:${v.id}`, kind: 'review' as const, createdAt: v.createdAt, lectureId: v.lectureId })) : []),
  ];
  const known = new Set(s.items.map((i) => i.id));
  const items = [...s.items, ...incoming.filter((i) => !known.has(i.id))]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_ITEMS);
  return { ...s, items, cursor: r.cursor, cursorBase: apiBase, lastCheckedAt: now, lastError: null };
}

export function markRead(s: InboxState, ids: string[]): InboxState {
  const set = new Set(s.readIds);
  ids.forEach((id) => set.add(id));
  return { ...s, readIds: [...set].slice(-MAX_READ) };
}

/** 저장된 값이 이전 형식이거나 일부 빠져 있어도 깨지지 않게 채운다 */
export function normalizeInbox(raw: Partial<InboxState> | null): InboxState {
  const base = emptyInbox();
  if (!raw) return base;
  return {
    ...base,
    ...raw,
    items: Array.isArray(raw.items) ? raw.items : [],
    readIds: Array.isArray(raw.readIds) ? raw.readIds : [],
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
  };
}
