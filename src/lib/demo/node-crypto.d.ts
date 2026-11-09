// 앱 타입 검사용: 공개 데모가 server/summaries.ts 를 가져올 때 필요한 최소 선언 (실행 때는 metro.config.js 가 cryptoShim 으로 연결)
declare module 'node:crypto' {
  interface Hash {
    update(data: string): Hash;
    digest(encoding: 'hex'): string;
  }
  export function createHash(algorithm: string): Hash;
}
