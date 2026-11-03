import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { readJson, writeJson } from '@/lib/storage';
import { ja } from './ja';
import { ko, type Strings } from './ko';

export type Locale = 'ko' | 'ja';

export const LOCALES: { value: Locale; label: string }[] = [
  { value: 'ko', label: '한국어' },
  { value: 'ja', label: '日本語' },
];

const TABLES: Record<Locale, Strings> = { ko, ja };
const LOCALE_KEY = 'ksu:v1:locale';

/**
 * 기본 언어: EXPO_PUBLIC_LOCALE (없으면 개발 중 기본값 ko).
 * 출시 때는 .env 에 EXPO_PUBLIC_LOCALE=ja 만 바꾸면 된다. 사용자가 고른 값은 기기에 저장되어 우선한다.
 */
const DEFAULT_LOCALE: Locale = process.env.EXPO_PUBLIC_LOCALE === 'ja' ? 'ja' : 'ko';

interface LocaleState {
  locale: Locale;
  t: Strings;
  setLocale: (l: Locale) => void;
}

const LocaleContext = createContext<LocaleState | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    readJson<Locale>(LOCALE_KEY).then((saved) => {
      if (saved === 'ko' || saved === 'ja') setLocaleState(saved);
    });
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    writeJson(LOCALE_KEY, l).catch((e) => console.warn('[i18n] save failed', e));
  }, []);

  const value = useMemo(() => ({ locale, t: TABLES[locale], setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useI18n must be used inside LocaleProvider');
  return ctx;
}

/** 날짜·시각 표기 (기기 언어가 아니라 앱 언어 기준) */
export function formatDate(iso: string, locale: Locale) {
  return new Date(iso).toLocaleDateString(locale === 'ko' ? 'ko-KR' : 'ja-JP');
}

export function formatDateTime(iso: string, locale: Locale) {
  return new Date(iso).toLocaleString(locale === 'ko' ? 'ko-KR' : 'ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatShortDateTime(iso: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/** React 밖(서비스 계층)에서 쓰는 테이블 조회 */
export function stringsFor(locale: Locale): Strings {
  return TABLES[locale];
}
