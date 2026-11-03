/**
 * 학사 일정 날짜 계산 (순수 함수, Node 에서 바로 테스트).
 *
 * 기준 시간대: Asia/Tokyo (규슈산업대 학사 일정 기준, UTC+9 — 한국 시간과 같다).
 * 일정·마감 날짜는 'YYYY-MM-DD' 문자열(그 시간대의 달력 날짜)로 저장하고, 시각은 선택 'HH:MM' 로 따로 둔다.
 * Date 객체의 UTC 변환을 거치지 않으므로 기기 시간대가 달라도 날짜가 하루 앞뒤로 밀리지 않는다.
 * 날짜끼리의 차이는 Date.UTC 로만 계산한다(일광절약시간 영향 없음).
 */

export const ACADEMIC_TIME_ZONE = 'Asia/Tokyo';

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_KEY = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 기준 시간대의 지금 날짜·분 */
export function academicNow(now: Date = new Date(), timeZone = ACADEMIC_TIME_ZONE): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

export function isValidDateKey(s: string): boolean {
  const m = DATE_KEY.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export const isValidTimeKey = (s: string) => TIME_KEY.test(s);

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

const toUtc = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

const fromUtc = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

export function makeDateKey(year: number, month: number, day: number): string {
  return fromUtc(Date.UTC(year, month - 1, day));
}

export function addDays(key: string, n: number): string {
  return fromUtc(toUtc(key) + n * 86_400_000);
}

/** b - a (일). 같은 날이면 0, 내일이면 1 */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** 0=월 … 6=일 (시간표와 같은 기준) */
export function weekdayOf(key: string): number {
  return (new Date(toUtc(key)).getUTCDay() + 6) % 7;
}

export function parseDateKey(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split('-').map(Number);
  return { year, month, day };
}

/** 월 이동 (12월 → 다음 해 1월, 1월 → 이전 해 12월) */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const i = year * 12 + (month - 1) + delta;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
}

/** 월요일 시작 달력 칸 (앞뒤 달 날짜 포함, 4~6주). inMonth=false 는 이웃 달 */
export function monthGrid(year: number, month: number): { key: string; day: number; inMonth: boolean }[][] {
  const first = makeDateKey(year, month, 1);
  const start = addDays(first, -weekdayOf(first));
  const next = shiftMonth(year, month, 1);
  const end = addDays(makeDateKey(next.year, next.month, 1), -1);
  const weekCount = Math.ceil((diffDays(start, end) + 1) / 7);
  const weeks: { key: string; day: number; inMonth: boolean }[][] = [];
  for (let w = 0; w < weekCount; w++) {
    const row: { key: string; day: number; inMonth: boolean }[] = [];
    for (let d = 0; d < 7; d++) {
      const key = addDays(start, w * 7 + d);
      const p = parseDateKey(key);
      row.push({ key, day: p.day, inMonth: p.year === year && p.month === month });
    }
    weeks.push(row);
  }
  return weeks;
}
