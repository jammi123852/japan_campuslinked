import Constants from 'expo-constants';
import { setTranslationTable } from '@/lib/translate';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { normalizeCourse } from './courseLogic';
import type { OfficialCourse, OfficialData, OfficialPublicMin, OpsPostMeta, SyllabusDetail } from './types';

/**
 * 공식자료 데이터 불러오기. 메타(/official/ksu-2026.json)와 전 학부 개설 목록(/official/courses-2026.json)을 한 번만 읽어 합친다.
 * 공개 배포에는 재사용 허가가 확인될 때까지 들어 있지 않으므로 없으면 'missing' — 공개 최소본(public-min)이 있으면 공식 링크를 보여 준다.
 */
export type OfficialState = { kind: 'loading' } | { kind: 'ok'; data: OfficialData } | { kind: 'missing'; publicMin: OfficialPublicMin | null } | { kind: 'error' };

let cache: Promise<OfficialState> | null = null;

const baseUrl = () => ((Constants.expoConfig?.experiments as { baseUrl?: string } | undefined)?.baseUrl ?? '').replace(/\/$/, '');

async function json<T>(path: string): Promise<T | null> {
  const res = await fetch(`${baseUrl()}${path}`, { cache: 'no-cache' });
  if (!res.ok) return null;
  // 파일이 없을 때 404 페이지(HTML)를 200 으로 주는 서버도 있으므로 JSON 이 아니면 '없음'
  return (await res.json().catch(() => null)) as T | null;
}

async function load(): Promise<OfficialState> {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return { kind: 'missing', publicMin: null };
  try {
    // 미리 번역해 둔 한국어 표도 같이 읽는다 (없으면 원문으로 보여 줌, 번역 API 는 부르지 않음)
    const [meta, list, ko] = await Promise.all([json<OfficialData>('/official/ksu-2026.json'), json<{ courses: OfficialCourse[] }>('/official/courses-2026.json'), json<{ map?: Record<string, string> }>('/official/ko-2026.json').catch(() => null)]);
    setTranslationTable(ko?.map ?? null);
    if (!meta || !list || !Array.isArray(list.courses)) {
      const pm = await json<OfficialPublicMin>('/official/public-min.json').catch(() => null);
      return { kind: 'missing', publicMin: pm && pm.usage === 'public_min' ? pm : null };
    }
    const courses = list.courses.map(normalizeCourse);
    return { kind: 'ok', data: { ...meta, courses: [...courses, ...(meta.legacyCourses ?? [])] } };
  } catch {
    return { kind: 'error' };
  }
}

export function loadOfficial(): Promise<OfficialState> {
  if (!cache) cache = load();
  return cache;
}

export function useOfficial(): OfficialState {
  const [state, setState] = useState<OfficialState>({ kind: 'loading' });
  useEffect(() => {
    let alive = true;
    loadOfficial().then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

const sylCache = new Map<string, Promise<Record<string, SyllabusDetail> | null>>();

/** 시라버스 상세 (묶음 파일 단위로 필요할 때만 읽음). 없으면 null — 다른 과목 내용으로 대신하지 않는다 */
export function useSyllabus(id: string | undefined, has: boolean | undefined) {
  const [state, setState] = useState<{ id: string | null; detail: SyllabusDetail | null }>({ id: null, detail: null });
  useEffect(() => {
    if (!id || !has) return;
    let alive = true;
    const bucket = id.slice(1, 3);
    if (!sylCache.has(bucket)) sylCache.set(bucket, json<Record<string, SyllabusDetail>>(`/official/syl/${bucket}.json`).catch(() => null));
    sylCache.get(bucket)!.then((m) => alive && setState({ id, detail: m?.[id] ?? null }));
    return () => {
      alive = false;
    };
  }, [id, has]);
  return { loading: !!id && !!has && state.id !== id, detail: id && has && state.id === id ? state.detail : null };
}

let opsCache: Promise<OpsPostMeta[]> | null = null;
export function loadOpsPosts(): Promise<OpsPostMeta[]> {
  if (!opsCache) opsCache = json<{ posts: OpsPostMeta[] }>('/official/ops-2026.json').then((r) => r?.posts ?? []).catch(() => []);
  return opsCache;
}
