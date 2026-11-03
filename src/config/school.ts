/**
 * 발표용 학교 메일 입장 설정.
 * 허용 도메인은 EXPO_PUBLIC_SCHOOL_EMAIL_DOMAINS (쉼표 구분)로 바꾼다.
 * 규슈산업대 학생 메일 도메인은 학교 공식 자료로 아직 확인하지 못했다(학교 홈페이지 도메인과 같다고 가정하지 않음).
 * 기본값은 테스트 전용 예약 도메인(.test, RFC 6761)이다.
 */
const fromEnv = (process.env.EXPO_PUBLIC_SCHOOL_EMAIL_DOMAINS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const SCHOOL_EMAIL_DOMAINS: string[] = fromEnv.length > 0 ? fromEnv : ['ksu-demo.test'];

/** 공식 자료로 확인된 도메인인지 (확인되면 true 로 바꾸고 출처를 주석에 남길 것) */
export const SCHOOL_EMAIL_DOMAINS_VERIFIED = false;

const EMAIL_RE = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;

export type SchoolEmailCheck = { ok: true } | { ok: false; reason: 'format' | 'domain' };

/** 형식과 허용 도메인만 확인한다. 메일 수신·재학 여부는 확인하지 않는다 */
export function checkSchoolEmail(email: string, domains = SCHOOL_EMAIL_DOMAINS): SchoolEmailCheck {
  const m = EMAIL_RE.exec(email.trim().toLowerCase());
  if (!m) return { ok: false, reason: 'format' };
  return domains.includes(m[1]) ? { ok: true } : { ok: false, reason: 'domain' };
}
