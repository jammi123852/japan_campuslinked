// 테스트 전용: 앱 코드의 확장자 없는 상대 import('../../lib/dates')를 Node 에서 .ts 로 찾게 한다.
// 사용: node --import ./scripts/ts-resolve.mjs scripts/test-xxx.mjs
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (e) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      throw e;
    }
  },
});
