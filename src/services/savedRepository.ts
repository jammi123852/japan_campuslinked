import { useEffect, useState } from 'react';

import type { AppSession } from '@/data/types';
import { readJson, StorageKeys, writeJson } from '@/lib/storage';
import { createVersion } from '@/lib/storeVersion';

/**
 * 즐겨찾기·나중에 보기(강의)와 북마크(게시글). 이 기기에만 저장한다(기기 간 동기화 없음).
 * 북마크는 글 제목을 함께 남겨, 공유 서버가 꺼져 있어도 목록은 보이게 한다. 글을 못 불러와도 자동 삭제하지 않는다.
 */
export interface SavedState {
  favorites: { lectureId: string; savedAt: string }[];
  later: { lectureId: string; savedAt: string }[];
  bookmarks: { postId: number; title: string; savedAt: string }[];
}

const key = (s: AppSession) => StorageKeys.userData(s.userId, 'saved');
const store = createVersion();
export const useSavedVersion = store.useVersion;

const empty = (): SavedState => ({ favorites: [], later: [], bookmarks: [] });

export async function loadSaved(session: AppSession): Promise<SavedState> {
  const raw = await readJson<Partial<SavedState>>(key(session));
  return {
    favorites: Array.isArray(raw?.favorites) ? raw.favorites : [],
    later: Array.isArray(raw?.later) ? raw.later : [],
    bookmarks: Array.isArray(raw?.bookmarks) ? raw.bookmarks : [],
  };
}

async function update(session: AppSession, fn: (s: SavedState) => SavedState) {
  const next = fn(await loadSaved(session));
  await writeJson(key(session), next);
  store.bump();
  return next;
}

/** 지운 글의 북마크를 뺀다 */
export function removeBookmark(session: AppSession, postId: number) {
  return update(session, (s) => ({ ...s, bookmarks: s.bookmarks.filter((b) => b.postId !== postId) }));
}

/** 강의 즐겨찾기·나중에 보기 켜기/끄기 (같은 강의는 한 번만) */
export function toggleLecture(session: AppSession, list: 'favorites' | 'later', lectureId: string) {
  return update(session, (s) => {
    const has = s[list].some((x) => x.lectureId === lectureId);
    return { ...s, [list]: has ? s[list].filter((x) => x.lectureId !== lectureId) : [{ lectureId, savedAt: new Date().toISOString() }, ...s[list]] };
  });
}

export function toggleBookmark(session: AppSession, post: { id: number; title: string }) {
  return update(session, (s) => {
    const has = s.bookmarks.some((x) => x.postId === post.id);
    return {
      ...s,
      bookmarks: has ? s.bookmarks.filter((x) => x.postId !== post.id) : [{ postId: post.id, title: post.title, savedAt: new Date().toISOString() }, ...s.bookmarks],
    };
  });
}

/** 글을 다시 불러왔을 때 제목이 바뀌었으면 저장된 제목도 맞춘다 */
export function refreshBookmarkTitle(session: AppSession, postId: number, title: string) {
  return update(session, (s) => ({ ...s, bookmarks: s.bookmarks.map((b) => (b.postId === postId && b.title !== title ? { ...b, title } : b)) }));
}

export function useSaved(session: AppSession | null) {
  const version = useSavedVersion();
  const [state, setState] = useState<SavedState | null>(null);
  useEffect(() => {
    if (!session) return;
    let alive = true;
    loadSaved(session).then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, [session, version]);
  return state ?? empty();
}
