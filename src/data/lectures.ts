import type { SourceMeta } from './types';

/**
 * 발표용 가상 강의 카탈로그.
 * 실제 규슈산업대 강의·교수가 아니다. 과목명은 일반적인 이름이고 교수명은 "교원 A" 식 가상 표시이며,
 * 후기도 모두 가상이다. 화면에는 출처 배지 "샘플"이 붙는다.
 * 학부 id 는 faculties.ts(학교 공개 목록)의 id 를 사용한다.
 * 공식 강의계획서 URL 은 확인된 것이 없으므로 모두 null.
 */

export type AttendanceMethod = 'in_person' | 'online' | 'hybrid';
export type Level = 1 | 2 | 3 | 4 | 5;

export interface LectureMeeting {
  /** 0=월 … 6=일 */
  weekday: number;
  period: number;
}

export interface LectureReview {
  id: string;
  /** 작성자 학년 */
  grade: number;
  /** 수강 연도 */
  takenYear: number;
  createdAt: string;
  rating: Level;
  body: { ko: string; ja: string };
}

export interface Lecture {
  id: string;
  name: { ko: string; ja: string };
  instructor: { ko: string; ja: string };
  facultyId: string;
  /** 대상 학년 */
  grades: number[];
  meetings: LectureMeeting[];
  room: string;
  attendance: AttendanceMethod;
  /** 평가 방법 비율 (합 100) */
  evaluation: { exam: number; report: number; participation: number };
  workload: Level;
  difficulty: Level;
  keywords: string[];
  syllabusUrl: string | null;
  reviews: LectureReview[];
  source: SourceMeta;
}

const SAMPLE: SourceMeta = { kind: 'demo', note: '架空の講義データ(発表用)' };

const r = (id: string, grade: number, takenYear: number, createdAt: string, rating: Level, ko: string, ja: string): LectureReview => ({
  id,
  grade,
  takenYear,
  createdAt,
  rating,
  body: { ko, ja },
});

export const LECTURES: Lecture[] = [
  {
    id: 'lec-info-literacy',
    name: { ko: '정보 리터러시', ja: '情報リテラシー' },
    instructor: { ko: '교원 A (가상)', ja: '教員A(架空)' },
    facultyId: 'rikou',
    grades: [1],
    meetings: [{ weekday: 0, period: 2 }],
    room: '1号館 201',
    attendance: 'in_person',
    evaluation: { exam: 40, report: 40, participation: 20 },
    workload: 2,
    difficulty: 2,
    keywords: ['컴퓨터', 'PC', 'パソコン', 'Excel', '入門'],
    syllabusUrl: null,
    reviews: [
      r('rv-1', 2, 2025, '2026-02-10', 4, '매주 실습 과제가 있지만 수업 시간 안에 끝나는 분량이었어요. (가상 후기)', '毎週の演習課題は授業中に終わる量でした。(架空のレビュー)'),
      r('rv-2', 1, 2025, '2026-01-28', 3, '엑셀 기초부터 해서 처음 배우는 사람에게 좋았습니다. (가상 후기)', 'Excelの基礎からなので初心者に向いています。(架空のレビュー)'),
    ],
    source: SAMPLE,
  },
  {
    id: 'lec-statistics',
    name: { ko: '통계학 입문', ja: '統計学入門' },
    instructor: { ko: '교원 B (가상)', ja: '教員B(架空)' },
    facultyId: 'keizai',
    grades: [1, 2],
    meetings: [{ weekday: 1, period: 3 }],
    room: '3号館 101',
    attendance: 'in_person',
    evaluation: { exam: 70, report: 20, participation: 10 },
    workload: 3,
    difficulty: 4,
    keywords: ['통계', 'データ', '確率', '数学'],
    syllabusUrl: null,
    reviews: [
      r('rv-3', 3, 2025, '2026-02-02', 3, '기말시험 비중이 커서 시험 전에 복습이 꼭 필요해요. (가상 후기)', '期末試験の比重が大きいので復習が必須です。(架空のレビュー)'),
    ],
    source: SAMPLE,
  },
  {
    id: 'lec-english-comm',
    name: { ko: '영어 커뮤니케이션', ja: '英語コミュニケーション' },
    instructor: { ko: '교원 C (가상)', ja: '教員C(架空)' },
    facultyId: 'kokusai',
    grades: [1, 2],
    meetings: [
      { weekday: 0, period: 4 },
      { weekday: 3, period: 4 },
    ],
    room: '2号館 305',
    attendance: 'in_person',
    evaluation: { exam: 30, report: 20, participation: 50 },
    workload: 3,
    difficulty: 3,
    keywords: ['영어', 'English', '英会話', '発表'],
    syllabusUrl: null,
    reviews: [
      r('rv-4', 2, 2025, '2026-01-20', 5, '발표가 많지만 분위기가 편해서 말하기 연습에 좋았어요. (가상 후기)', '発表が多いですが雰囲気が良く、話す練習になります。(架空のレビュー)'),
      r('rv-5', 1, 2024, '2025-02-15', 4, '출석과 참여 점수 비중이 큽니다. (가상 후기)', '出席と参加点の比重が大きいです。(架空のレビュー)'),
    ],
    source: SAMPLE,
  },
  {
    id: 'lec-programming-1',
    name: { ko: '프로그래밍 기초', ja: 'プログラミング基礎' },
    instructor: { ko: '교원 D (가상)', ja: '教員D(架空)' },
    facultyId: 'rikou',
    grades: [1, 2],
    meetings: [{ weekday: 2, period: 2 }],
    room: '12号館 PC室',
    attendance: 'hybrid',
    evaluation: { exam: 30, report: 60, participation: 10 },
    workload: 4,
    difficulty: 3,
    keywords: ['Python', '코딩', 'プログラミング', 'IT'],
    syllabusUrl: null,
    reviews: [
      r('rv-6', 2, 2025, '2026-02-12', 4, '과제가 꽤 있지만 질문하면 잘 알려 주는 수업이었어요. (가상 후기)', '課題は多めですが、質問すると丁寧に教えてくれます。(架空のレビュー)'),
    ],
    source: SAMPLE,
  },
  {
    id: 'lec-microecon',
    name: { ko: '미시경제학', ja: 'ミクロ経済学' },
    instructor: { ko: '교원 E (가상)', ja: '教員E(架空)' },
    facultyId: 'keizai',
    grades: [2, 3],
    meetings: [{ weekday: 3, period: 2 }],
    room: '5号館 401',
    attendance: 'in_person',
    evaluation: { exam: 80, report: 10, participation: 10 },
    workload: 2,
    difficulty: 4,
    keywords: ['경제', '経済', '需要', '供給'],
    syllabusUrl: null,
    reviews: [],
    source: SAMPLE,
  },
  {
    id: 'lec-marketing',
    name: { ko: '마케팅론', ja: 'マーケティング論' },
    instructor: { ko: '교원 F (가상)', ja: '教員F(架空)' },
    facultyId: 'sho',
    grades: [2, 3, 4],
    meetings: [{ weekday: 4, period: 3 }],
    room: '6号館 202',
    attendance: 'online',
    evaluation: { exam: 0, report: 70, participation: 30 },
    workload: 3,
    difficulty: 2,
    keywords: ['마케팅', 'マーケティング', '広告', 'ブランド'],
    syllabusUrl: null,
    reviews: [
      r('rv-7', 3, 2025, '2026-01-30', 4, '온라인이라 시간 관리가 편했고 리포트 위주예요. (가상 후기)', 'オンラインで時間の調整がしやすく、レポート中心です。(架空のレビュー)'),
    ],
    source: SAMPLE,
  },
  {
    id: 'lec-tourism',
    name: { ko: '관광학 개론', ja: '観光学概論' },
    instructor: { ko: '교원 G (가상)', ja: '教員G(架空)' },
    facultyId: 'chiiki',
    grades: [1],
    meetings: [{ weekday: 1, period: 1 }],
    room: '8号館 101',
    attendance: 'in_person',
    evaluation: { exam: 50, report: 40, participation: 10 },
    workload: 2,
    difficulty: 2,
    keywords: ['관광', '観光', '地域', '福岡'],
    syllabusUrl: null,
    reviews: [],
    source: SAMPLE,
  },
  {
    id: 'lec-psychology',
    name: { ko: '심리학 입문', ja: '心理学入門' },
    instructor: { ko: '교원 H (가상)', ja: '教員H(架空)' },
    facultyId: 'human_sciences',
    grades: [1, 2],
    meetings: [{ weekday: 2, period: 4 }],
    room: '9号館 301',
    attendance: 'hybrid',
    evaluation: { exam: 60, report: 30, participation: 10 },
    workload: 2,
    difficulty: 3,
    keywords: ['심리', '心理', 'カウンセリング'],
    syllabusUrl: null,
    reviews: [
      r('rv-8', 2, 2024, '2025-02-20', 5, '예시가 많아서 이해하기 쉬웠어요. (가상 후기)', '例が多くて理解しやすかったです。(架空のレビュー)'),
    ],
    source: SAMPLE,
  },
  {
    id: 'lec-design-basic',
    name: { ko: '디자인 기초 실습', ja: 'デザイン基礎演習' },
    instructor: { ko: '교원 I (가상)', ja: '教員I(架空)' },
    facultyId: 'geijutsu',
    grades: [1],
    meetings: [
      { weekday: 4, period: 1 },
      { weekday: 4, period: 2 },
    ],
    room: '17号館 アトリエ',
    attendance: 'in_person',
    evaluation: { exam: 0, report: 80, participation: 20 },
    workload: 5,
    difficulty: 3,
    keywords: ['디자인', 'デザイン', '制作', 'ポートフォリオ'],
    syllabusUrl: null,
    reviews: [
      r('rv-9', 2, 2025, '2026-02-05', 4, '작품 제작 시간이 길어서 과제량이 많은 편이에요. (가상 후기)', '制作時間が長く、課題量は多めです。(架空のレビュー)'),
    ],
    source: SAMPLE,
  },
  {
    id: 'lec-architecture-history',
    name: { ko: '건축사', ja: '建築史' },
    instructor: { ko: '교원 J (가상)', ja: '教員J(架空)' },
    facultyId: 'kenchiku',
    grades: [2, 3],
    meetings: [{ weekday: 0, period: 3 }],
    room: '15号館 201',
    attendance: 'in_person',
    evaluation: { exam: 60, report: 30, participation: 10 },
    workload: 2,
    difficulty: 3,
    keywords: ['건축', '建築', '歴史'],
    syllabusUrl: null,
    reviews: [],
    source: SAMPLE,
  },
  {
    id: 'lec-biology',
    name: { ko: '생명과학 개론', ja: '生命科学概論' },
    instructor: { ko: '교원 K (가상)', ja: '教員K(架空)' },
    facultyId: 'seimei',
    grades: [1],
    meetings: [{ weekday: 3, period: 1 }],
    room: '20号館 102',
    attendance: 'online',
    evaluation: { exam: 70, report: 30, participation: 0 },
    workload: 2,
    difficulty: 3,
    keywords: ['생명', '生命', 'バイオ', '生物'],
    syllabusUrl: null,
    reviews: [],
    source: SAMPLE,
  },
];

export function findLecture(id: string | undefined) {
  return LECTURES.find((l) => l.id === id);
}
