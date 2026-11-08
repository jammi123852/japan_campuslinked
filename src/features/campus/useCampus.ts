import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import type { CampusData } from './campusLogic';

export const campusBase = () => ((Constants.expoConfig?.experiments as { baseUrl?: string } | undefined)?.baseUrl ?? '').replace(/\/$/, '');

let cache: Promise<CampusData | null> | null = null;

/** 공식 지도 자료. 공개 빌드에는 재사용 허가 확인 전까지 없으므로 null 일 수 있다 */
export function loadCampus(): Promise<CampusData | null> {
  if (cache) return cache;
  if (Platform.OS !== 'web') return Promise.resolve(null);
  cache = fetch(`${campusBase()}/official/campus-2026.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((d) => {
      if (!d || !Array.isArray((d as CampusData).buildings)) cache = null;
      return d && Array.isArray((d as CampusData).buildings) ? (d as CampusData) : null;
    });
  return cache!;
}

export function useCampus() {
  const [state, setState] = useState<{ loading: boolean; data: CampusData | null }>({ loading: true, data: null });
  useEffect(() => {
    let alive = true;
    loadCampus().then((data) => alive && setState({ loading: false, data }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
