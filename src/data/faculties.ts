import type { Faculty, SourceMeta } from './types';

/**
 * 九州産業大学 学部・学科一覧(公開公式資料から収集)。
 * コース名は収集元ページに掲載がなかったため含めない(ユーザーが自由入力)。
 * 自動取得したため verification は needs_review。人手で確認後に verified へ更新すること。
 */
export const FACULTY_SOURCE: SourceMeta = {
  kind: 'official_public',
  url: 'https://www.kyusan-u.ac.jp/faculty/',
  collectedAt: '2026-10-29',
  verification: 'needs_review',
  note: '学部・学科一覧ページより収集。コース名は掲載なし。',
};

export const FACULTIES: Faculty[] = [
  {
    id: 'kokusai',
    name: '国際文化学部',
    departments: [
      { id: 'kokusai-bunka', name: '国際文化学科' },
      { id: 'nihon-bunka', name: '日本文化学科' },
    ],
  },
  {
    id: 'human_sciences',
    name: '人間科学部',
    departments: [
      { id: 'rinsho-shinri', name: '臨床心理学科' },
      { id: 'kodomo-kyoiku', name: '子ども教育学科' },
      { id: 'sports-kenko', name: 'スポーツ健康科学科' },
    ],
  },
  {
    id: 'keizai',
    name: '経済学部',
    departments: [{ id: 'keizai', name: '経済学科' }],
  },
  {
    id: 'sho',
    name: '商学部',
    departments: [{ id: 'keiei-ryutsu', name: '経営・流通学科' }],
  },
  {
    id: 'chiiki',
    name: '地域共創学部',
    departments: [
      { id: 'kanko', name: '観光学科' },
      { id: 'chiiki-zukuri', name: '地域づくり学科' },
    ],
  },
  {
    id: 'rikou',
    name: '理工学部',
    departments: [
      { id: 'joho-kagaku', name: '情報科学科' },
      { id: 'kikai-denki-sozo', name: '機械電気創造工学科' },
      { id: 'smart-communication', name: 'スマートコミュニケーション工学科' },
      // 掲載ページで「〜2025年」と表記されている学科(2025年度以前の入学者向け)
      { id: 'kikai', name: '機械工学科', lastAdmissionYear: 2025 },
      { id: 'denki', name: '電気工学科', lastAdmissionYear: 2025 },
    ],
  },
  {
    id: 'seimei',
    name: '生命科学部',
    departments: [{ id: 'seimei-kagaku', name: '生命科学科' }],
  },
  {
    id: 'kenchiku',
    name: '建築都市工学部',
    departments: [
      { id: 'kenchiku', name: '建築学科' },
      { id: 'jukyo-interior', name: '住居・インテリア学科' },
      { id: 'toshi-design', name: '都市デザイン工学科' },
    ],
  },
  {
    id: 'geijutsu',
    name: '芸術学部',
    departments: [
      { id: 'geijutsu-hyogen', name: '芸術表現学科' },
      { id: 'shashin-eizo', name: '写真・映像メディア学科' },
      { id: 'visual-design', name: 'ビジュアルデザイン学科' },
      { id: 'seikatsu-kankyo', name: '生活環境デザイン学科' },
      { id: 'social-design', name: 'ソーシャルデザイン学科' },
    ],
  },
];

/** 학부·학과 한국어 표기 (비공식 번역). 공식 표기는 일본어 원문을 그대로 함께 보여 준다 */
export const ORG_KO: Record<string, string> = {
  国際文化学部: '국제문화학부', 国際文化学科: '국제문화학과', 日本文化学科: '일본문화학과',
  人間科学部: '인간과학부', 臨床心理学科: '임상심리학과', 子ども教育学科: '어린이교육학과', スポーツ健康科学科: '스포츠건강과학과',
  経済学部: '경제학부', 経済学科: '경제학과', 商学部: '상학부', '経営・流通学科': '경영·유통학과',
  地域共創学部: '지역공창학부', 観光学科: '관광학과', 地域づくり学科: '지역만들기학과',
  理工学部: '이공학부', 情報科学科: '정보과학과', 機械電気創造工学科: '기계전기창조공학과', スマートコミュニケーション工学科: '스마트커뮤니케이션공학과', 機械工学科: '기계공학과', 電気工学科: '전기공학과',
  生命科学部: '생명과학부', 生命科学科: '생명과학과',
  建築都市工学部: '건축도시공학부', 建築学科: '건축학과', '住居・インテリア学科': '주거·인테리어학과', 都市デザイン工学科: '도시디자인공학과',
  芸術学部: '예술학부', 芸術表現学科: '예술표현학과', '写真・映像メディア学科': '사진·영상미디어학과', ビジュアルデザイン学科: '비주얼디자인학과', 生活環境デザイン学科: '생활환경디자인학과', ソーシャルデザイン学科: '소셜디자인학과',
  造形短期大学部: '조형단기대학부', 造形芸術学科: '조형예술학과',
};

/** 한 언어만: 한국어 모드는 한국어 이름(없으면 공식 표기), 일본어 모드는 공식 표기 (병기하지 않음) */
export function orgLabel(name: string | undefined, locale: string) {
  if (!name) return '';
  return locale === 'ko' ? (ORG_KO[name] ?? name) : name;
}

/** 좁은 줄(홈 머리글)용: 한국어 모드는 한국어만, 일본어 모드는 공식 표기 */
export function orgShort(name: string | undefined, locale: string) {
  if (!name) return '';
  return locale === 'ko' ? (ORG_KO[name] ?? name) : name;
}

export function findFaculty(id: string | undefined) {
  return FACULTIES.find((f) => f.id === id);
}

export function findDepartment(facultyId: string | undefined, departmentId: string | undefined) {
  return findFaculty(facultyId)?.departments.find((d) => d.id === departmentId);
}

/** 入学年度で選択可能な学科だけを返す(募集停止後の学科を新入生に出さない) */
export function selectableDepartments(facultyId: string, admissionYear: number) {
  const faculty = findFaculty(facultyId);
  if (!faculty) return [];
  return faculty.departments.filter(
    (d) => d.lastAdmissionYear === undefined || admissionYear <= d.lastAdmissionYear,
  );
}

/**
 * 관심 분야는 언어와 무관한 id 로 저장하고, 표시 이름은 i18n 테이블(interests[index])에서 가져온다.
 */
export const INTEREST_IDS = [
  'classes',
  'exams',
  'career',
  'certs',
  'scholarship',
  'clubs',
  'parttime',
  'abroad',
  'events',
  'research',
  'it',
  'design',
] as const;

export function interestLabel(value: string, labels: string[]): string {
  const i = INTEREST_IDS.indexOf(value as (typeof INTEREST_IDS)[number]);
  // 예전 버전은 일본어 표시 이름 자체를 저장했으므로 그대로 보여 준다
  return i >= 0 ? labels[i] : value;
}
