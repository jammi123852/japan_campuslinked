/**
 * 기간별 체크리스트 (순수 함수, Node 에서 바로 테스트).
 *
 * 원칙
 * - 일정·이수 기록·장학금·졸업 항목은 id 만 저장하고 표시할 때 현재 값을 읽는다(복사 아님). 원본이 사라지면 '원본 없음'.
 * - 항목을 완료로 바꿔도 이수 기록은 바뀌지 않는다. 이수 완료는 사용자가 따로 확인한다.
 * - 다음 기간으로 넘겨도 원래 항목은 지우지 않고 넘겼다는 표시만 남긴다.
 */
import type { PersonalEvent } from '../schedule/scheduleLogic';
import type { CourseRecord } from '../records/gradLogic';
import type { OfficialData, OfficialScholarship, Quarter } from '../official/types';
import { periodKey, type AcademicPeriod } from '../academic/academicLogic';
import { addDays } from '../../lib/dates';

export type CheckStatus = 'todo' | 'doing' | 'done' | 'na';
export const CHECK_STATUSES: CheckStatus[] = ['todo', 'doing', 'done', 'na'];
export type CheckKind = 'manual' | 'event' | 'record' | 'grad' | 'scholarship' | 'career';

export interface ChecklistItem {
  id: string;
  periodKey: string;
  kind: CheckKind;
  /** 연결 대상 id (일정 id, 기록 id, 장학금 id, 졸업 영역 id). 직접 입력·진로 항목은 null */
  ref: string | null;
  /** 직접 입력한 제목, 또는 연결 항목을 넣을 때의 이름(원본이 사라졌을 때만 표시) */
  title: string;
  status: CheckStatus;
  carriedFrom: string | null;
  carriedTo: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 학년력의 쿼터 시작 ~ 다음 쿼터 전날 (시험 기간 포함). 마지막 쿼터는 학년도 끝(3/31). 학년력에 없으면 null(추측 안 함) */
export function periodRange(cal: OfficialData['calendar'] | undefined, p: AcademicPeriod): { start: string; end: string } | null {
  if (!cal || cal.year !== p.year) return null;
  const i = cal.quarters.findIndex((q) => q.q === p.quarter);
  if (i < 0) return null;
  const next = cal.quarters[i + 1];
  return { start: cal.quarters[i].start, end: next ? addDays(next.start, -1) : `${p.year + 1}-03-31` };
}

export function eventsInRange(events: PersonalEvent[], range: { start: string; end: string } | null) {
  if (!range) return [];
  return events.filter((e) => e.date >= range.start && e.date <= range.end);
}

export function recordsInPeriod(records: CourseRecord[], p: AcademicPeriod) {
  return records.filter((r) => r.year === p.year && r.quarters.includes(p.quarter as Quarter));
}

export const itemsForPeriod = (items: ChecklistItem[], key: string) => items.filter((i) => i.periodKey === key);

/** 같은 기간에 같은 연결 항목은 한 번만. 직접 입력은 같은 제목이 이미 있으면 추가하지 않는다 */
export function isDuplicate(items: ChecklistItem[], next: Pick<ChecklistItem, 'periodKey' | 'kind' | 'ref' | 'title'>) {
  return items.some(
    (i) => i.periodKey === next.periodKey && i.kind === next.kind && (next.ref != null ? i.ref === next.ref : i.ref == null && i.title.trim() === next.title.trim()),
  );
}

/** 끝나지 않은 항목(예정·진행 중)을 다음 기간으로. 원래 항목은 남고 carriedTo 가 표시된다. 이미 넘긴 것·다음 기간에 있는 것은 건너뛴다 */
export function carryOver(items: ChecklistItem[], from: AcademicPeriod, to: AcademicPeriod, newId: () => string, nowIso: string) {
  const fromKey = periodKey(from);
  const toKey = periodKey(to);
  const out = [...items];
  let moved = 0;
  items.forEach((it, idx) => {
    if (it.periodKey !== fromKey || it.carriedTo || (it.status !== 'todo' && it.status !== 'doing')) return;
    out[idx] = { ...it, carriedTo: toKey, updatedAt: nowIso };
    if (isDuplicate(out, { periodKey: toKey, kind: it.kind, ref: it.ref, title: it.title })) return;
    out.push({ ...it, id: newId(), periodKey: toKey, carriedFrom: fromKey, carriedTo: null, createdAt: nowIso, updatedAt: nowIso });
    moved += 1;
  });
  return { items: out, moved };
}

export type LiveLink =
  | { kind: 'none' }
  | { kind: 'missing' }
  | { kind: 'event'; event: PersonalEvent }
  | { kind: 'record'; record: CourseRecord }
  | { kind: 'scholarship'; scholarship: OfficialScholarship }
  | { kind: 'grad'; short: number | null };

/** 연결 항목의 현재 값. 표시할 때마다 원본에서 읽는다 */
export function liveLink(
  item: ChecklistItem,
  ctx: { events: PersonalEvent[]; records: CourseRecord[]; scholarships: OfficialScholarship[]; gradShort: Record<string, number> | null },
): LiveLink {
  if (item.ref == null) return { kind: 'none' };
  switch (item.kind) {
    case 'event': {
      const event = ctx.events.find((e) => e.id === item.ref);
      return event ? { kind: 'event', event } : { kind: 'missing' };
    }
    case 'record': {
      const record = ctx.records.find((r) => r.id === item.ref);
      return record ? { kind: 'record', record } : { kind: 'missing' };
    }
    case 'scholarship': {
      const scholarship = ctx.scholarships.find((s) => s.id === item.ref);
      return scholarship ? { kind: 'scholarship', scholarship } : { kind: 'missing' };
    }
    case 'grad':
      // 규칙이 없으면 null: 부족/충족을 말하지 않는다
      return { kind: 'grad', short: ctx.gradShort ? (ctx.gradShort[item.ref] ?? null) : null };
    default:
      return { kind: 'none' };
  }
}

export function summarize(items: ChecklistItem[]) {
  const out: Record<CheckStatus, number> = { todo: 0, doing: 0, done: 0, na: 0 };
  items.forEach((i) => (out[i.status] += 1));
  return out;
}
