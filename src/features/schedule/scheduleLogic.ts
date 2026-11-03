/**
 * 개인 일정·마감 계산 (순수 함수, Node 에서 바로 테스트).
 * 날짜는 학사 기준 시간대(Asia/Tokyo)의 'YYYY-MM-DD', 시각은 선택 'HH:MM' (src/lib/dates.ts).
 */
import { diffDays, isValidDateKey, isValidTimeKey, timeToMinutes } from '../../lib/dates';

export type EventKind = 'assignment' | 'exam' | 'personal';
export const EVENT_KINDS: EventKind[] = ['assignment', 'exam', 'personal'];
export const EVENT_LIMITS = { title: 60, memo: 500 } as const;

export interface PersonalEvent {
  id: string;
  title: string;
  kind: EventKind;
  /** 'YYYY-MM-DD' (학사 기준 시간대의 달력 날짜) */
  date: string;
  /** 'HH:MM' 또는 null(날짜만 있는 일정 = 그날 하루 종일 / 그날 끝까지) */
  time: string | null;
  /** 관련 과목: 시간표 과목 키(courseKey)와 그때의 이름. 시간표에서 빠져도 이름은 남는다 */
  course: { key: string; name: string } | null;
  memo: string;
  /** 마감 전날·당일 앱 안 알림 */
  notify: boolean;
  /** 완료 여부 (과제·시험만 의미 있음) */
  done: boolean;
  createdAt: string;
  updatedAt: string;
  /** 자동으로 만든 일정의 출처 키 (예: exam:x26q3-3, notice:<hash>:2). 같은 키는 한 번만 만들고 다시 저장하면 갱신 */
  sourceKey?: string;
  /** 범위 일정의 끝 시각 (예: 접수 13:00~17:00) */
  endTime?: string | null;
  /** 대상 아닌 공지를 참고용으로 저장한 것: 마감·알림에 넣지 않는다 */
  reference?: boolean;
}

/** 다가오는 마감에 들어가는 종류 */
export const isDeadlineKind = (k: EventKind) => k === 'assignment' || k === 'exam';

export type DueState = 'done' | 'overdue' | 'today' | 'upcoming';

/**
 * 마감 상태. 시각이 있으면 그 시각이 지나면 overdue, 날짜만 있으면 그날이 끝나야 overdue.
 * days = 마감일 - 오늘 (달력 날짜 차이, 시각과 무관)
 */
export function dueState(ev: Pick<PersonalEvent, 'date' | 'time' | 'done'> & { endTime?: string | null }, today: string, nowMinutes: number): { state: DueState; days: number } {
  const days = diffDays(today, ev.date);
  if (ev.done) return { state: 'done', days };
  if (days < 0) return { state: 'overdue', days };
  if (days === 0) {
    // 범위 일정은 끝 시각이 지나야 지난 것으로 본다
    const until = ev.endTime || ev.time;
    if (until && timeToMinutes(until) <= nowMinutes) return { state: 'overdue', days };
    return { state: 'today', days };
  }
  return { state: 'upcoming', days };
}

const sortKey = (e: PersonalEvent) => `${e.date} ${e.time ?? '99:99'}`;
export const sortEvents = (list: PersonalEvent[]) => [...list].sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || a.createdAt.localeCompare(b.createdAt));

/** 공지 분석에서 일정에 넣은 항목 */
export const isNoticeEvent = (e: Pick<PersonalEvent, 'sourceKey' | 'reference'>) => !e.reference && (e.sourceKey?.startsWith('notice:') ?? false);

/** 홈 '다가오는 마감': 과제·시험과 공지에서 넣은 일정 중 완료 안 했고 아직 안 지난 것 (오늘 마감 포함) */
export function upcomingDeadlines(list: PersonalEvent[], today: string, nowMinutes: number) {
  return sortEvents(list)
    .filter((e) => isDeadlineKind(e.kind) || isNoticeEvent(e))
    .map((e) => ({ event: e, ...dueState(e, today, nowMinutes) }))
    .filter((x) => x.state === 'today' || x.state === 'upcoming');
}

/** 기한이 지났는데 완료하지 않은 과제·시험 */
export function overdueDeadlines(list: PersonalEvent[], today: string, nowMinutes: number) {
  return sortEvents(list).filter((e) => isDeadlineKind(e.kind) && dueState(e, today, nowMinutes).state === 'overdue');
}

export function eventsOn(list: PersonalEvent[], date: string) {
  return sortEvents(list.filter((e) => e.date === date));
}

/**
 * 앱 안 마감 알림 대상 (완료 안 했고 아직 안 지난 것)
 * - 알림을 켠 과제·시험: 마감이 내일(D-1) 또는 오늘(D-DAY)일 때
 * - 공지에서 넣은 일정: 넣는 즉시 (날짜가 멀어도). 행사 등 알림 설정이 없는 종류도 포함
 * id 에 날짜와 단계를 넣어, 날짜를 바꾸거나 단계가 바뀌면 새 알림이 되고 완료·삭제하면 목록에서 사라진다.
 */
export function deadlineAlerts(list: PersonalEvent[], today: string, nowMinutes: number) {
  return list
    .filter((e) => (isDeadlineKind(e.kind) ? e.notify : isNoticeEvent(e)))
    .map((e) => ({ event: e, ...dueState(e, today, nowMinutes) }))
    .filter((x) => (x.state === 'today' || x.state === 'upcoming') && (x.days <= 1 || isNoticeEvent(x.event)))
    .map((x) => ({ id: `deadline:${x.event.id}:${x.event.date}:${x.days === 0 ? 'D0' : x.days === 1 ? 'D1' : 'SOON'}`, event: x.event, days: x.days }));
}

export type EventErrors = Partial<Record<'title' | 'date' | 'time' | 'memo', 'required' | 'tooLong' | 'invalid'>>;

export function validateEvent(input: { title: string; date: string; time: string; memo: string }): EventErrors {
  const e: EventErrors = {};
  const title = input.title.trim();
  if (!title) e.title = 'required';
  else if ([...title].length > EVENT_LIMITS.title) e.title = 'tooLong';
  if (!input.date.trim()) e.date = 'required';
  else if (!isValidDateKey(input.date.trim())) e.date = 'invalid';
  if (input.time.trim() && !isValidTimeKey(input.time.trim())) e.time = 'invalid';
  if ([...input.memo.trim()].length > EVENT_LIMITS.memo) e.memo = 'tooLong';
  return e;
}
