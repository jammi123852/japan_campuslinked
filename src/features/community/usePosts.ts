import { useCallback, useEffect, useState } from 'react';

import type { Strings } from '@/i18n/ko';
import { ApiError, listPosts, type PostCategory, type PostSummary } from '@/lib/api';

export type LoadState<T> =
  | { kind: 'loading' }
  | { kind: 'ok'; data: T }
  | { kind: 'error'; error: unknown };

/** API 오류를 화면 문구로 */
export function apiErrorText(t: Strings, e: unknown): string {
  if (e instanceof ApiError) {
    if (e.kind === 'not_configured') return t.community.notConfigured;
    if (e.kind === 'network') return t.community.network;
    if (e.status === 429) return t.community.rateLimited;
    return t.community.httpError(e.code ?? String(e.status ?? ''));
  }
  return t.community.httpError(String(e));
}

/** 게시글 목록. reload() 로 다시 불러온다 (실시간 동기화는 하지 않음) */
export function usePosts(opts: { category?: PostCategory | null; lectureId?: string; limit?: number; q?: string }) {
  const [state, setState] = useState<LoadState<PostSummary[]>>({ kind: 'loading' });
  const [tick, setTick] = useState(0);
  const { category, lectureId, limit, q } = opts;

  useEffect(() => {
    let alive = true;
    listPosts({ category, lectureId, limit, q })
      .then((posts) => alive && setState({ kind: 'ok', data: posts }))
      .catch((error: unknown) => alive && setState({ kind: 'error', error }));
    return () => {
      alive = false;
    };
  }, [category, lectureId, limit, q, tick]);

  const reload = useCallback(() => {
    setState({ kind: 'loading' });
    setTick((x) => x + 1);
  }, []);

  return { state, reload };
}

export function formatPostTime(iso: string, locale: 'ko' | 'ja') {
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}
