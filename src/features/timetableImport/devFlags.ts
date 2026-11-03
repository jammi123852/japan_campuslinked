/** 개발 빌드에서만 가상 OCR 결과로 확인 화면을 열 수 있게 한다. 배포 빌드에서는 항상 false */
export function devSampleEnabled(param: string | undefined) {
  return __DEV__ && param === '1';
}
