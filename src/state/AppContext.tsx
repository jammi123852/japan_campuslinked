import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { AppSession, UserProfile } from '@/data/types';
import * as auth from '@/services/auth';
import { loadProfile, saveProfile, type SaveResult } from '@/services/profileRepository';
import { clearUserNamespace, readJson, removeKey, StorageKeys, writeJson } from '@/lib/storage';
import { setIncludeDemoContent } from '@/lib/api';
import { hasEntered, markEntered } from '@/lib/appEntry';
import { setTranslateNickname } from '@/lib/contentTranslate';

interface AppState {
  /** 起動時の復元が終わるまで false */
  ready: boolean;
  session: AppSession | null;
  profile: UserProfile | null;
  startDemo: (email?: string | null) => Promise<void>;
  startPersonal: (email?: string | null) => Promise<void>;
  setSession: (session: AppSession) => Promise<void>;
  updateProfile: (profile: Omit<UserProfile, 'updatedAt'>) => Promise<SaveResult>;
  signOut: () => Promise<void>;
  /** デモデータ(デモのプロフィール含む)を削除してログアウト */
  resetDemo: () => Promise<void>;
  /** '내 정보' 기록(프로필·시간표·일정·이수 기록 등)을 지우고 로그아웃 */
  resetPersonal: () => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSessionState] = useState<AppSession | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  // 데모·시연 입장일 때만 데모 후기·글을 받는다. 자식 화면의 첫 요청보다 먼저 정해져야 해서 렌더 중에 넣는다
  setIncludeDemoContent(session?.mode === 'demo' || session?.userId === 'showcase-local');
  setTranslateNickname(profile?.nickname);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // 1회 정리 (2026-11-01 사용자 지시): '내 정보로 시작하기'에 남아 있던 이전 기록을 지운다. 데모·시연 기록은 유지
        const PERSONAL_RESET = 'ksu:v1:meta:personalReset:20261101';
        if (!(await readJson<string>(PERSONAL_RESET))) {
          await clearUserNamespace(auth.PERSONAL_USER_ID);
          const saved = await readJson<AppSession>(StorageKeys.session);
          if (saved?.userId === auth.PERSONAL_USER_ID) await removeKey(StorageKeys.session);
          await writeJson(PERSONAL_RESET, new Date().toISOString());
        }
        // 새로 연 앱은 웰컴 화면부터. 저장된 기록은 그대로 두고, 이 탭에서 입장한 경우와 실제 계정 로그인만 복원한다
        const saved = await readJson<AppSession>(StorageKeys.session);
        const restored = hasEntered() || saved?.mode === 'supabase' ? await auth.restoreSession() : null;
        const restoredProfile = restored ? await loadProfile(restored) : null;
        if (!alive) return;
        setSessionState(restored);
        setProfile(restoredProfile);
      } catch (e) {
        console.warn('[app] restore failed', e);
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const setSession = useCallback(async (next: AppSession) => {
    markEntered(true);
    const p = await loadProfile(next);
    setSessionState(next);
    setProfile(p);
  }, []);

  const startDemo = useCallback(async (email: string | null = null) => {
    await setSession(await auth.startDemo(email));
  }, [setSession]);

  const startPersonal = useCallback(async (email: string | null = null) => {
    await setSession(await auth.startPersonal(email));
  }, [setSession]);

  const updateProfile = useCallback(
    async (input: Omit<UserProfile, 'updatedAt'>) => {
      if (!session) return { ok: false, code: 'notSignedIn' } as const;
      const next: UserProfile = { ...input, updatedAt: new Date().toISOString() };
      const result = await saveProfile(session, next);
      if (result.ok) setProfile(next);
      return result;
    },
    [session],
  );

  const signOut = useCallback(async () => {
    markEntered(false);
    await auth.signOut(session);
    setSessionState(null);
    setProfile(null);
  }, [session]);

  const resetDemo = useCallback(async () => {
    markEntered(false);
    await clearUserNamespace(auth.DEMO_USER_ID);
    await auth.signOut(session);
    setSessionState(null);
    setProfile(null);
  }, [session]);

  const resetPersonal = useCallback(async () => {
    markEntered(false);
    await clearUserNamespace(auth.PERSONAL_USER_ID);
    await auth.signOut(session);
    setSessionState(null);
    setProfile(null);
  }, [session]);

  const value = useMemo(
    () => ({ ready, session, profile, startDemo, startPersonal, setSession, updateProfile, signOut, resetDemo, resetPersonal }),
    [ready, session, profile, startDemo, startPersonal, setSession, updateProfile, signOut, resetDemo, resetPersonal],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
