/**
 * 전 학부 공식 강의 공통 로직 (순수 함수, Node 에서 바로 테스트).
 * - 대상 입학연도는 원문 표기에서 읽은 구간만 쓴다. 표기가 없으면 null(판단 안 함).
 * - 인정 영역은 '제안'까지만 한다. 취득 학점에 넣으려면 사용자가 확인해야 한다.
 */
import { officialText } from '../../lib/officialText';
import type { CourseTrack, GradRule, OfficialCourse, OfficialData, Quarter } from './types';

/** 학과 코드 ↔ 앱 프로필 학부/학과 */
export const DEPT_CODE: Record<string, string> = {
  'kokusai/kokusai-bunka': 'KK', 'kokusai/nihon-bunka': 'KN', 'human_sciences/rinsho-shinri': 'HP', 'human_sciences/kodomo-kyoiku': 'HC', 'human_sciences/sports-kenko': 'HS',
  'keizai/keizai': 'EE', 'sho/keiei-ryutsu': 'CB', 'chiiki/kanko': 'DT', 'chiiki/chiiki-zukuri': 'DR',
  'rikou/joho-kagaku': 'RS', 'rikou/kikai-denki-sozo': 'RK', 'rikou/smart-communication': 'RC', 'rikou/kikai': 'RM', 'rikou/denki': 'RE',
  'seimei/seimei-kagaku': 'LL', 'kenchiku/kenchiku': 'UA', 'kenchiku/jukyo-interior': 'UH', 'kenchiku/toshi-design': 'UC',
  'geijutsu/geijutsu-hyogen': 'AA', 'geijutsu/shashin-eizo': 'AP', 'geijutsu/visual-design': 'AD', 'geijutsu/seikatsu-kankyo': 'AE', 'geijutsu/social-design': 'AS',
};
export const TRACKS: CourseTrack[] = ['major', 'kiso', 'foreign', 'teaching', 'intl', 'gfbp', 'junior'];
const COMMON: CourseTrack[] = ['kiso', 'foreign', 'teaching', 'intl'];

export function deptCodeOf(facultyId?: string, departmentId?: string) {
  return facultyId && departmentId ? (DEPT_CODE[`${facultyId}/${departmentId}`] ?? null) : null;
}

/** 시라버스 구분·시간표 기호 → 표시용 mark */
export function markOf(c: { creditType?: string | null; applies?: { dept: string; mark: string | null }[] }): OfficialCourse['mark'] {
  const ct = c.creditType ?? '';
  if (/選択必修|選必/.test(ct)) return 'selective';
  if (/必/.test(ct)) return 'required'; // 시라버스 단위구분은 '必' 한 글자로도 나온다
  if (/選択/.test(ct)) return 'elective';
  const a = c.applies?.find((x) => x.mark);
  if (!a) return null;
  if (a.dept === 'RS') return a.mark === '△' ? 'required_math' : a.mark === '〇' || a.mark === '○' ? 'required_tech' : a.mark === '＊' || a.mark === '*' ? 'required' : a.mark === '□' ? 'elective' : null;
  if (a.mark === '＊' || a.mark === '*' || a.mark === '◎' || a.mark === '〇' || a.mark === '○') return 'required';
  if (a.mark === '△') return 'selective';
  if (a.mark === '□') return 'elective';
  return null;
}

/** 원본 데이터를 화면용으로 정리. 값이 없으면 지어내지 않는다 */
export function normalizeCourse(raw: OfficialCourse): OfficialCourse {
  const sources = (raw.source as unknown as { id: string; page?: number }[] | undefined) ?? [];
  const first = Array.isArray(sources) ? sources[0] : (sources as unknown as { id: string; page?: number });
  return {
    ...raw,
    name: raw.name.replace(/^[□△▲＊※○〇◎]+\s*/, ''),
    year: raw.year ?? 0,
    mark: raw.mark === undefined ? markOf(raw) : raw.mark,
    classTag: raw.classTag ?? null,
    note: raw.note ?? null,
    cohort: raw.cohort ?? raw.cohortText ?? '',
    sources: Array.isArray(sources) ? sources : [first],
    source: first ?? { id: 'SYLALL' },
    syllabus: raw.syllabus ?? (raw.code || raw.credits != null ? ({ code: raw.code ?? '', credits: raw.credits ?? null, kind: raw.kind ?? '', grade: raw.year ?? 0, summary: '', evaluation: '', prerequisite: raw.prereq ?? undefined, checkedAt: '' } as unknown as OfficialCourse['syllabus']) : undefined),
  };
}

/** 대상 입학연도 판단. true/false, 표기 없음은 null. dept 를 주면 그 학과 표기를 먼저 본다 */
export function courseCohort(c: Pick<OfficialCourse, 'cohortRanges' | 'applies'>, admissionYear: number | null | undefined, dept?: string | null): boolean | null {
  if (!admissionYear) return null;
  const own = dept ? c.applies?.filter((a) => a.dept === dept).flatMap((a) => a.cohorts) ?? [] : [];
  const ranges = own.length ? own : (c.cohortRanges ?? []);
  if (!ranges.length) return null;
  return ranges.some(([from, to]) => (from == null || admissionYear >= from) && (to == null || admissionYear <= to));
}

/** 이 학생 학과에 관련된 과목: 소속 학과 전공 + 전학 공통(기초교육·외국어·교직·유학생). GFBP 는 해당 학과 표기가 있을 때 */
export function coursesForDept(list: OfficialCourse[], dept: string | null) {
  if (!dept) return list;
  return list.filter((c) => (c.depts ?? []).includes(dept) || COMMON.includes((c.track ?? 'other') as CourseTrack));
}

/** 쿼터가 확인됐는지. 확인 전이면 추천·충돌 계산에 확정값으로 쓰지 않는다 */
export function quartersKnown(c: Pick<OfficialCourse, 'quarters'>) {
  return c.quarters.length > 0;
}

/** 시간표에 넣을 때 쓸 쿼터 (확인 안 됐으면 학기 전체로 두고 다시 확인 표시) */
export function quartersForEntry(c: Pick<OfficialCourse, 'quarters' | 'term'>): { quarters: Quarter[]; assumed: boolean } {
  if (c.quarters.length) return { quarters: [...c.quarters], assumed: false };
  return { quarters: c.term === '後期' ? ['3Q', '4Q'] : ['1Q', '2Q'], assumed: true };
}

const ENGLISH = /英語|english|reading|listening|speaking|toeic|toefl|four\s*skills|writing/i;

/**
 * 인정 영역 제안: 규칙의 영역과 과목 정보를 맞춰 '제안'만 돌려준다. 확실하지 않으면 null.
 * 전공의 세부 묶음(유닛·코스 등)은 학과별 규정 없이는 고를 수 없으므로 null.
 */
export function suggestCategory(c: Pick<OfficialCourse, 'track' | 'name' | 'creditType'>, rule: Pick<GradRule, 'categories'> | null | undefined): string | null {
  if (!rule) return null;
  const has = (id: string) => rule.categories[id] != null;
  if (c.track === 'foreign') {
    if (ENGLISH.test(c.name) && has('english')) return 'english';
    if (has('foreign_total')) return 'foreign_total';
    return 'foreign_other';
  }
  if (c.track === 'kiso') {
    if (has('kiso_total')) return 'kiso_total';
    if (has('kiso_other')) return 'kiso_other';
    return null;
  }
  if (c.track === 'major') {
    const ct = c.creditType ?? '';
    if (/選択必修|選必/.test(ct) && has('senmon_selective')) return 'senmon_selective';
    if (/必/.test(ct) && has('senmon_required')) return 'senmon_required';
    if (/選択/.test(ct) && has('senmon_elective')) return 'senmon_elective';
    return null;
  }
  return null;
}

/** 이 과목이 채울 수 있는 영역인지 (교양·외국어 추천용) */
export function courseFitsCategory(c: OfficialCourse, category: string, rule: Pick<GradRule, 'categories'>): boolean {
  return suggestCategory(c, rule) === category;
}

/** 규칙 선택에 필요한 구분 (GFBP·건축 코스 등). 프로필 코스 이름으로 고른다 */
export function ruleVariantKeys(rules: Record<string, GradRule> | undefined, admissionYear: number | null | undefined) {
  if (!rules || !admissionYear) return [] as string[];
  const key = `${String(admissionYear % 100).padStart(2, '0')}R`;
  return Object.keys(rules).filter((k) => k.startsWith(`${key}:`)).map((k) => k.split(':')[1]);
}

export function officialCourseById(data: Pick<OfficialData, 'courses' | 'legacyIds'>, id: string | null | undefined) {
  if (!id) return undefined;
  const real = data.legacyIds?.[id] ?? id;
  return data.courses.find((c) => c.id === real);
}

const KO_TERMS: [RegExp, string][] = [
  [/選択必修(?:科目)?/g, '선택필수'], [/必修(?:科目)?/g, '필수'], [/選択(?:科目)?/g, '선택'], [/基礎教育(?:科目)?/g, '기초교육'], [/外国語(?:科目)?/g, '외국어'], [/導入(?:科目)?/g, '도입'],
  [/英語エキスパート(?:科目)?/g, '영어 전문'], [/英語/g, '영어'], [/その他/g, '기타'], [/共通ユニット/g, '공통 유닛'], [/コアユニット/g, '코어 유닛'], [/展開ユニット/g, '전개 유닛'],
  [/コース横断/g, '코스 횡단'], [/所属コース/g, '소속 코스'], [/コース科目/g, '코스 과목'], [/学系科目/g, '학계 과목'], [/実践力育成科目/g, '실천력 육성 과목'], [/資格関連科目/g, '자격 관련 과목'], [/共通科目/g, '공통과목'],
  [/学科共通/g, '학과 공통'], [/学部共通/g, '학부 공통'], [/学科コア/g, '학과 코어'], [/学部横断(?:科目)?/g, '학부 횡단'], [/学科展開/g, '학과 전개'], [/学科科目/g, '학과 과목'], [/文学・語学(?:科目)?/g, '문학·어학'], [/歴史・民俗学(?:科目)?/g, '역사·민속학'],
  [/国際教養(?:科目)?/g, '국제교양'], [/資格科目/g, '자격 과목'], [/さらに/g, '추가로 '], [/から/g, '에서 '], [/教養/g, '교양'], [/語学/g, '어학'], [/専門(?:科目)?/g, '전공'], [/基礎教育は含まない/g, '기초교육 제외'], [/以上/g, ' 이상'],
];

/** 규칙 영역 이름: 한국어 모드는 한국어 표현만, 일본어 모드는 원문 */
export function ruleLabel(label: string, locale: string) {
  if (locale !== 'ko') return label;
  let k = label;
  for (const [re, ko] of KO_TERMS) k = k.replace(re, ko);
  // 한국어만 보여 준다 (병기하지 않음). 남은 일본어 표현은 공식 문구 변환에 맡긴다
  return officialText(k, locale);
}

export function categoryLabel(id: string, rule: { categories: Record<string, { label?: string } | undefined> } | null | undefined, builtIn: Record<string, string>, locale: string) {
  const fromRule = rule?.categories[id]?.label;
  if (builtIn[id] && (!fromRule || id in { senmon_required: 1, senmon_elective: 1, intro: 1, kiso_other: 1, english: 1, foreign_other: 1 })) return builtIn[id];
  return fromRule ? ruleLabel(fromRule, locale) : (builtIn[id] ?? id);
}
