/**
 * 자격증 취득 시기 결정 (순수 함수). AI 는 자료를 찾아 정리만 하고, 언제 딸지는 앱이 계산한다.
 * 기준: 쉬운 것부터 순서대로, 주당 공부 시간으로 준비 기간 계산 → 그 뒤 가장 빠른 시험일.
 * 확인된 시험일이 없으면 긴 방학 뒤를 '예상'으로만 제안하고, 일정으로 확정하지 않는다.
 */
import { addDays, diffDays } from '../../lib/dates';

export interface CertExamDate {
  label: string;
  /** YYYY-MM-DD */
  examDate: string;
  applyEnd: string;
  sourceUrl: string;
}

export interface CertInfo {
  name: string;
  nameKo: string;
  organizer: string;
  officialUrl: string;
  whyKo: string;
  whyJa: string;
  /** 1(쉬움)~5(어려움) */
  difficulty: number;
  hoursMin: number;
  hoursMax: number;
  /** source: 출처에 적힌 시간, estimate: AI 추정 */
  hoursBasis: 'source' | 'estimate';
  /** 연중 수시 시험 (CBT 등) */
  yearRound: boolean;
  scheduleText: string;
  /** 해마다 시험이 있는 달 (출처에 적힌 경우). 다음 시험일이 공지되기 전 시기 제안에만 쓴다 */
  typicalMonths: number[];
  eligibilityKo: string;
  eligibilityJa: string;
  examDates: CertExamDate[];
  sourceUrls: string[];
}

export type CertTiming = 'dated' | 'year_round' | 'estimated' | 'after_graduation';

export interface CertPlanRow {
  cert: CertInfo;
  order: number;
  timing: CertTiming;
  hours: number;
  weeks: number;
  startBy: string;
  /** 시험일 또는 목표 시기 (YYYY-MM-DD). 예상이면 그 달의 초 */
  target: string;
  examLabel: string;
  applyEnd: string;
  sourceUrl: string;
  grade: number;
  /** 3학년 3월 취업 활동 시작 전에 끝나는지 */
  beforeJobHunt: boolean;
}

/** 일본 학년도: 4월 시작 */
const academicYear = (date: string) => {
  const [y, m] = date.split('-').map(Number);
  return m >= 4 ? y : y - 1;
};

export const gradeAt = (date: string, today: string, currentGrade: number) => currentGrade + academicYear(date) - academicYear(today);

/** 준비가 끝난 뒤 처음 오는 '시험이 있는 달' */
function nextTypicalMonth(date: string, months: number[]) {
  const [y, m] = date.split('-').map(Number);
  for (let i = 0; i < 24; i++) {
    const month = ((m - 1 + i) % 12) + 1;
    if (months.includes(month)) return `${y + Math.floor((m - 1 + i) / 12)}-${String(month).padStart(2, '0')}-01`;
  }
  return null;
}

/** 다음 긴 방학이 끝난 뒤 첫 달: 여름방학 뒤 10월, 봄방학 뒤 4월 */
function afterNextBreak(date: string) {
  const [y, m] = date.split('-').map(Number);
  if (m <= 3) return `${y}-04-01`;
  if (m <= 9) return `${y}-10-01`;
  return `${y + 1}-04-01`;
}

export function planCerts(certs: CertInfo[], input: { today: string; grade: number; weeklyHours: number; maxGrade?: number }): CertPlanRow[] {
  const weekly = Math.max(1, input.weeklyHours);
  const maxGrade = input.maxGrade ?? 4;
  const hoursOf = (c: CertInfo) => Math.round((c.hoursMin + c.hoursMax) / 2);
  const ordered = [...certs].sort((a, b) => a.difficulty - b.difficulty || hoursOf(a) - hoursOf(b));
  let cursor = input.today;
  // 3학년 3월(취업 활동 시작)
  const jobHunt = `${academicYear(input.today) + (3 - input.grade) + 1}-03-01`;
  return ordered.map((cert, i) => {
    const hours = hoursOf(cert);
    const weeks = Math.max(1, Math.ceil(hours / weekly));
    const ready = addDays(cursor, weeks * 7);
    const startBy = cursor;
    const next = cert.examDates.filter((d) => d.examDate >= ready && (!d.applyEnd || d.applyEnd >= input.today)).sort((a, b) => a.examDate.localeCompare(b.examDate))[0];
    let timing: CertTiming;
    let target: string;
    if (next) {
      timing = 'dated';
      target = next.examDate;
    } else if (cert.yearRound) {
      timing = 'year_round';
      target = ready;
    } else {
      timing = 'estimated';
      // 준비 끝나는 달의 시험은 이미 지났을 수 있어 다음 달부터 본다
      target = nextTypicalMonth(addDays(ready, 31), cert.typicalMonths) ?? afterNextBreak(ready);
    }
    const grade = gradeAt(target, input.today, input.grade);
    if (grade > maxGrade) timing = 'after_graduation';
    // 다음 자격증 공부는 앞 공부가 끝나면 시작한다 (시험일까지 놀며 기다리지 않음)
    cursor = ready;
    return {
      cert,
      order: i + 1,
      timing,
      hours,
      weeks,
      startBy: diffDays(input.today, startBy) >= 0 ? startBy : input.today,
      target,
      examLabel: next?.label ?? '',
      applyEnd: next?.applyEnd ?? '',
      sourceUrl: next?.sourceUrl ?? '',
      grade,
      beforeJobHunt: target < jobHunt,
    };
  });
}

/** 서버 응답을 그대로 믿지 않고 형식·범위를 맞춘다 */
export function normalizeCert(raw: Partial<CertInfo>): CertInfo | null {
  if (!raw.name?.trim()) return null;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);
  const min = num(raw.hoursMin, 0);
  const max = Math.max(min, num(raw.hoursMax, min));
  if (!max) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/;
  return {
    name: raw.name.trim(),
    nameKo: raw.nameKo?.trim() || raw.name.trim(),
    organizer: raw.organizer ?? '',
    officialUrl: raw.officialUrl ?? '',
    whyKo: raw.whyKo ?? '',
    whyJa: raw.whyJa ?? '',
    difficulty: Math.min(5, Math.max(1, Math.round(num(raw.difficulty, 3)))),
    hoursMin: min || max,
    hoursMax: max,
    hoursBasis: raw.hoursBasis === 'source' ? 'source' : 'estimate',
    yearRound: !!raw.yearRound,
    scheduleText: raw.scheduleText ?? '',
    typicalMonths: (raw.typicalMonths ?? []).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12),
    eligibilityKo: raw.eligibilityKo ?? '',
    eligibilityJa: raw.eligibilityJa ?? '',
    examDates: (raw.examDates ?? []).filter((d) => date.test(d.examDate ?? '') && !!d.sourceUrl).map((d) => ({ label: d.label ?? '', examDate: d.examDate, applyEnd: date.test(d.applyEnd ?? '') ? d.applyEnd : '', sourceUrl: d.sourceUrl })),
    sourceUrls: raw.sourceUrls ?? [],
  };
}
