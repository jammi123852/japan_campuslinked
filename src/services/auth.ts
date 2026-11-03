import type { AppSession } from '@/data/types';
import { readJson, removeKey, StorageKeys, writeJson } from '@/lib/storage';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/**
 * 認証サービス。
 * - デモ: 端末内だけのセッション。サーバーには何も送らない。
 * - Supabase: メール + パスワード認証。
 * 学校メール認証(@*.kyusan-u.ac.jp 等)は verifySchoolAffiliation を後で実装して拡張する。
 * K'sLife のID・パスワードは収集しない。
 */

export const DEMO_USER_ID = 'demo-local';

/** 화면에서 번역할 메시지 코드. 문구는 i18n 테이블(auth.*)에 있다. */
export type AuthMessage =
  | { code: 'notConfigured' | 'invalid' | 'notConfirmed' | 'registered' | 'weakPassword' | 'network' | 'confirmSent' | 'resetSent' }
  | { code: 'unknown'; detail: string };

export type AuthResult = { ok: true; session: AppSession | null; message?: AuthMessage } | { ok: false; message: AuthMessage };

const NOT_CONFIGURED: AuthMessage = { code: 'notConfigured' };

function translateError(message: string): AuthMessage {
  if (/Invalid login credentials/i.test(message)) return { code: 'invalid' };
  if (/Email not confirmed/i.test(message)) return { code: 'notConfirmed' };
  if (/already registered/i.test(message)) return { code: 'registered' };
  if (/Password should be/i.test(message)) return { code: 'weakPassword' };
  if (/network|fetch/i.test(message)) return { code: 'network' };
  return { code: 'unknown', detail: message };
}

/** 保存済みセッションを復元する(アプリ起動時) */
export async function restoreSession(): Promise<AppSession | null> {
  const stored = await readJson<AppSession>(StorageKeys.session);
  if (stored?.mode === 'demo' || stored?.mode === 'personal') return stored;

  if (stored?.mode === 'supabase' && supabase) {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (user) {
      const session: AppSession = { mode: 'supabase', userId: user.id, email: user.email ?? null };
      await writeJson(StorageKeys.session, session);
      return session;
    }
  }
  // Supabase セッション切れ、または Supabase 設定が外された場合
  if (stored) await removeKey(StorageKeys.session);
  return null;
}

/** 데모 입장. 발표용 학교 메일 입장이면 형식만 확인된 메일을 같이 기록한다(수신 확인 안 함) */
export async function startDemo(email: string | null = null): Promise<AppSession> {
  const session: AppSession = { mode: 'demo', userId: DEMO_USER_ID, email };
  await writeJson(StorageKeys.session, session);
  return session;
}

/**
 * 개인 모드: 이 기기에 내 자료만 저장 (가상 수업·마감 없음). 서버 계정이 아니며 학교 메일 인증도 아니다.
 * 데모 체험 데이터(demo-local)와 저장 공간을 나눈다.
 */
export const PERSONAL_USER_ID = 'personal-local';
export async function startPersonal(email: string | null = null): Promise<AppSession> {
  const session: AppSession = { mode: 'personal', userId: PERSONAL_USER_ID, email };
  await writeJson(StorageKeys.session, session);
  return session;
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error || !data.user) return { ok: false, message: translateError(error?.message ?? 'unknown') };
  const session: AppSession = { mode: 'supabase', userId: data.user.id, email: data.user.email ?? null };
  await writeJson(StorageKeys.session, session);
  return { ok: true, session };
}

export async function signUp(email: string, password: string): Promise<AuthResult> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
  if (error) return { ok: false, message: translateError(error.message) };
  // メール確認が有効なプロジェクトでは session が null で返る
  if (!data.session || !data.user) {
    return { ok: true, session: null, message: { code: 'confirmSent' } };
  }
  const session: AppSession = { mode: 'supabase', userId: data.user.id, email: data.user.email ?? null };
  await writeJson(StorageKeys.session, session);
  return { ok: true, session };
}

export async function requestPasswordReset(email: string): Promise<AuthResult> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
  if (error) return { ok: false, message: translateError(error.message) };
  return { ok: true, session: null, message: { code: 'resetSent' } };
}

export async function signOut(session: AppSession | null): Promise<void> {
  if (session?.mode === 'supabase' && supabase) {
    await supabase.auth.signOut();
  }
  await removeKey(StorageKeys.session);
}

export { isSupabaseConfigured };

/**
 * 学校所属の確認(未実装)。
 * 将来: 大学発行メールのドメイン確認、または大学公式の認証連携が提供された場合に実装する。
 */
export async function verifySchoolAffiliation(): Promise<'not_implemented'> {
  return 'not_implemented';
}
