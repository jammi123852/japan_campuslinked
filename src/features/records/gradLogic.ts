/**
 * 이수 기록과 졸업요건 계산 (순수 함수, Node 에서 바로 테스트).
 *
 * 원칙
 * - 취득 학점에는 사용자가 '이수 완료'로 확인한 기록만 넣는다. 수강 중·계획은 '예상'에만.
 * - 영역(카테고리)은 사용자가 고른 것만 쓴다. 미분류 학점은 어느 영역에도 넣지 않는다(임의 배정 금지).
 * - 같은 과목(과목코드, 없으면 정규화한 과목명)이 여러 번 완료로 기록되면 한 번만 센다(재수강 중복 방지).
 * - 규칙이 없거나 부분 규칙이면 '전체 판정 불가'. 미확인을 0학점 부족·충족으로 바꾸지 않는다.
 */
import type { CategoryId, GradRule } from '../official/types';

export type RecordStatus = 'planned' | 'enrolled' | 'passed' | 'failed' | 'withdrawn' | 'review';
export const RECORD_STATUSES: RecordStatus[] = ['planned', 'enrolled', 'passed', 'failed', 'withdrawn', 'review'];

/** 사용자가 고르는 영역. 'unknown' 은 미분류, 'outside' 는 졸업요건 외(자격과정 등) */
export type RecordCategory = CategoryId | 'unknown' | 'outside';

export interface CourseRecord {
  id: string;
  /** 학년도 + 학기/쿼터 (예: 2026, ['3Q','4Q']). 모르면 null */
  year: number | null;
  quarters: ('1Q' | '2Q' | '3Q' | '4Q')[];
  name: string;
  code: string | null;
  section: string | null;
  /** 학점. 모르면 null (합계에 넣지 않고 '학점 미입력'으로 표시) */
  credits: number | null;
  category: RecordCategory;
  status: RecordStatus;
  /** 사용자가 이수 완료를 확인한 시각 (passed 일 때) */
  confirmedAt: string | null;
  /** 공식 강의 id (시간표에서 가져온 경우) */
  officialId: string | null;
  /** 앱이 제안한 인정 영역. 사용자가 확인해 category 로 옮기기 전에는 계산에 넣지 않는다 */
  suggestedCategory?: string | null;
  /** 받은 성적 (S·A·B·C 합격, D·E 불합격). 시간표에는 없어서 사용자가 고른다. 없으면 null */
  grade?: Grade | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

/** 성적 표시와 GP: 성적 원부 설명(F005), 이공학부 이수규정 제40조(F161) */
export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'E';
export const GRADES: Grade[] = ['S', 'A', 'B', 'C', 'D', 'E'];
export const GRADE_POINT: Record<Grade, number> = { S: 4, A: 3, B: 2, C: 1, D: 0, E: 0 };
export const gradePasses = (g: Grade) => GRADE_POINT[g] > 0;

/**
 * 성적을 고르면 상태도 맞춘다: S~C 이수 완료(사용자 확인), D·E 불합격.
 * 같은 성적을 다시 누르면 성적만 지우고, 이수 완료·불합격 판단은 다시 고를 때까지 수강 중으로 되돌린다.
 */
export function applyGrade(r: CourseRecord, grade: Grade, nowIso: string): CourseRecord {
  if (r.grade === grade) return { ...r, grade: null, status: 'enrolled', confirmedAt: null, updatedAt: nowIso };
  const pass = gradePasses(grade);
  return { ...r, grade, status: pass ? 'passed' : 'failed', confirmedAt: pass ? nowIso : null, updatedAt: nowIso };
}

/**
 * 입력한 성적 기준 GPA = Σ(학점×GP) ÷ Σ학점. 불합격(0점)도 분모에 넣는다.
 * 졸업 학점에 들어가지 않는 과목('요건 외')과 학점을 모르는 과목은 뺀다. 성적을 입력하지 않은 과목은 계산에 없다.
 */
export function computeGpa(records: CourseRecord[]): { gpa: number | null; courses: number; credits: number } {
  const list = records.filter((r) => r.grade && r.credits != null && r.category !== 'outside');
  const credits = list.reduce((a, r) => a + r.credits!, 0);
  if (credits === 0) return { gpa: null, courses: 0, credits: 0 };
  const points = list.reduce((a, r) => a + r.credits! * GRADE_POINT[r.grade!], 0);
  return { gpa: points / credits, courses: list.length, credits };
}

export type Scenario = 'actual' | 'current' | 'plan';
/** 시나리오별 포함 상태: 실제(완료만) / 수강 중 포함 / 계획까지 모두 이수했다고 가정 */
export const SCENARIO_STATUSES: Record<Scenario, RecordStatus[]> = {
  actual: ['passed'],
  current: ['passed', 'enrolled'],
  plan: ['passed', 'enrolled', 'planned'],
};

const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
export const courseIdentity = (r: Pick<CourseRecord, 'code' | 'name'>) => (r.code ? `code:${r.code}` : `name:${norm(r.name)}`);

/** 시나리오에 넣을 기록 (같은 과목은 한 번만, 학점이 큰 것 하나). 중복된 과목 목록도 돌려준다 */
export function countedRecords(records: CourseRecord[], scenario: Scenario) {
  const statuses = SCENARIO_STATUSES[scenario];
  const byId = new Map<string, CourseRecord>();
  const duplicates = new Set<string>();
  for (const r of records.filter((x) => statuses.includes(x.status))) {
    const k = courseIdentity(r);
    const prev = byId.get(k);
    if (prev) {
      duplicates.add(r.name);
      if ((r.credits ?? 0) > (prev.credits ?? 0)) byId.set(k, r);
    } else byId.set(k, r);
  }
  return { list: [...byId.values()], duplicates: [...duplicates] };
}

export interface CategoryProgress {
  id: CategoryId;
  min: number;
  exact: boolean;
  earned: number;
  short: number;
  surplus: number;
}

export interface GradProgress {
  ruleKey: string | null;
  /** 규칙 자체가 없음 → 계산 불가 */
  noRule: boolean;
  partialRule: boolean;
  scenario: Scenario;
  categories: CategoryProgress[];
  flex: { min: number; earned: number; short: number } | null;
  /** 학과별 '더 채우기' 묶음 (유닛·코스 등) */
  pools: { id: string; label: string; min: number; earned: number; short: number }[];
  /** 확인된 영역 학점 합계 (미분류·요건 외 제외) */
  countedTotal: number;
  totalMin: number;
  totalShort: number;
  unknownCredits: number;
  unknownCourses: string[];
  outsideCredits: number;
  missingCreditCourses: string[];
  duplicates: string[];
  thesis: { met: boolean | null; credits: number; need: number; missingCourses: string[] } | null;
  promotion3: { met: null; credits: number; need: number; note: string } | null;
  /** 확인된 조건이 모두 충족되었는지. 미분류·학점 미입력·부분 규칙이 있으면 null(판정 불가) */
  verdict: 'met_checked' | 'short' | 'undetermined';
}

/**
 * 입학연도·학과로 규칙 선택. 다른 연도의 규칙으로 대신하지 않는다.
 * 같은 연도에 구분(GFBP·건축 코스 등)이 있으면 프로필 코스 이름으로 고른다. 정하지 못하면 null(화면이 구분 선택을 안내).
 */
export function pickRule(rules: Record<string, GradRule> | undefined, admissionYear: number | null | undefined, courseName?: string | null) {
  if (!rules || !admissionYear) return null;
  const key = `${String(admissionYear % 100).padStart(2, '0')}R`;
  const variants = Object.keys(rules).filter((k) => k.startsWith(`${key}:`));
  if (courseName) {
    const n = courseName.normalize('NFKC').toLowerCase();
    const hit = variants.find((k) => n.includes(k.split(':')[1].normalize('NFKC').toLowerCase()) || (k.endsWith(':GFBP') && /gfbp|グローバル・フード|フードビジネス/.test(n)));
    if (hit) return { key: hit, rule: rules[hit] };
  }
  if (rules[key]) return { key, rule: rules[key] };
  return null;
}

export function computeProgress(records: CourseRecord[], picked: { key: string; rule: GradRule } | null, scenario: Scenario): GradProgress {
  const { list, duplicates } = countedRecords(records, scenario);
  const missingCreditCourses = list.filter((r) => r.credits == null).map((r) => r.name);
  const withCredits = list.filter((r) => r.credits != null);
  const sum = (pred: (r: CourseRecord) => boolean) => withCredits.filter(pred).reduce((a, r) => a + (r.credits ?? 0), 0);
  const unknown = withCredits.filter((r) => r.category === 'unknown');
  const base = {
    scenario,
    unknownCredits: unknown.reduce((a, r) => a + (r.credits ?? 0), 0),
    unknownCourses: unknown.map((r) => r.name),
    outsideCredits: sum((r) => r.category === 'outside'),
    missingCreditCourses,
    duplicates,
  };
  if (!picked) {
    return {
      ...base,
      ruleKey: null,
      noRule: true,
      partialRule: false,
      categories: [],
      flex: null,
      pools: [],
      countedTotal: sum((r) => r.category !== 'unknown' && r.category !== 'outside'),
      totalMin: 0,
      totalShort: 0,
      thesis: null,
      promotion3: null,
      verdict: 'undetermined',
    };
  }
  const { rule, key } = picked;
  const earnedOf = (id: CategoryId) => {
    // 26R 처럼 총계만 있는 규칙: 전공·기초 세부 영역을 총계로 묶는다
    if (id === 'senmon_total') return sum((r) => r.category === 'senmon_required' || r.category === 'senmon_elective' || r.category === 'senmon_total');
    if (id === 'kiso_total') return sum((r) => r.category === 'intro' || r.category === 'kiso_other' || r.category === 'kiso_total');
    return sum((r) => r.category === id);
  };
  const categories: CategoryProgress[] = (Object.entries(rule.categories) as [CategoryId, { min: number; exact?: boolean }][]).map(([id, c]) => {
    const earned = earnedOf(id);
    // 필수(exact)는 정해진 학점을 넘어도 넘는 부분을 다른 영역으로 옮기지 않는다
    return { id, min: c.min, exact: !!c.exact, earned, short: Math.max(0, c.min - earned), surplus: c.exact ? 0 : Math.max(0, earned - c.min) };
  });
  let flex: GradProgress['flex'] = null;
  if (rule.flex) {
    const from = new Set(rule.flex.from);
    // 영역 최소를 넘는 학점(+최소가 없는 기타 외국어)만 '추가 취득' 칸에 한 번 센다 → 같은 학점 이중 합산 없음
    const earned = categories.filter((c) => from.has(c.id)).reduce((a, c) => a + c.surplus, 0) + (from.has('foreign_other') && !rule.categories.foreign_other ? earnedOf('foreign_other') : 0);
    flex = { min: rule.flex.min, earned, short: Math.max(0, rule.flex.min - earned) };
  }
  // 학과별 묶음: 앞 묶음에서 남은 학점만 뒤 묶음으로 넘어간다 (같은 학점을 두 번 세지 않음)
  const surplusOf = new Map<string, number>(categories.map((c) => [c.id as string, c.surplus]));
  const extraIds = new Set(records.map((r) => r.category as string).filter((id) => !rule.categories[id] && id !== 'unknown' && id !== 'outside'));
  for (const id of extraIds) surplusOf.set(id, sum((r) => r.category === id));
  const pools: GradProgress['pools'] = (rule.pools ?? []).map((p) => {
    let earned = 0;
    for (const id of p.from) {
      earned += surplusOf.get(id) ?? 0;
      surplusOf.set(id, 0);
    }
    surplusOf.set(p.id, Math.max(0, earned - p.min));
    return { id: p.id, label: p.label, min: p.min, earned, short: Math.max(0, p.min - earned) };
  });
  const countedTotal = sum((r) => r.category !== 'unknown' && r.category !== 'outside');
  const totalShort = Math.max(0, rule.total - countedTotal);
  const passedNames = new Set(countedRecords(records, scenario).list.map((r) => norm(r.name)));
  const thesis = rule.thesisStart
    ? (() => {
        const missingCourses = rule.thesisStart.courses.filter((c) => !passedNames.has(norm(c)));
        const met = countedTotal >= rule.thesisStart.credits && missingCourses.length === 0;
        return { met: base.unknownCredits > 0 && !met ? null : met, credits: countedTotal, need: rule.thesisStart.credits, missingCourses };
      })()
    : null;
  // 진급 요건은 '1·2년차 배당 과목' 범위를 기록에서 알 수 없어 판정하지 않는다
  const promotion3 = rule.promotion3 ? { met: null, credits: countedTotal, need: rule.promotion3.credits, note: rule.promotion3.scope } : null;
  const anyShort = categories.some((c) => c.short > 0) || (flex?.short ?? 0) > 0 || pools.some((p) => p.short > 0) || totalShort > 0;
  const uncertain = !!rule.partial || base.unknownCredits > 0 || missingCreditCourses.length > 0;
  const verdict: GradProgress['verdict'] = uncertain ? 'undetermined' : anyShort ? 'short' : 'met_checked';
  return { ...base, ruleKey: key, noRule: false, partialRule: !!rule.partial, categories, flex, pools, countedTotal, totalMin: rule.total, totalShort, thesis, promotion3, verdict };
}
