/**
 * 공지 분석 날짜 정리 (순수 함수, 서버·앱·테스트가 같이 쓴다). 여러 번 적용해도 결과가 같다.
 * 저장된 옛 결과(접수 13:00~17:00 을 '마감 13:00'으로 읽은 것)도 읽을 때 이 함수로 고친다. 원본 DB 행은 지우지 않는다.
 * 원문에 있는 범위만 나눈다: 시각을 새로 지어내지 않는다.
 */
export type NoticeDateKind = 'posted' | 'updated' | 'deadline' | 'reception' | 'entry_close' | 'event' | 'exam' | 'other';

export interface NormalizedNoticeDate {
  kind: NoticeDateKind;
  label: string;
  labelKo?: string;
  labelJa?: string;
  date: string;
  /** 대표 시각. 접수·행사 범위면 시작 시각 */
  time: string;
  startTime: string;
  endTime: string;
  rawText: string;
  evidence: string;
  evidenceFound: boolean | null;
}

const RANGE = /(\d{1,2})\s*[:：時시]\s*(\d{2})?\s*分?\s*[～〜~\-–—ー]\s*(\d{1,2})\s*[:：時시]\s*(\d{2})?/;
const ENTRY_CLOSE = /入室|입실/;
const RECEPTION = /受付|접수|受け付け/;
const hhmm = (h: string, m?: string) => `${h.padStart(2, '0')}:${m ?? '00'}`;

/** 글에서 'HH:MM~HH:MM' 범위를 찾는다 */
export function findTimeRange(text: string | null | undefined): { start: string; end: string } | null {
  const m = RANGE.exec((text ?? '').normalize('NFKC'));
  if (!m) return null;
  const start = hhmm(m[1], m[2]);
  const end = hhmm(m[3], m[4]);
  if (Number(m[1]) > 23 || Number(m[3]) > 23 || start >= end) return null;
  return { start, end };
}

type RawDate = Partial<Omit<NormalizedNoticeDate, 'kind'>> & { kind?: string };

export function normalizeNoticeDates(list: RawDate[]): NormalizedNoticeDate[] {
  const items: NormalizedNoticeDate[] = list.map((d) => {
    const raw = `${d.rawText ?? ''} ${d.label ?? ''}`;
    const range = findTimeRange(raw) ?? findTimeRange(d.evidence);
    const known = ['posted', 'updated', 'deadline', 'reception', 'entry_close', 'event', 'exam', 'other'];
    let kind = (known.includes(d.kind ?? '') ? d.kind : 'other') as NoticeDateKind;
    const start = d.startTime || range?.start || '';
    const end = d.endTime || range?.end || '';
    // 접수 범위와 입실 마감은 '마감'과 다른 항목으로 나눈다
    if (ENTRY_CLOSE.test(raw) && kind !== 'posted' && kind !== 'updated') kind = 'entry_close';
    else if (RECEPTION.test(raw) && (kind === 'other' || kind === 'deadline')) kind = 'reception';
    else if (kind === 'deadline' && range) kind = 'reception';
    return {
      kind,
      label: d.label ?? '',
      labelKo: d.labelKo,
      labelJa: d.labelJa,
      date: d.date ?? '',
      time: start || d.time || '',
      startTime: start,
      endTime: end,
      rawText: d.rawText ?? '',
      evidence: d.evidence ?? '',
      evidenceFound: d.evidenceFound ?? null,
    };
  });
  // 같은 날 접수 범위가 있으면, 원문에 시각이 적히지 않은 '마감'의 시각은 접수 시작이 아니라 접수 종료다
  return items.map((d) => {
    if (d.kind !== 'deadline' || !d.date) return d;
    const reception = items.find((x) => x.kind === 'reception' && x.date === d.date && x.endTime);
    const statedInText = !!d.time && (d.rawText.normalize('NFKC').includes(d.time) || d.rawText.normalize('NFKC').includes(String(Number(d.time.slice(0, 2)))));
    if (!reception || statedInText) return d;
    return { ...d, time: reception.endTime, startTime: '', endTime: '' };
  });
}

export function normalizeNoticeResult<T extends { dates?: RawDate[] }>(r: T): T & { dates: NormalizedNoticeDate[] } {
  return { ...r, dates: normalizeNoticeDates(r.dates ?? []) };
}
