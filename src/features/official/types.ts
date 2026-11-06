/**
 * 규슈산업대 공식자료에서 만든 구조화 데이터의 형식 (public/official/ksu-2026.json).
 * 생성: ~/ksu-official-work/build_official.py — 원본 PDF 를 대조해 만든 로컬 검증용 데이터.
 * 공개 재사용 허가가 확인되지 않아 배포 스크립트가 기본적으로 공개 빌드에서 뺀다.
 */

export type Quarter = '1Q' | '2Q' | '3Q' | '4Q';
export const QUARTERS: Quarter[] = ['1Q', '2Q', '3Q', '4Q'];

export interface SourceRef {
  id: string;
  page?: number;
  note?: string;
}

export interface OfficialCourse {
  id: string;
  term: '前期' | '後期';
  /** 학년도 */
  ay?: number;
  /** 원문 분류를 보존하는 트랙: 전공·기초교육·외국어·교직/자격·유학생·GFBP·단대 */
  track?: CourseTrack;
  /** 공식 시라버스 카테고리 원문 */
  categoryRaw?: string;
  /** 과목코드 (과목 정의 키). 같은 코드라도 분반·입학연도별 구분은 다를 수 있다 */
  code?: string | null;
  subjectName?: string | null;
  grade?: string | null;
  numbering?: string[];
  /** 개설 학과 코드 (시라버스 번호 체계·시간표 원본 기준) */
  depts?: string[];
  /** 학과별 표기: 같은 분반도 학과·입학연도에 따라 구분이 다를 수 있어 합치지 않는다 */
  applies?: CourseApply[];
  cohortText?: string | null;
  /** 대상 입학연도 구간 [from, to] (null 은 끝없음). 비어 있으면 표기 미확인 */
  cohortRanges?: [number | null, number | null][];
  credits?: number | null;
  creditType?: string | null;
  kind?: string | null;
  subjectType?: string | null;
  hasSyllabus?: boolean;
  prereq?: string | null;
  offTimetable?: boolean;
  /** 집중강의 일정 (원본 일정표 그대로) */
  schedule?: { dates: string[]; room: string | null; term: string | null; note: string; source: SourceRef };
  wp?: string;
  sources?: SourceRef[];
  name: string;
  section: string | null;
  instructor: string | null;
  /** 시간표 행의 학년(배당 학년 표시) */
  year: number;
  /** required(＊)·required_tech(〇)·required_math(△)·selective(△)·elective(□)·null(무표시) — 학과별 범례·시라버스 구분 */
  mark: 'required' | 'required_tech' | 'required_math' | 'selective' | 'elective' | null;
  classTag: string | null;
  /** 대상 입학연도 표기 원문 (예: 17RS以降, 17-24RS, 25RS以降/17-24RS) */
  cohort: string;
  rooms: string[];
  meetings: { weekday: number; period: number }[];
  quarters: Quarter[];
  note: string | null;
  source: SourceRef;
  review: string[];
  syllabus?: {
    code: string;
    credits: number;
    kind: string;
    grade: number;
    summary: string;
    evaluation: string;
    textbook?: string;
    restriction?: string;
    prerequisite?: string;
    checkedAt: string;
    note?: string;
    source?: string;
  };
}

export type CourseTrack = 'major' | 'kiso' | 'foreign' | 'teaching' | 'intl' | 'gfbp' | 'junior' | 'other';

export interface CourseApply {
  dept: string;
  gfbp?: boolean;
  heads: string[];
  mark: string | null;
  cohorts: [number | null, number | null][];
  source: SourceRef;
}

/** 공식 시라버스 상세 (과목별 원문. 없는 과목에 다른 과목 내용을 넣지 않는다) */
export interface SyllabusDetail {
  outline: string;
  goals: string;
  evaluation: string;
  criteria: string;
  rules: string;
  prereq: string;
  prep: string;
  related: string;
  plan: string[];
  textbooks: { title: string; author: string | null; publisher: string | null; isbn: string }[];
  textbookNote: string | null;
  assigned: { title: string; author: string | null; publisher: string | null; isbn: string }[];
  references: { title: string; author: string | null; publisher: string | null; isbn: string }[];
  checkedAt: string;
  remark: string | null;
}

/** 운영팀 공식자료 정리글 색인. 실제 학생 후기와 별도 유형 — 평점·후기 수에 합산하지 않는다 */
export interface OpsPostMeta {
  id: string;
  offeringId: string;
  title: string;
  rev: number;
  createdAt: string;
  updatedAt: string;
  sourceHash: string;
  hasSyllabus: boolean;
}

export interface OfficialExam {
  id: string;
  /** 전 학부 자동 대조 행: 공식 분반 id */
  offeringId?: string;
  mode?: string | null;
  date: string;
  period: number;
  depts: string[];
  name: string;
  nameNote?: string;
  instructor: string;
  /** 시험표 'クラス' 열: 수업 요일·교시 (예: '月4/水4') */
  slots: string[];
  room: string;
  items: string;
  quarter: Quarter;
  source: SourceRef;
}

/** 영역 id. 학과별로 다른 영역은 규칙의 label 을 쓴다 */
export type CategoryId =
  | (string & {})
  | 'senmon_required'
  | 'senmon_elective'
  | 'intro'
  | 'kiso_other'
  | 'english'
  | 'foreign_other'
  | 'senmon_total'
  | 'kiso_total';

export interface GradRule {
  source: SourceRef;
  alsoSource?: SourceRef;
  appliesNote: string;
  /** 세부 영역이 확인되지 않은 규칙 (전체 판정 안 함) */
  partial?: boolean;
  categories: Partial<Record<CategoryId, { min: number; exact?: boolean; label?: string; group?: 'major' | 'kiso' | 'foreign' }>>;
  flex?: { min: number; from: CategoryId[] };
  /** 남는 학점을 다음 묶음으로 넘기는 '더 채우기' 묶음. 순서대로 계산하고 같은 학점을 두 번 세지 않는다 */
  pools?: { id: string; label: string; min: number; from: string[] }[];
  variant?: string;
  /** 표의 학점만 반영 (필수 과목 목록 미반영) */
  creditTableOnly?: boolean;
  total: number;
  promotion3?: { credits: number; courses: string[]; scope: string; source: SourceRef };
  thesisStart?: { credits: number; courses: string[]; source: SourceRef };
}

export interface OfficialDepartment {
  faculty: string;
  department: string;
  code: string;
  courses: { id: string; ja: string }[];
  marks: Record<string, string>;
  marksSource: SourceRef;
  courseSelection?: { text: string; unknown: string[]; source: SourceRef };
  programs?: string[];
  curriculum: { area: string; years: Record<string, string[]> }[];
  curriculumSource: SourceRef;
  rules: Record<string, GradRule>;
  intro?: { source: SourceRef; courses: Record<string, string>; flow: Record<string, string>; qualifications: string[]; note: string };
  cap: { yearly: number; half: number; yearlyHighGpa: number; highGpa: number; note: string; source: SourceRef } | null;
  pageUrl?: string | null;
  closedNote?: string | null;
}

export interface OfficialNotice {
  id: string;
  title: string;
  org: string;
  posted: string | null;
  text: string;
}

export type ScholarshipAnswerKey = 'undergrad' | 'international' | 'gradEntrant' | 'support';

/** 장학금 공지 (공식 원문 그대로). 마감 지남은 앱이 오늘 날짜로 판단 */
export interface OfficialScholarship {
  id: string;
  org: string;
  provider: string;
  title: string;
  summary: string;
  audience: { level: 'undergraduate' | 'graduate_entrant'; text: string; excludesInternational?: boolean };
  conditions: string[];
  conditionsRule: 'all' | 'any';
  /** 사용자 답으로 확인하는 조건. cond 는 conditions 의 위치 */
  checks: { key: ScholarshipAnswerKey; expect: boolean; cond: number }[];
  /** 학교가 판단하는 조건의 위치 (앱은 판정하지 않음) */
  judgedBySchool: number[];
  documents: string[];
  method: string;
  /** YYYY-MM-DDTHH:mm (일본 시각) */
  deadline: string;
  deadlineText: string;
  events: { date: string; time: string; place: string; note: string }[];
  contact: string;
  source: SourceRef;
}

/** 학과 소개 페이지의 학교 프로그램 (홍보 소개, 참가 조건 미기재) */
export interface OfficialActivity {
  id: string;
  dept: string;
  kind: string;
  name: string;
  text: string;
  keywords: string[];
  unknown: string[];
  source: SourceRef;
}

export interface OfficialData {
  version: number;
  collectedAt: string;
  usage: 'local_validation' | 'public';
  /** 이전 정보과학과 전용 id → 전 학부 데이터 id (저장된 시간표·기록 유지) */
  legacyIds?: Record<string, string>;
  legacyCourses?: OfficialCourse[];
  tiers?: Record<string, string>;
  sources: Record<string, { title: string; url: string; note?: string }>;
  calendar: { year: number; source: SourceRef; quarters: { q: Quarter; term: string; start: string; end: string; examStart: string; examNote: string }[] };
  periods: { items: { period: number; start: string; end: string }[]; source: SourceRef };
  examPeriods: { items: { period: number; start: string; end: string }[]; source: SourceRef };
  scope: Record<string, string>;
  courses: OfficialCourse[];
  exams: OfficialExam[];
  examNotes: string[];
  departments: Record<string, OfficialDepartment>;
  notices: OfficialNotice[];
  scholarships?: OfficialScholarship[];
  activities?: OfficialActivity[];
  departmentIndex: { id: string; name: string; courses: string[] | null; url: string; closedNote: string | null }[];
}

/** 공개 빌드 최소본. 재배포 허가 미확인 자료는 빼고 학교 구조·공식 링크만 */
export interface OfficialPublicMin {
  usage: 'public_min';
  collectedAt: string;
  heldBack: { reason: string; items: string[] };
  links: { id: string; title: string; url: string }[];
  departmentIndex: { id: string; name: string; url: string; closedNote: string | null }[];
}
