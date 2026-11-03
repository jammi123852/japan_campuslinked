/**
 * ドメインモデル定義。
 * 1段階で使うもの(プロフィール・ホーム表示)に加え、2〜3段階(検索・コミュニティ・
 * 時間割・出席)の画面が同じ型を使えるよう、最初から出所(DataSource)を分離している。
 */

/** データの出所。UI はこれを見て「公式」「学生投稿」「サンプル」等のバッジを出す。 */
export type DataSourceKind =
  | 'user_input' // ユーザー本人が入力したデータ
  | 'official_public' // 九州産業大学の公開公式資料(出典URL必須)
  | 'community' // 学生が投稿したコミュニティデータ
  | 'demo' // デモ用サンプルデータ(実在の情報ではない)
  | 'kslife'; // 将来の K'sLife 公式連携データ(現時点では未接続)

/** 公式資料・連携データの出典メタデータ。 */
export interface SourceMeta {
  kind: DataSourceKind;
  /** 出典URL(official_public では必須) */
  url?: string;
  /** 収集日 (YYYY-MM-DD) */
  collectedAt?: string;
  /** 適用年度 (例: 2026) */
  academicYear?: number;
  /** 人手での確認状態。unverified のものは公式情報として表示しない。 */
  verification?: 'verified' | 'needs_review' | 'unverified';
  note?: string;
}

// ---------------------------------------------------------------- 学部・学科・コース

export interface Department {
  id: string;
  name: string;
  /** 募集停止など、入学年度によって選択可能かが変わる学科用 */
  lastAdmissionYear?: number;
}

export interface Faculty {
  id: string;
  name: string;
  departments: Department[];
}

/**
 * コースの状態。日本の大学ではコース選択が2年次以降だったり、
 * 学科にコースが存在しなかったりするため、3状態で持つ。
 */
export type CourseStatus = 'selected' | 'undecided' | 'none';

// ---------------------------------------------------------------- プロフィール

export interface UserProfile {
  nickname: string;
  facultyId: string;
  departmentId: string;
  courseStatus: CourseStatus;
  /** courseStatus === 'selected' のときのみ値を持つ(自由入力) */
  courseName: string | null;
  admissionYear: number;
  /** 現在の学年(1〜6。留年・休学等で入学年度から計算しない) */
  currentGrade: number;
  /** 履修科目(1段階では科目名の自由入力。2段階で講義カタログIDと紐付け予定) */
  enrolledCourses: string[];
  /** INTEREST_IDS 의 id */
  interests: string[];
  updatedAt: string;
}

// ---------------------------------------------------------------- 認証セッション

export type AuthMode = 'demo' | 'personal' | 'supabase';

export interface AppSession {
  mode: AuthMode;
  userId: string;
  email: string | null;
}

// ---------------------------------------------------------------- 2〜3段階用モデル(ホームで一部使用)

export interface Notice {
  id: string;
  title: string;
  body: string;
  category: 'academic' | 'exam' | 'scholarship' | 'event' | 'campus' | 'other';
  /** 対象範囲(空なら全学向け) */
  target: { facultyIds?: string[]; departmentIds?: string[]; grades?: number[] };
  publishedAt: string;
  source: SourceMeta;
}

export interface TimetableEntry {
  id: string;
  /** 강의 카탈로그(lectures.ts)에서 추가한 경우 그 강의 id. 중복 추가 판정에 쓴다 */
  lectureId?: string;
  courseName: string;
  /** 0=月 … 5=土 */
  weekday: number;
  period: number;
  /** 'HH:MM'. 학교 공식 교시 시간은 확인 전이므로 사용자가 입력한 값만 쓴다 */
  startTime?: string;
  endTime?: string;
  room?: string;
  /** 교수명 등 기타 메모 (사진 인식 시 과목명·강의실 외 줄) */
  memo?: string;
  /**
   * 적용 기간 (2026-11-01 추가). 학년도 + 쿼터(1Q~4Q). 여러 쿼터에 걸친 수업은 한 항목에 쿼터를 여러 개 둔다.
   * 없으면 '기간 미지정' — 이전에 만든 시간표는 그대로 보존하고 모든 기간에 '기간 미지정'으로 보여 준다.
   */
  term?: { year: number; quarters: ('1Q' | '2Q' | '3Q' | '4Q')[] };
  /** 이전 기간에서 복사해 와서 이번 기간 개설 여부를 다시 확인해야 함 */
  needsRecheck?: boolean;
  source: SourceMeta;
}

export interface Deadline {
  id: string;
  title: string;
  kind: 'assignment' | 'exam' | 'other';
  courseName?: string;
  dueAt: string;
  /** 公開お知らせとの紐付け(3段階) */
  noticeId?: string;
  source: SourceMeta;
}

export interface CommunityPost {
  id: string;
  boardType: 'university' | 'faculty' | 'department' | 'course' | 'lecture';
  boardId: string;
  title: string;
  body: string;
  authorDisplay: { type: 'anonymous' } | { type: 'nickname'; nickname: string };
  isQuestion: boolean;
  answerCount: number;
  createdAt: string;
  /** 将来の投稿期限・情報保存機能用 */
  expiresAt?: string | null;
  source: SourceMeta;
}

export type AttendanceMark = 'present' | 'absent' | 'late';

export interface AttendanceRecord {
  id: string;
  /**
   * 과목을 가리키는 안정적인 키 (2026-10-30 추가). 강의 카탈로그에서 넣은 수업은 'lec:<강의 id>',
   * 직접 입력·사진 가져오기 수업은 'tt:<시간표 항목 id>'. 없으면(이전 샘플) courseName 으로 묶는다.
   */
  courseKey?: string;
  /** 기록할 때의 과목명 (시간표에서 빠져도 이 이름으로 보여 준다) */
  courseName: string;
  date: string;
  mark: AttendanceMark;
  /** 本人入力の場合は user_input(=推定値扱い)。公式出席記録は kslife 等。 */
  source: SourceMeta;
}

/**
 * 科目ごとの出席基準。全科目共通の 2/3 等を前提にせず、ユーザーが科目ごとに設定する。
 * 奨学金の出席基準は別テーブル(ScholarshipRequirement)に分ける。
 */
export interface AttendanceRule {
  /** AttendanceRecord.courseKey 와 같은 키 (없으면 courseName 으로 맞춘다) */
  courseKey?: string;
  courseName: string;
  /** 미기록 계산 시작일 'YYYY-MM-DD' (선택). 없으면 첫 기록일부터 센다 */
  startDate?: string | null;
  /** 例: 0.667。未設定(null)なら危険度判定はしない */
  minRate: number | null;
  /** 遅刻何回で欠席1回とみなすか(null なら換算しない) */
  lateCountsAsAbsence: number | null;
  totalSessions: number | null;
}

export interface ScholarshipRequirement {
  id: string;
  name: string;
  minAttendanceRate: number | null;
  note?: string;
  source: SourceMeta;
}

export interface InboxItem {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  source: SourceMeta;
}
