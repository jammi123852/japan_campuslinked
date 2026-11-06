/**
 * 발표 시연 도구 (로컬 전용, 공개 빌드에는 showcase.json 이 없어 나타나지 않는다).
 * - 샘플 후기·질문은 실제 학생 후기가 아니며, 실제 후기 수·계획 계산에 합산하지 않는다.
 * - 가상 학생은 별도 저장 공간(showcase-local)을 써서 개인·데모 데이터와 섞이지 않는다.
 */
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';

import type { AppSession, TimetableEntry, UserProfile } from '@/data/types';
import type { PersonalEvent } from '@/features/schedule/scheduleLogic';
import type { CourseRecord } from '@/features/records/gradLogic';
import { pickRule } from '@/features/records/gradLogic';
import { clearUserNamespace, writeJson, StorageKeys } from '@/lib/storage';
import { fetchDemoHistory } from '@/lib/api';
import { upsertRecords } from '@/services/recordsRepository';
import { saveTimetable } from '@/services/timetableRepository';
import { upsertEvent } from '@/services/scheduleRepository';
import { saveProfile } from '@/services/profileRepository';
import { suggestCategory } from './courseLogic';
import type { OfficialCourse, OfficialData } from './types';

export const SHOWCASE_USER_ID = 'showcase-local';

export interface ShowcaseCourse {
  reviews: { year: number; grade: number; evaluation: string; workload: number; difficulty: number; ja: string; ko: string }[];
  questions: { ja: string; ko: string; answers: { ja: string; ko: string }[] }[];
  aiSummary?: { ko: string; ja: string };
}
/** 실제 학생 시간표 PDF 에서 옮긴 지난 학기 수업 (이름·학번 없음, 성적 없음). 로컬 showcase.json 에만 있다 */
export interface HistoryClass {
  year: number;
  quarters: ('1Q' | '2Q' | '3Q' | '4Q')[];
  weekday: number;
  periods: number[];
  start: string;
  end: string;
  name: string;
  section: string;
  instructor: string;
  room: string | null;
  category: string;
  credits: number;
  recordStatus?: CourseRecord['status'];
  recordQuarters?: ('1Q' | '2Q' | '3Q' | '4Q')[];
}
type Showcase = {
  courses: Record<string, ShowcaseCourse>;
  history?: { profile: { facultyId: string; departmentId: string; admissionYear: number; currentGrade: number; courseName: string | null }; classes: HistoryClass[] };
};

let cache: Promise<Showcase | null> | null = null;
export function loadShowcase() {
  if (!cache) {
    const base = ((Constants.expoConfig?.experiments as { baseUrl?: string } | undefined)?.baseUrl ?? '').replace(/\/$/, '');
    cache = fetch(`${base}/official/showcase.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null) as Promise<Showcase | null>;
  }
  return cache;
}

export function useShowcase() {
  const [s, setS] = useState<Showcase | null>(null);
  useEffect(() => {
    let alive = true;
    loadShowcase().then((x) => alive && setS(x));
    return () => {
      alive = false;
    };
  }, []);
  return s;
}

export const showcaseSession: AppSession = { mode: 'personal', userId: SHOWCASE_USER_ID, email: null };

const ids = { enrolled: ['ofb7fc3a4a9d98', 'oc3ce93d359b09', 'o0b1065ec77738', 'o5d9c3eaaebe59'], past: ['o4d04c4cf81abc', 'o1a847f53c24c0'] };

function pick(list: OfficialCourse[], used: Set<string>, need: number, pred: (c: OfficialCourse) => boolean) {
  const out: OfficialCourse[] = [];
  let sum = 0;
  for (const c of list) {
    if (sum >= need) break;
    const k = c.code ?? c.name;
    if (!c.credits || used.has(k) || !pred(c)) continue;
    used.add(k);
    out.push(c);
    sum += c.credits;
  }
  return out;
}

const PERIOD_TIMES: Record<number, [string, string]> = { 1: ['09:00', '10:40'], 2: ['11:00', '12:40'], 3: ['13:40', '15:20'], 4: ['15:40', '17:20'], 5: ['17:30', '19:10'], 6: ['19:20', '21:00'] };

/**
 * 시연 학생을 실제 시간표 기록으로 채운다: 지난 학기 수업 → 기간별 시간표 + 이수 기록.
 * 시간표에는 성적이 없어 지난 학기 수업은 '이수 완료', 성적 A 로 가정한다(사용자 지시). 가장 최근 학기는 넣지 않는다(시연 때 직접 입력).
 */
async function seedFromHistory(data: OfficialData, history: NonNullable<Showcase['history']>) {
  const session = showcaseSession;
  await clearUserNamespace(SHOWCASE_USER_ID);
  const hp = history.profile;
  const profile: UserProfile = { nickname: '시연학생', facultyId: hp.facultyId, departmentId: hp.departmentId, courseStatus: hp.courseName ? 'selected' : 'none', courseName: hp.courseName, admissionYear: hp.admissionYear, currentGrade: hp.currentGrade, enrolledCourses: [], interests: ['it'], updatedAt: new Date().toISOString() };
  await saveProfile(session, profile);
  const now = new Date().toISOString();
  const official = (c: HistoryClass) => data.courses.find((o) => o.name === c.name && o.section === c.section) ?? data.courses.find((o) => o.name === c.name);
  const entries: TimetableEntry[] = history.classes.flatMap((c, i) =>
    c.periods.map((period) => ({
      id: `sc-tt-${i}-${period}`,
      lectureId: official(c)?.id,
      courseName: c.name,
      weekday: c.weekday,
      period,
      startTime: PERIOD_TIMES[period]?.[0] ?? c.start,
      endTime: PERIOD_TIMES[period]?.[1] ?? c.end,
      room: c.room ?? undefined,
      memo: c.instructor,
      term: { year: c.year, quarters: [...c.quarters] },
      source: { kind: 'user_input' as const, note: '시간표 PDF' },
    })),
  );
  await saveTimetable(session, entries);
  const seen = new Set<string>();
  const records: CourseRecord[] = [];
  for (const c of history.classes) {
    const key = `${c.year}|${c.name}`;
    if (seen.has(key)) continue; // 통년 과목은 한 번만
    seen.add(key);
    const status = c.recordStatus ?? 'passed';
    records.push({
      id: `sc-h-${records.length}`, year: c.year, quarters: [...(c.recordQuarters ?? c.quarters)], name: c.name, code: official(c)?.code ?? null, section: c.section, credits: c.credits,
      category: c.category as CourseRecord['category'], suggestedCategory: c.category, status, grade: status === 'passed' ? 'A' : null, confirmedAt: status === 'passed' ? now : null, officialId: official(c)?.id ?? null,
      note: '', createdAt: now, updatedAt: now,
    });
  }
  await upsertRecords(session, records);
  const ev = (id: string, title: string, date: string, time: string, kind: PersonalEvent['kind']): PersonalEvent => ({ id, title, kind, date, time, course: null, memo: '', notify: true, done: false, createdAt: now, updatedAt: now });
  await upsertEvent(session, ev('sc-ev-1', '統計学 レポート提出', '2026-11-05', '23:59', 'assignment'));
  await writeJson(StorageKeys.session, session);
  return session;
}

/** 가상 학생: 정보과학과 2024 입학 3학년. 실제 개설 과목으로 이수 기록을 구성한다 (이름·성적은 가상). 시간표는 비어 있다 */
export async function seedShowcase(data: OfficialData) {
  // 로컬 showcase.json 에 있으면 그것, 없으면 공유 서버의 데모 기록 (공개 사이트·다른 기기)
  const history = (await loadShowcase())?.history ?? (await fetchDemoHistory<NonNullable<Showcase['history']>>().catch(() => undefined));
  if (history?.classes?.length) return seedFromHistory(data, history);
  const session = showcaseSession;
  await clearUserNamespace(SHOWCASE_USER_ID);
  const profile: UserProfile = { nickname: '시연학생', facultyId: 'rikou', departmentId: 'joho-kagaku', courseStatus: 'none', courseName: null, admissionYear: 2024, currentGrade: 3, enrolledCourses: [], interests: ['it'], updatedAt: new Date().toISOString() };
  await saveProfile(session, profile);
  const rule = pickRule(data.departments['rikou/joho-kagaku']?.rules, 2024, null)?.rule;
  const by = (id: string) => data.courses.find((c) => c.id === id);
  const eligible = data.courses.filter((c) => (c.year ?? 9) <= 2 && (c.cohortRanges ?? []).every(([a, b]) => (a == null || 2024 >= a) && (b == null || 2024 <= b))).sort((a, b) => a.name.localeCompare(b.name));
  const used = new Set<string>([...ids.enrolled, ...ids.past, 'o4e0e4b8e4a9c4'].map((i) => by(i)?.code ?? i));
  const rs = eligible.filter((c) => (c.depts ?? []).includes('RS') && c.track === 'major');
  const passed = [
    ...pick(rs, used, 30, (c) => c.creditType === '必'),
    ...pick(rs, used, 24, (c) => c.creditType === '選択'),
    ...pick(eligible, used, 10, (c) => c.track === 'kiso'),
  ];
  const now = new Date().toISOString();
  const rec = (c: OfficialCourse, status: CourseRecord['status'], year: number): CourseRecord => ({
    id: `sc-${c.id}`, year, quarters: c.quarters.length ? [...c.quarters] : ['1Q'], name: c.name, code: c.code ?? null, section: c.section, credits: c.credits ?? null,
    category: (suggestCategory(c, rule) ?? 'unknown') as CourseRecord['category'], suggestedCategory: suggestCategory(c, rule), status, confirmedAt: status === 'passed' ? now : null, officialId: c.id, note: '시연용 가상 기록', createdAt: now, updatedAt: now,
  });
  const enrolled = ids.enrolled.map(by).filter(Boolean) as OfficialCourse[];
  const past = ids.past.map(by).filter(Boolean) as OfficialCourse[];
  // 발표일(월요일)에도 '오늘 수업'이 보이도록 월요일 3Q 수업 하나
  const monday = data.courses.find((c) => (c.depts ?? []).includes('RS') && c.track === 'major' && c.quarters.includes('3Q') && c.meetings.length === 1 && c.meetings[0].weekday === 0 && c.meetings[0].period >= 2 && (c.year ?? 0) >= 2 && !!c.credits && (c.cohortRanges ?? []).every(([a, b]) => (a == null || 2024 >= a) && (b == null || 2024 <= b)));
  if (monday) enrolled.push(monday);
  // 외국어·도입은 시라버스 학점 수집 전일 수 있어 직접 입력한 가상 기록으로 둔다
  const manual = (name: string, credits: number, category: string): CourseRecord => ({ id: `sc-m-${category}`, year: 2025, quarters: ['1Q', '2Q'], name, code: null, section: null, credits, category: category as CourseRecord['category'], suggestedCategory: null, status: 'passed', confirmedAt: now, officialId: null, note: '시연용 가상 기록', createdAt: now, updatedAt: now });
  await upsertRecords(session, [manual('英語科目 (가상 기록)', 4, 'english'), manual('導入科目 (가상 기록)', 2, 'intro'), ...passed.map((c) => rec(c, 'passed', 2025)), ...past.map((c) => rec(c, 'passed', 2026)), ...enrolled.map((c) => rec(c, 'enrolled', 2026))]);
  // 시간표는 비워 둔다: 시연 때 실제 시간표 PDF 를 가져와 채운다 (이수 기록·일정은 그대로)
  const ev = (id: string, title: string, date: string, time: string, kind: PersonalEvent['kind']): PersonalEvent => ({ id, title, kind, date, time, course: null, memo: '시연용 가상 일정', notify: true, done: false, createdAt: now, updatedAt: now });
  await upsertEvent(session, ev('sc-ev-1', '統計学 レポート提出', '2026-11-05', '23:59', 'assignment'));
  await upsertEvent(session, ev('sc-ev-2', 'データ構造とアルゴリズムⅠ演習 課題', '2026-11-08', '23:59', 'assignment'));
  await upsertEvent(session, ev('sc-ev-3', '統計学 定期試験 (要確認)', '2026-11-10', '09:00', 'exam'));
  await writeJson(StorageKeys.session, session);
  return session;
}
