/** 짧은 문자열 해시 (FNV-1a 32bit, 16진수). 일정 중복 방지용 키에 쓴다 — 보안 용도 아님 */
export function createHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
