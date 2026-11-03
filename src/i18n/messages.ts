import type { AuthMessage } from '@/services/auth';
import type { SaveResult } from '@/services/profileRepository';
import type { Strings } from './ko';

/** 서비스 계층이 돌려준 코드를 현재 언어 문구로 바꾼다 */
export function authMessageText(t: Strings, m: AuthMessage): string {
  switch (m.code) {
    case 'notConfigured':
      return t.auth.errNotConfigured;
    case 'invalid':
      return t.auth.errInvalid;
    case 'notConfirmed':
      return t.auth.errNotConfirmed;
    case 'registered':
      return t.auth.errRegistered;
    case 'weakPassword':
      return t.auth.errWeakPassword;
    case 'network':
      return t.auth.errNetwork;
    case 'confirmSent':
      return t.auth.confirmSent;
    case 'resetSent':
      return t.auth.resetSent;
    case 'unknown':
      return t.auth.errUnknown(m.detail);
  }
}

export function saveErrorText(t: Strings, r: Extract<SaveResult, { ok: false }>): string {
  if (r.code === 'supabaseMissing') return t.profile.errSupabaseMissing;
  if (r.code === 'notSignedIn') return t.profile.errNotSignedIn;
  return t.profile.errServerSave(r.detail ?? '');
}
