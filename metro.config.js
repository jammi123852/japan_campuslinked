// Metro 설정: 기본값 + 공개 데모용 `node:crypto` 대체.
// 앱 코드는 원래 node:crypto 를 쓰지 않는다. 공개 데모가 브라우저에서 server/summaries.ts(후기 집계)를 재사용할 때만 이 대체가 쓰인다.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const shim = path.resolve(__dirname, 'src/lib/demo/cryptoShim.ts');
const original = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'node:crypto') return { type: 'sourceFile', filePath: shim };
  return original ? original(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
