import type { OcrLine } from './parseTimetable';

/**
 * 개발 확인용 가상 OCR 결과 (실제 학교 시간표가 아님).
 * OCR 네이티브 모듈이 없는 웹·Expo Go 에서 확인 화면을 점검할 때만 쓴다
 * (/timetable-import?devSample=1, __DEV__ 빌드 한정).
 */
const l = (text: string, left: number, top: number, width = 70, height = 16): OcrLine => ({
  text,
  frame: { left, top, width, height },
});

export const DEV_SAMPLE_OCR: OcrLine[] = [
  l('2026年度 後期 時間割', 140, 4, 220),
  ...['月', '火', '水', '木', '金'].map((d, i) => l(d, 120 + i * 100, 40, 20)),
  ...[1, 2, 3, 4, 5].map((p) => l(`${p}限`, 15, 122 + (p - 1) * 100, 30)),
  ...['09:00', '10:40', '13:00', '14:40', '16:20'].map((tm, i) => l(tm, 10, 142 + i * 100, 40)),
  l('情報リテラシー', 105, 100),
  l('1号館 201', 105, 120),
  l('統計学入門', 305, 300),
  l('A301', 305, 320),
  l('山田', 305, 340),
  l('英語コミュニケーション', 205, 200),
  l('ゼミ', 405, 400),
];
