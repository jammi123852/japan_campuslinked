/**
 * 공지 분석 결과 표시·저장 규칙 (순수 함수, Node 테스트 가능).
 * - 언어: 언어별 내용이 있으면 선택 언어, 없으면(옛 결과) 저장된 값 — 화면이 콘텐츠 번역을 건다
 * - 대상: target 만 내 마감·알림에 넣는다. needs_check 는 캘린더에만 넣는다. excluded 는 '참고용 저장'을 직접 고를 때만.
 */
import type { NoticeAnalysis, NoticeDate } from '../../lib/api';
import type { EventKind, PersonalEvent } from '../schedule/scheduleLogic';

export function noticeText(r: NoticeAnalysis, locale: 'ko' | 'ja') {
  const part = locale === 'ja' ? r.ja : r.ko;
  return {
    summary: locale === 'ja' ? r.summaryJa || r.summaryKo : r.summaryKo || r.summaryJa,
    audience: part?.audience || r.audience,
    audienceReason: part?.audienceReason || r.audienceReason,
    tasks: part?.tasks?.length ? part.tasks : r.tasks,
    materials: part?.materials?.length ? part.materials : r.materials,
    howTo: part?.howTo || r.howTo,
    uncertain: part?.uncertain?.length ? part.uncertain : r.uncertain,
  };
}

export const dateLabel = (d: NoticeDate, locale: 'ko' | 'ja') => (locale === 'ja' ? d.labelJa : d.labelKo) || d.label;

/** 화면 표시용 시각: 범위면 13:00–17:00 */
export const dateClock = (d: Pick<NoticeDate, 'time' | 'startTime' | 'endTime'>) => (d.startTime && d.endTime ? `${d.startTime}–${d.endTime}` : d.time || d.endTime || d.startTime || '');

/** 일정에 넣을 수 있는 날짜: 연월일이 확실하고 게시·수정일이 아닌 것 */
export const canSaveDate = (d: NoticeDate) => !!d.date && d.kind !== 'posted' && d.kind !== 'updated';

export type SavePolicy = { allowed: boolean; reference: boolean; notify: boolean };

/** 대상 판정에 따른 저장 방식. reference 는 사용자가 '참고용 저장'을 직접 눌렀을 때 */
export function savePolicy(status: NoticeAnalysis['audienceStatus'], reference: boolean): SavePolicy {
  if (status === 'target') return { allowed: true, reference: false, notify: true };
  // 대상 확인 전이면 캘린더에만 넣고 내 마감·알림에는 넣지 않는다
  if (status === 'needs_check') return { allowed: true, reference: true, notify: false };
  return { allowed: reference, reference: true, notify: false };
}

const kindToEvent = (k: NoticeDate['kind']): EventKind => (k === 'exam' ? 'exam' : k === 'deadline' || k === 'reception' || k === 'entry_close' ? 'assignment' : 'personal');

export function noticeEvent(d: NoticeDate, key: string, title: string, policy: SavePolicy, id: string, nowIso: string): PersonalEvent {
  const ref = policy.reference;
  return {
    id,
    // 같은 공지의 같은 날짜 항목은 다시 분석해도 같은 키 → 중복 일정 없음
    sourceKey: `notice:${key}:${d.kind}:${d.label}`,
    title,
    // 참고용은 마감·알림에 들어가지 않도록 일반 일정으로 저장한다
    kind: ref ? 'personal' : kindToEvent(d.kind),
    date: d.date,
    // 접수 범위의 대표 시각은 시작이 아니라 종료까지 표시한다 (시작만 마감처럼 보이지 않게)
    time: d.startTime || d.time || null,
    endTime: d.endTime || null,
    course: null,
    memo: d.evidence,
    notify: !ref && policy.notify && (d.kind === 'deadline' || d.kind === 'exam' || d.kind === 'reception'),
    done: false,
    reference: ref,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}
