import { useEffect, useState } from 'react';

import { courseNameFor } from '@/data/courseNamesKo';
import { useI18n } from '@/i18n';

/**
 * 공식 자료 일본어 → 한국어: 미리 번역해 둔 표(/official/ko-2026.json)만 쓴다.
 * 앱이 번역 API 를 부르지 않는다. 표는 공식 자료와 함께 처음에 한 번 읽고, 표에 없는 문장은 원문 그대로 보여 준다.
 */
const CLIENT_MAX = 11000;
let table: Record<string, string> | null = null;
let version = 0;
const listeners = new Set<(v: number) => void>();

/** 공식 자료를 읽을 때 같이 부른다 (useOfficial 의 load) */
export function setTranslationTable(map: Record<string, string> | null) {
  table = map;
  version += 1;
  listeners.forEach((l) => l(version));
}

/** 한국어 모드에서 미리 번역된 문장으로 바꿔 주는 함수. 표에 없으면 원문 */
export function useTr() {
  const { locale } = useI18n();
  const [, setV] = useState(version);
  useEffect(() => {
    listeners.add(setV);
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return (s: string | null | undefined): string => {
    if (!s) return '';
    if (locale !== 'ko' || !table) return s;
    // 한국어 문장 안의 일본식 가운뎃점은 한국식으로
    const hit = table[s.slice(0, CLIENT_MAX)];
    return hit ? hit.replace(/・/g, '·') : s;
  };
}

/** 과목명: 사전에 있으면 사전, 없으면 미리 번역된 표 */
export function useCourseTitle() {
  const { locale } = useI18n();
  const tr = useTr();
  return (name: string | null | undefined) => {
    const fromDict = courseNameFor(name, locale);
    return (fromDict !== (name ?? '') ? fromDict : tr(name)).replace(/・/g, locale === 'ko' ? '·' : '・');
  };
}
