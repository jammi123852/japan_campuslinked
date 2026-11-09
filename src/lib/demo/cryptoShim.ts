/**
 * 공개 데모 빌드에서 server/summaries.ts 의 `node:crypto` 를 대신한다(metro.config.js 가 연결).
 * 후기 변경 감지용 지문만 만든다 — 보안 용도가 아니며 서버의 sha256 값과 같지 않다.
 */
function fnv(s: string, seed: number) {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function createHash(_alg: string) {
  let buf = '';
  const api = {
    update(s: string) {
      buf += s;
      return api;
    },
    digest(_enc: string) {
      return [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f, 0x165667b1, 0xd3a2646c].map((seed) => fnv(buf, seed)).join('');
    },
  };
  return api;
}
