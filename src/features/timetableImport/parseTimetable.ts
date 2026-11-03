/**
 * OCR 결과(글자 줄 + 위치)를 주간 시간표 칸으로 바꾸는 순수 함수.
 *
 * 방식 (가벼운 규칙 기반, 학습 모델 없음):
 * 1. 요일 머리글(月/火…, 월/화…, Mon/Tue…)을 찾아 x 위치로 열을 만든다.
 * 2. 첫 열보다 왼쪽에 있는 숫자 라벨(1, 2限, 3교시 …)로 y 위치의 행(교시)을 만든다.
 *    같은 왼쪽 영역의 시각(9:00, 9:00~10:30)은 가장 가까운 교시에 붙인다.
 * 3. 나머지 글자 줄을 가장 가까운 열·행 칸에 넣고, 칸마다 과목명/강의실/기타로 나눈다.
 *
 * 인식이 틀릴 수 있으므로 결과는 반드시 사용자 확인 화면을 거쳐 저장한다.
 * Node 에서 바로 테스트할 수 있도록 다른 모듈을 import 하지 않는다.
 */

export interface OcrFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface OcrLine {
  text: string;
  frame: OcrFrame;
}

export interface ParsedEntry {
  /** 0=월 … 6=일 */
  weekday: number;
  /** 교시 라벨을 못 찾으면 null (사용자가 확인 화면에서 입력) */
  period: number | null;
  courseName: string;
  room?: string;
  startTime?: string;
  endTime?: string;
  /** 과목명·강의실이 아닌 나머지 줄 (교수명 등) */
  memo?: string;
}

export type ParseFailure = 'noText' | 'noWeekdayHeader';

export interface ParseResult {
  entries: ParsedEntry[];
  /** 칸에 넣지 못한 글자 */
  unassigned: string[];
  /** 찾은 교시 행 수 (0이면 교시를 사용자가 직접 넣어야 함) */
  periodRows: number;
  failure?: ParseFailure;
}

// ------------------------------------------------------------ 요일 인식

const WEEKDAY_TOKENS: [RegExp, number][] = [
  [/^(月|월|mon)/i, 0],
  [/^(火|화|tue)/i, 1],
  [/^(水|수|wed)/i, 2],
  [/^(木|목|thu)/i, 3],
  [/^(金|금|fri)/i, 4],
  [/^(土|토|sat)/i, 5],
  [/^(日|일|sun)/i, 6],
];

/** "月", "月曜", "月曜日", "(月)", "월요일", "MON" 같은 머리글 한 토큰 */
function weekdayOf(token: string): number | null {
  const t = token.replace(/[()（）[\]【】.:：]/g, '').trim();
  if (t.length === 0 || t.length > 4) return null;
  // 한 글자이거나 曜/요일/영문 약어 형태만 머리글로 인정 (과목명 오인 방지)
  if (!/^(.|.曜日?|.요일|[a-z]{3}(day)?)$/i.test(t)) return null;
  for (const [re, d] of WEEKDAY_TOKENS) if (re.test(t)) return d;
  return null;
}

interface Header {
  weekday: number;
  cx: number;
  bottom: number;
}

/** 한 줄에 "月 火 水 木 金" 처럼 여러 요일이 붙어 인식된 경우 글자 위치 비율로 나눈다 */
function headersFromLine(line: OcrLine): Header[] {
  const tokens = line.text.split(/[\s　|│]+/).filter(Boolean);
  const days = tokens.map(weekdayOf);
  if (tokens.length === 1) {
    return days[0] == null ? [] : [{ weekday: days[0], cx: cx(line.frame), bottom: bottom(line.frame) }];
  }
  if (days.filter((d) => d != null).length < 2) return [];
  const total = line.text.length;
  const out: Header[] = [];
  let cursor = 0;
  tokens.forEach((tok, i) => {
    const at = line.text.indexOf(tok, cursor);
    cursor = at + tok.length;
    const d = days[i];
    if (d == null) return;
    const mid = (at + tok.length / 2) / total;
    out.push({ weekday: d, cx: line.frame.left + line.frame.width * mid, bottom: bottom(line.frame) });
  });
  return out;
}

// ------------------------------------------------------------ 교시·시각 인식

const PERIOD_RE = /^(\d{1,2})\s*(限|時限|コマ|교시|講|period)?$/i;
const RANGE_RE = /(\d{1,2})[:：](\d{2})\s*[~〜～\-–ー－]\s*(\d{1,2})[:：](\d{2})/;
const TIME_RE = /^(\d{1,2})[:：](\d{2})$/;

const hhmm = (h: string, m: string) => `${h.padStart(2, '0')}:${m}`;

interface PeriodRow {
  period: number;
  cy: number;
  startTime?: string;
  endTime?: string;
}

// ------------------------------------------------------------ 칸 내용 분류

/** 강의실로 보이는 줄: 号館/호관/教室/강의실, 또는 "A301", "12-201" 같은 번호 */
const ROOM_RE = /(号館|号室|教室|講義室|호관|강의실|room)|^[A-Za-z]?\d{3,4}[A-Za-z]?$|^\d{1,2}[-－]\d{2,4}$/i;

// ------------------------------------------------------------ 보조

const cx = (f: OcrFrame) => f.left + f.width / 2;
const cy = (f: OcrFrame) => f.top + f.height / 2;
const bottom = (f: OcrFrame) => f.top + f.height;

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.floor(s.length / 2)];
}

/** 정렬된 중심값들 사이 중간점을 경계로 가장 가까운 인덱스 */
function nearestIndex(centers: number[], v: number) {
  let best = 0;
  for (let i = 1; i < centers.length; i++) if (Math.abs(centers[i] - v) < Math.abs(centers[best] - v)) best = i;
  return best;
}

// ------------------------------------------------------------ 본체

export function parseTimetable(lines: OcrLine[]): ParseResult {
  const clean = lines
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }))
    .filter((l) => l.text.length > 0);
  if (clean.length === 0) return { entries: [], unassigned: [], periodRows: 0, failure: 'noText' };

  // 1. 요일 머리글 → 열
  const headerLines = new Set<OcrLine>();
  const byDay = new Map<number, Header>();
  for (const l of clean) {
    const hs = headersFromLine(l);
    if (hs.length === 0) continue;
    headerLines.add(l);
    // 같은 요일이 여러 번 나오면 가장 위의 것을 머리글로 본다
    for (const h of hs) {
      const prev = byDay.get(h.weekday);
      if (!prev || h.bottom < prev.bottom) byDay.set(h.weekday, h);
    }
  }
  const headers = [...byDay.values()].sort((a, b) => a.cx - b.cx);
  if (headers.length < 3) {
    return { entries: [], unassigned: clean.map((l) => l.text), periodRows: 0, failure: 'noWeekdayHeader' };
  }
  const colCenters = headers.map((h) => h.cx);
  const colGap = median(colCenters.slice(1).map((c, i) => c - colCenters[i]));
  const gridLeft = colCenters[0] - colGap / 2;
  const headerBottom = median(headers.map((h) => h.bottom));

  // 2. 왼쪽 영역 라벨 → 교시 행
  const labelLines = new Set<OcrLine>();
  const rows: PeriodRow[] = [];
  const looseTimes: { cy: number; time: string }[] = [];
  for (const l of clean) {
    if (headerLines.has(l) || cx(l.frame) >= gridLeft || cy(l.frame) <= headerBottom) continue;
    const head = l.text.split(' ')[0];
    const pm = PERIOD_RE.exec(head);
    const range = RANGE_RE.exec(l.text);
    if (pm) {
      labelLines.add(l);
      rows.push({
        period: Number(pm[1]),
        cy: cy(l.frame),
        startTime: range ? hhmm(range[1], range[2]) : undefined,
        endTime: range ? hhmm(range[3], range[4]) : undefined,
      });
    } else if (range) {
      labelLines.add(l);
      looseTimes.push({ cy: cy(l.frame), time: `${hhmm(range[1], range[2])}~${hhmm(range[3], range[4])}` });
    } else {
      const tm = TIME_RE.exec(l.text);
      if (tm) {
        labelLines.add(l);
        looseTimes.push({ cy: cy(l.frame), time: hhmm(tm[1], tm[2]) });
      }
    }
  }
  // 같은 교시 번호가 중복되면 위쪽 것만
  rows.sort((a, b) => a.cy - b.cy);
  const seen = new Set<number>();
  const periodRows = rows.filter((r) => (seen.has(r.period) ? false : (seen.add(r.period), true)));
  const rowCenters = periodRows.map((r) => r.cy);

  // 떨어진 시각 라벨은 가장 가까운 교시에 시작→종료 순으로 붙인다
  if (periodRows.length > 0) {
    for (const t of looseTimes.sort((a, b) => a.cy - b.cy)) {
      const r = periodRows[nearestIndex(rowCenters, t.cy)];
      if (t.time.includes('~')) {
        const [s, e] = t.time.split('~');
        r.startTime ??= s;
        r.endTime ??= e;
      } else if (!r.startTime) r.startTime = t.time;
      else if (!r.endTime) r.endTime = t.time;
    }
  }

  // 3. 나머지 줄 → 칸
  const cells = new Map<string, OcrLine[]>();
  const unassigned: string[] = [];
  for (const l of clean) {
    if (headerLines.has(l) || labelLines.has(l)) continue;
    const x = cx(l.frame);
    const y = cy(l.frame);
    if (y <= headerBottom || x < gridLeft || x > colCenters[colCenters.length - 1] + colGap / 2) {
      unassigned.push(l.text);
      continue;
    }
    const col = nearestIndex(colCenters, x);
    const row = periodRows.length > 0 ? nearestIndex(rowCenters, y) : -1;
    const key = `${col}:${row}`;
    const list = cells.get(key) ?? [];
    list.push(l);
    cells.set(key, list);
  }

  const entries: ParsedEntry[] = [];
  for (const [key, list] of cells) {
    const [col, row] = key.split(':').map(Number);
    const ordered = list.sort((a, b) => a.frame.top - b.frame.top);
    const room = ordered.find((l) => ROOM_RE.test(l.text));
    const rest = ordered.filter((l) => l !== room).map((l) => l.text);
    if (rest.length === 0) {
      if (room) unassigned.push(room.text);
      continue;
    }
    const pr = row >= 0 ? periodRows[row] : undefined;
    entries.push({
      weekday: headers[col].weekday,
      period: pr ? pr.period : null,
      courseName: rest[0],
      room: room?.text,
      startTime: pr?.startTime,
      endTime: pr?.endTime,
      memo: rest.length > 1 ? rest.slice(1).join(' ') : undefined,
    });
  }

  entries.sort((a, b) => a.weekday - b.weekday || (a.period ?? 99) - (b.period ?? 99));
  return { entries, unassigned, periodRows: periodRows.length };
}
