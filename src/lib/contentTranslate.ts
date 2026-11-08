import { useCallback, useEffect, useState } from 'react';

import { useI18n } from '@/i18n';
import { translateTexts } from '@/lib/api';
import { detectContentLang } from '@/lib/contentLang';

/**
 * 게시글·댓글·후기·공지·알림·AI 결과 같은 실제 콘텐츠 번역.
 * 목표 언어 + 원문 기준으로 저장하므로 내용이 바뀌면 새로 번역되고, 같은 문장은 다시 호출하지 않는다(서버 DB·메모리).
 * 실패하면 원문을 그대로 보여 주고 다시 시도할 수 있다. 원문은 바꾸지 않는다.
 */
type Entry = { state: 'pending' | 'done' | 'failed'; text?: string };
const cache = new Map<string, Entry>();
const queue = new Map<'ko' | 'ja', Set<string>>([['ko', new Set()], ['ja', new Set()]]);
let timer: ReturnType<typeof setTimeout> | null = null;
let nickname = 'guest';
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function setTranslateNickname(n: string | null | undefined) {
  nickname = n || 'guest';
}

/** 시드 등으로 이미 있는 번역을 미리 넣을 때 */
export function primeTranslation(target: 'ko' | 'ja', text: string, translated: string) {
  cache.set(`${target}|${text}`, { state: 'done', text: translated });
}

async function flush() {
  timer = null;
  for (const target of ['ko', 'ja'] as const) {
    const set = queue.get(target)!;
    if (!set.size) continue;
    const all = [...set];
    set.clear();
    for (let i = 0; i < all.length; i += 20) {
      const batch = all.slice(i, i + 20);
      try {
        const r = await translateTexts(nickname, batch, target);
        batch.forEach((s, k) => cache.set(`${target}|${s}`, r.translations[k] ? { state: 'done', text: r.translations[k]! } : { state: 'failed' }));
      } catch {
        batch.forEach((s) => cache.set(`${target}|${s}`, { state: 'failed' }));
      }
      notify();
    }
  }
}

function request(target: 'ko' | 'ja', text: string) {
  const k = `${target}|${text}`;
  if (cache.has(k)) return;
  cache.set(k, { state: 'pending' });
  queue.get(target)!.add(text);
  if (!timer) timer = setTimeout(flush, 120);
}

function useCacheVersion() {
  const [, setV] = useState(0);
  useEffect(() => {
    const l = () => setV((x) => x + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
}

export function needsTranslation(text: string | null | undefined, locale: 'ko' | 'ja') {
  const lang = detectContentLang(text);
  return lang != null && lang !== locale && [...(text ?? '')].length <= 4000;
}

/** 목록 제목처럼 전환 버튼 없이 쓰는 번역 함수: 준비되면 번역문, 아니면 원문 */
export function useCt() {
  const { locale } = useI18n();
  useCacheVersion();
  return useCallback(
    (text: string | null | undefined): string => {
      if (!text) return '';
      if (!needsTranslation(text, locale)) return text;
      request(locale, text);
      const e = cache.get(`${locale}|${text}`);
      return e?.state === 'done' && e.text ? e.text : text;
    },
    [locale],
  );
}

/** 본문용: 번역 상태와 원문 보기 전환을 함께 돌려준다 */
export function useContentText(text: string | null | undefined) {
  const { locale } = useI18n();
  useCacheVersion();
  const [showOriginal, setShowOriginal] = useState(false);
  const raw = text ?? '';
  const needed = needsTranslation(raw, locale);
  const key = `${locale}|${raw}`;
  useEffect(() => {
    if (needed) request(locale, raw);
  }, [needed, locale, raw]);
  const e = needed ? cache.get(key) : undefined;
  const retry = () => {
    cache.delete(key);
    request(locale, raw);
    notify();
  };
  const translated = e?.state === 'done' ? e.text ?? null : null;
  return {
    text: translated && !showOriginal ? translated : raw,
    needed,
    state: !needed ? ('none' as const) : translated ? ('done' as const) : e?.state === 'failed' ? ('failed' as const) : ('pending' as const),
    showOriginal,
    toggle: () => setShowOriginal((v) => !v),
    retry,
  };
}
