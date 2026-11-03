import { Platform } from 'react-native';

/**
 * 디자인 토큰 — A안(2026-11-01 사용자 확정): 밝은 종이색 바탕 × 연한 파랑. 기준 문서 DESIGN-A.md.
 * (이전 청록 테마 기준은 DESIGN.md 에 그대로 보존)
 * 대비(흰 바탕 기준): accent 4.79:1, textSecondary 6.2:1, textTertiary 4.94:1, 상태색 글자/바탕 쌍 6.5:1 이상.
 * 버튼 테두리는 A안의 #7F96E0(2.86:1)이 테두리 대비 기준 3:1 에 못 미쳐 accent(#4D6DCD)를 쓴다.
 */

export const colors = {
  bg: '#FAFAF7', // 종이색 바탕
  surface: '#FFFFFF',
  surfacePressed: '#F3F3EE',
  fill: '#F3F3EE', // 블록 안의 입력칸·보조 버튼 바탕
  divider: '#E4E4DE', // 괘선
  text: '#1B1F2A',
  textSecondary: '#5B6170',
  /** 흰 블록 위·종이색 위 모두 4.5:1 이상 */
  textTertiary: '#6B7080',
  textDisabled: '#A8ACB5',
  accent: '#4D6DCD', // 글자·링크·탭·포커스·선택 테두리
  accentPressed: '#3F5DB8',
  accentSoft: '#E3E7FB', // 파랑의 옅은 면
  accentSoftPressed: '#D3DAF7',
  accentSoftText: '#2C428F',
  navy: '#14214F', // 연한 파랑 면 위 글자·버튼 글자
  paleBlue: '#AFC0F0', // 강조 카드의 옅은 테두리(장식용)
  progress: '#7F96E0', // 진행 막대·출석률 링
  onAccent: '#FFFFFF',
  danger: '#C24141',
  dangerSoft: '#FBE5E5', // 경고(로즈)
  dangerText: '#8A2B2B',
  warningSoft: '#FBEFD3', // 주의(앰버)
  warningText: '#7A4B00',
  successSoft: '#E1F0E6',
  successText: '#1E5A33',
  infoSoft: '#DDF0F8', // 정보(스카이)
  infoText: '#14566F',
  focus: '#4D6DCD',
} as const;

/** 출처 배지. 공식=파랑, 학생·본인=회색, 샘플=앰버. 색만이 아니라 글자로도 구분된다. */
export const sourceColors = {
  official_public: { bg: '#E3E7FB', fg: '#2C428F' },
  kslife: { bg: '#E3E7FB', fg: '#2C428F' },
  community: { bg: '#F3F3EE', fg: '#5B6170' },
  user_input: { bg: '#F3F3EE', fg: '#5B6170' },
  demo: { bg: '#FBEFD3', fg: '#7A4B00' },
} as const;

/** 4 단위 간격. 화면 좌우 여백은 gutter(20). */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 40 } as const;
export const gutter = 20;

/**
 * 모서리 규칙: 블록 18 / 버튼·입력 14 / 배지 6 / 칩·세그먼트 pill.
 */
export const radius = { badge: 6, segment: 10, control: 14, block: 18, pill: 999 } as const;

/**
 * 글꼴 (웹만 지정, +html.tsx 에서 Google Fonts 로 불러온다). 네이티브는 시스템 글꼴.
 * 본문: Noto Sans JP(일본어) → Noto Sans KR(한글). 제목: Shippori Mincho → Noto Serif KR.
 */
const web = Platform.OS === 'web';
export const fonts = {
  sans: web ? "'Noto Sans JP', 'Noto Sans KR', system-ui, sans-serif" : undefined,
  serif: web ? "'Shippori Mincho', 'Noto Serif KR', serif" : undefined,
};

/** 글자 단계: [크기, 줄높이]. 같은 계층은 같은 단계만 쓴다. display·title 은 명조 제목체 */
export const type = {
  display: { fontSize: 26, lineHeight: 36, fontWeight: '700', fontFamily: fonts.serif },
  title: { fontSize: 20, lineHeight: 28, fontWeight: '700', fontFamily: fonts.serif },
  headline: { fontSize: 17, lineHeight: 26, fontWeight: '600', fontFamily: fonts.sans },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400', fontFamily: fonts.sans },
  sub: { fontSize: 14, lineHeight: 20, fontWeight: '400', fontFamily: fonts.sans },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500', fontFamily: fonts.sans },
} as const;

export const MIN_TOUCH = 48;
export const CONTROL_HEIGHT = 56;

/** 넓은 화면(PC) 배치 기준. 이 폭 이상이면 왼쪽 메뉴 + 넓은 본문(2단) */
export const WIDE_MIN = 1024;
export const CONTENT_MAX = 1300;
/** 글쓰기·상세·설정 화면의 PC 본문 폭 */
export const READING_MAX = 1080;
